#!/usr/bin/env python3
"""
UptimeWatch Automated EC2 Deployment Script
===========================================
Automates the end-to-end provisioning and deployment of UptimeWatch onto Amazon EC2:
1. Validates AWS credentials & detects environment (AWS Academy Lab vs Standard AWS)
2. Configures EC2 Security Group ('uptimewatch-ec2-sg') with ports 22, 80, 8000
3. Resolves the latest official Amazon Linux 2023 AMI
4. Attaches IAM Instance Profile (auto-detects 'LabRole' or 'UptimeWatch-EC2-Role')
5. Bundles cloud-init bootstrap script (ec2_user_data.sh)
6. Launches Free-Tier eligible EC2 instance (t2.micro / t3.micro)
7. Waits for instance state to reach 'running' and reports public endpoints
"""

import os
import sys
import time
import base64
import logging
from typing import Optional, Dict, Any

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError, PartialCredentialsError
except ImportError:
    print("FATAL: boto3 is not installed. Run: pip install boto3")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] (EC2-Deploy) %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("UptimeWatch-EC2-Deploy")

REGION = os.getenv("AWS_DEFAULT_REGION", os.getenv("AWS_REGION", "us-east-1"))
INSTANCE_TYPE = os.getenv("EC2_INSTANCE_TYPE", "t3.micro")
SECURITY_GROUP_NAME = "uptimewatch-ec2-sg"
INSTANCE_TAG_NAME = "UptimeWatch-Server"


def get_default_vpc_id(ec2_client) -> str:
    """Finds the default VPC ID in the target region."""
    vpcs = ec2_client.describe_vpcs(Filters=[{"Name": "isDefault", "Values": ["true"]}])
    if vpcs.get("Vpcs"):
        return vpcs["Vpcs"][0]["VpcId"]
    # Fallback to first available VPC
    all_vpcs = ec2_client.describe_vpcs()
    if all_vpcs.get("Vpcs"):
        return all_vpcs["Vpcs"][0]["VpcId"]
    raise RuntimeError("No VPC found in region " + REGION)


def ensure_security_group(ec2_client, vpc_id: str) -> str:
    """Ensures the Security Group exists and has rules for SSH, HTTP, and API."""
    try:
        sgs = ec2_client.describe_security_groups(
            Filters=[{"Name": "group-name", "Values": [SECURITY_GROUP_NAME]}]
        )
        if sgs.get("SecurityGroups"):
            sg_id = sgs["SecurityGroups"][0]["GroupId"]
            logger.info(f"✓ Found existing security group: {sg_id} ({SECURITY_GROUP_NAME})")
            return sg_id
    except ClientError:
        pass

    logger.info(f"Creating new security group '{SECURITY_GROUP_NAME}' in VPC {vpc_id}...")
    res = ec2_client.create_security_group(
        GroupName=SECURITY_GROUP_NAME,
        Description="Security group for UptimeWatch web and API services",
        VpcId=vpc_id,
        TagSpecifications=[{
            "ResourceType": "security-group",
            "Tags": [{"Key": "Name", "Value": SECURITY_GROUP_NAME}, {"Key": "Project", "Value": "UptimeWatch"}]
        }]
    )
    sg_id = res["GroupId"]

    # Ingress rules: 22 (SSH), 80 (HTTP Web), 8000 (FastAPI API)
    permissions = [
        {"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22, "IpRanges": [{"CidrIp": "0.0.0.0/0", "Description": "SSH Admin"}]},
        {"IpProtocol": "tcp", "FromPort": 80, "ToPort": 80, "IpRanges": [{"CidrIp": "0.0.0.0/0", "Description": "HTTP Web Dashboard"}]},
        {"IpProtocol": "tcp", "FromPort": 8000, "ToPort": 8000, "IpRanges": [{"CidrIp": "0.0.0.0/0", "Description": "FastAPI Direct Backend"}]}
    ]
    try:
        ec2_client.authorize_security_group_ingress(GroupId=sg_id, IpPermissions=permissions)
        logger.info(f"✓ Ingress rules (ports 22, 80, 8000) added to {sg_id}.")
    except ClientError as err:
        logger.warning(f"Ingress rule assignment note: {err}")

    return sg_id


def resolve_latest_al2023_ami(ec2_client) -> str:
    """Retrieves the latest official Amazon Linux 2023 AMI."""
    try:
        ssm = boto3.client("ssm", region_name=REGION)
        param = ssm.get_parameter(Name="/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64")
        ami_id = param["Parameter"]["Value"]
        logger.info(f"✓ Resolved latest AL2023 AMI via SSM parameter: {ami_id}")
        return ami_id
    except Exception:
        # Fallback to direct AMI describe search
        response = ec2_client.describe_images(
            Owners=["amazon"],
            Filters=[
                {"Name": "name", "Values": ["al2023-ami-2023.*-x86_64"]},
                {"Name": "state", "Values": ["available"]}
            ]
        )
        images = sorted(response["Images"], key=lambda x: x["CreationDate"], reverse=True)
        if images:
            ami_id = images[0]["ImageId"]
            logger.info(f"✓ Resolved latest AL2023 AMI: {ami_id} ({images[0]['Name']})")
            return ami_id

    # Default fallback for us-east-1
    return "ami-0c101f26f147fa7fd"


def detect_iam_instance_profile(iam_client) -> Optional[str]:
    """Detects available IAM instance profile (UptimeWatch-EC2-Instance-Profile or LabInstanceProfile)."""
    candidates = ["UptimeWatch-EC2-Instance-Profile", "LabInstanceProfile", "UptimeWatch-EC2-Role", "LabRole"]
    for role_name in candidates:
        try:
            iam_client.get_instance_profile(InstanceProfileName=role_name)
            logger.info(f"✓ Using IAM Instance Profile: '{role_name}'")
            return role_name
        except Exception:
            continue
    logger.info("ℹ No pre-existing IAM Instance Profile detected. Launching without attached profile.")
    return None


def read_user_data_script() -> str:
    """Reads the cloud-init bootstrap script."""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    script_path = os.path.join(current_dir, "ec2_user_data.sh")
    if os.path.exists(script_path):
        with open(script_path, "r", encoding="utf-8") as f:
            return f.read()
    raise FileNotFoundError(f"Cloud-init script not found at {script_path}")


def deploy():
    session = boto3.Session(region_name=REGION)
    sts = session.client("sts")

    try:
        identity = sts.get_caller_identity()
        logger.info(f"Target AWS Account : {identity['Account']}")
        logger.info(f"IAM Principal      : {identity['Arn']}")
        logger.info(f"Target Region      : {REGION}")
    except (NoCredentialsError, PartialCredentialsError) as e:
        logger.error(f"FATAL: AWS credentials not found. {e}")
        sys.exit(1)
    except ClientError as e:
        logger.error(f"FATAL: AWS authentication failed: {e}")
        logger.info("NOTE: If using AWS Academy / Vocareum, ensure your lab is STARTED (Green indicator).")
        sys.exit(1)

    ec2 = session.client("ec2")
    iam = session.client("iam")

    # 1. Resolve VPC and Security Group
    vpc_id = get_default_vpc_id(ec2)
    sg_id = ensure_security_group(ec2, vpc_id)

    # 2. Resolve AMI and Instance Profile
    ami_id = resolve_latest_al2023_ami(ec2)
    instance_profile = detect_iam_instance_profile(iam)

    # 3. Read User Data
    user_data = read_user_data_script()

    # 4. Check for existing key pairs or launch without
    key_name = None
    try:
        keys = ec2.describe_key_pairs()
        if keys.get("KeyPairs"):
            key_name = keys["KeyPairs"][0]["KeyName"]
            logger.info(f"✓ Using existing KeyPair: '{key_name}'")
    except Exception:
        pass

    launch_args: Dict[str, Any] = {
        "ImageId": ami_id,
        "InstanceType": INSTANCE_TYPE,
        "MinCount": 1,
        "MaxCount": 1,
        "SecurityGroupIds": [sg_id],
        "UserData": user_data,
        "TagSpecifications": [{
            "ResourceType": "instance",
            "Tags": [
                {"Key": "Name", "Value": INSTANCE_TAG_NAME},
                {"Key": "Project", "Value": "UptimeWatch"},
                {"Key": "Environment", "Value": "Production"}
            ]
        }]
    }

    if key_name:
        launch_args["KeyName"] = key_name
    if instance_profile:
        launch_args["IamInstanceProfile"] = {"Name": instance_profile}

    logger.info(f"[*] Launching EC2 instance ({INSTANCE_TYPE}) in {REGION}...")
    res = ec2.run_instances(**launch_args)
    instance_id = res["Instances"][0]["InstanceId"]
    logger.info(f"✓ EC2 Instance launched successfully! Instance ID: {instance_id}")

    logger.info("Waiting for instance to reach 'running' state...")
    waiter = ec2.get_waiter("instance_running")
    waiter.wait(InstanceIds=[instance_id])

    desc = ec2.describe_instances(InstanceIds=[instance_id])
    instance = desc["Reservations"][0]["Instances"][0]
    public_ip = instance.get("PublicIpAddress", "N/A")
    public_dns = instance.get("PublicDnsName", "N/A")

    print("\n" + "=" * 70)
    print("🚀 UPTIMEWATCH EC2 DEPLOYMENT SUCCESSFUL!")
    print("=" * 70)
    print(f"  • Instance ID : {instance_id}")
    print(f"  • State       : running")
    print(f"  • Public IP   : {public_ip}")
    print(f"  • Public DNS  : {public_dns}")
    print("\n🌐 Live Application Access:")
    print(f"  • Web Dashboard : http://{public_ip}")
    print(f"  • REST API Docs : http://{public_ip}/docs")
    print(f"  • API Health    : http://{public_ip}/api/health")
    print("\n⏳ Note: The cloud-init script takes ~2-3 minutes to install dependencies")
    print("  and start the services. You can monitor startup via SSH:")
    print(f"  ssh ec2-user@{public_ip} 'tail -f /var/log/uptimewatch-bootstrap.log'")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    deploy()

