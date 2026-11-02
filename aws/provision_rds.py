#!/usr/bin/env python3
"""
Provision Amazon RDS PostgreSQL Database for UptimeWatch
- Strict AWS Free Tier compliance (Single-AZ db.t3.micro, 20GB gp3)
- Private mode (accessible strictly within VPC via uptimewatch-rds-sg)
- Strong master password generated and stored directly in SSM Parameter Store
"""
import os
import sys
import secrets
import string
import boto3
from botocore.exceptions import ClientError

REGION = "us-east-1"
DB_IDENTIFIER = "uptimewatch-db"
DB_NAME = "uptimewatch"
MASTER_USER = "postgres"
SECURITY_GROUP_ID = "sg-068eacfab97366d5e"  # uptimewatch-rds-sg

def generate_secure_password(length=24):
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))

def main():
    session = boto3.Session(region_name=REGION)
    rds = session.client("rds")
    ssm = session.client("ssm")

    # Check if instance already exists
    try:
        desc = rds.describe_db_instances(DBInstanceIdentifier=DB_IDENTIFIER)
        instance = desc["DBInstances"][0]
        status = instance["DBInstanceStatus"]
        endpoint = instance.get("Endpoint", {}).get("Address", "provisioning...")
        print(f"✓ Found existing RDS instance '{DB_IDENTIFIER}' (Status: {status}, Endpoint: {endpoint})")
        return
    except ClientError as e:
        if e.response["Error"]["Code"] != "DBInstanceNotFound":
            raise

    # Generate cryptographically secure password
    master_password = generate_secure_password()
    print(f"[*] Launching Amazon RDS PostgreSQL instance '{DB_IDENTIFIER}' under AWS Free Tier...")
    print(f"    • Instance Class: db.t3.micro (Single-AZ)")
    print(f"    • Engine: PostgreSQL 16.3")
    print(f"    • Storage: 20 GB gp3")
    print(f"    • Network: Private Mode (attached to {SECURITY_GROUP_ID})")

    res = rds.create_db_instance(
        DBInstanceIdentifier=DB_IDENTIFIER,
        DBName=DB_NAME,
        Engine="postgres",
        EngineVersion="16.3",
        DBInstanceClass="db.t3.micro",
        AllocatedStorage=20,
        StorageType="gp3",
        MasterUsername=MASTER_USER,
        MasterUserPassword=master_password,
        VpcSecurityGroupIds=[SECURITY_GROUP_ID],
        PubliclyAccessible=False,
        BackupRetentionPeriod=1,
        AutoMinorVersionUpgrade=True,
        MultiAZ=False,
        DeletionProtection=False,
        Tags=[
            {"Key": "Project", "Value": "UptimeWatch"},
            {"Key": "Environment", "Value": "Production"}
        ]
    )

    print("✓ RDS create_db_instance requested successfully!")
    print(f"  Status: {res['DBInstance']['DBInstanceStatus']}")

    # Store DB connection parameters securely in SSM Parameter Store
    # The endpoint will be updated once the instance finishes creating (5-10 mins)
    ssm.put_parameter(
        Name="/uptimewatch/prod/db_master_password",
        Description="UptimeWatch RDS Master Database Password",
        Value=master_password,
        Type="SecureString",
        Overwrite=True
    )
    ssm.put_parameter(
        Name="/uptimewatch/prod/db_name",
        Description="UptimeWatch RDS Database Name",
        Value=DB_NAME,
        Type="String",
        Overwrite=True
    )
    ssm.put_parameter(
        Name="/uptimewatch/prod/db_user",
        Description="UptimeWatch RDS Master Username",
        Value=MASTER_USER,
        Type="String",
        Overwrite=True
    )
    print("✓ Database credentials securely seeded into AWS SSM Parameter Store.")

if __name__ == "__main__":
    main()
