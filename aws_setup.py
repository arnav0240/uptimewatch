#!/usr/bin/env python3
"""
UptimeWatch AWS Automated Resource Provisioner (Production-Hardened)
===================================================================
Idempotently provisions and configures all required AWS services:
1. Amazon SQS Main Queue & Dead-Letter Queue (DLQ) with redrive policy
2. Amazon SNS Alerts Topic (uptimewatch-alerts-topic)
3. Amazon S3 Bucket (uptimewatch-reports-bucket-<account_id>) with:
   - Server-Side Encryption (AES256)
   - Strict 4-point Block Public Access
   - 30-Day Lifecycle Expiration Rule
4. AWS Systems Manager (SSM) Parameter Store (/uptimewatch/prod/*) seeding:
   - No hardcoded secrets: reads DB_URL securely from environment
   - Enforces SecureString on database connection parameters

Supports --dry-run flag for safe pre-flight validation without making changes.
"""

import os
import sys
import json
import argparse
import logging
from typing import Dict, Any, Optional

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError, PartialCredentialsError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] (AWS-Setup) %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("UptimeWatch-AWS-Provisioner")

DEFAULT_REGION = os.getenv("AWS_DEFAULT_REGION", os.getenv("AWS_REGION", "us-east-1"))
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
MAIN_QUEUE_NAME = os.getenv("SQS_QUEUE_NAME", "uptimewatch-checks-queue")
DLQ_NAME = os.getenv("SQS_DLQ_NAME", "uptimewatch-checks-dlq")
TOPIC_NAME = os.getenv("SNS_TOPIC_NAME", "uptimewatch-alerts-topic")
SSM_PREFIX = os.getenv("SSM_PARAM_PREFIX", "/uptimewatch/prod")
LOG_GROUP_NAME = os.getenv("CLOUDWATCH_LOG_GROUP", "/uptimewatch/prod")


class AWSResourceProvisioner:
    def __init__(self, region: str = DEFAULT_REGION, dry_run: bool = False):
        self.region = region
        self.dry_run = dry_run
        self.account_id = None
        self.bucket_name = None

        logger.info(f"[*] Initializing UptimeWatch AWS Provisioner (Region: {self.region}, DryRun: {self.dry_run})")
        
        if not BOTO3_AVAILABLE:
            logger.error("FATAL: boto3 is not installed. Please run: pip install boto3")
            sys.exit(1)

        try:
            self.session = boto3.Session(region_name=self.region)
            self.sqs = self.session.client("sqs")
            self.sns = self.session.client("sns")
            self.s3 = self.session.client("s3")
            self.ssm = self.session.client("ssm")
            self.logs = self.session.client("logs")
            
            # Verify credentials and resolve account ID
            sts = self.session.client("sts")
            caller_identity = sts.get_caller_identity()
            self.account_id = caller_identity.get("Account")
            logger.info(f"✓ Authenticated IAM Principal: {caller_identity.get('Arn')}")
            logger.info(f"✓ Target AWS Account ID    : {self.account_id}")
        except (NoCredentialsError, PartialCredentialsError) as err:
            logger.error(f"FATAL: AWS credentials not found ({err}). Set AWS_ACCESS_KEY_ID or configure AWS CLI.")
            sys.exit(1)
        except ClientError as err:
            logger.error(f"FATAL: AWS STS verification failed: {err}")
            sys.exit(1)

    def provision_sqs_with_dlq(self) -> Dict[str, str]:
        """
        Idempotently provisions:
        1. Dead-Letter Queue (DLQ)
        2. Main queue with redrive policy targeting DLQ (maxReceiveCount: 5)
        """
        logger.info(f"Checking SQS Queues ({MAIN_QUEUE_NAME} & {DLQ_NAME})...")

        if self.dry_run:
            logger.info(f"[DryRun] Would verify/create DLQ '{DLQ_NAME}' and main queue '{MAIN_QUEUE_NAME}'.")
            return {
                "queue_url": f"https://sqs.{self.region}.amazonaws.com/{self.account_id}/{MAIN_QUEUE_NAME}",
                "dlq_url": f"https://sqs.{self.region}.amazonaws.com/{self.account_id}/{DLQ_NAME}",
                "queue_arn": f"arn:aws:sqs:{self.region}:{self.account_id}:{MAIN_QUEUE_NAME}",
                "dlq_arn": f"arn:aws:sqs:{self.region}:{self.account_id}:{DLQ_NAME}"
            }

        # 1. Provision DLQ
        try:
            dlq_res = self.sqs.get_queue_url(QueueName=DLQ_NAME)
            dlq_url = dlq_res["QueueUrl"]
            logger.info(f"✓ Found existing SQS DLQ: {dlq_url}")
        except ClientError as e:
            if e.response["Error"]["Code"] in ("AWS.SimpleQueueService.NonExistentQueue", "QueueDoesNotExist"):
                logger.info(f"Creating SQS DLQ: {DLQ_NAME}...")
                create_dlq = self.sqs.create_queue(
                    QueueName=DLQ_NAME,
                    Attributes={
                        "MessageRetentionPeriod": "1209600"  # 14 days
                    }
                )
                dlq_url = create_dlq["QueueUrl"]
                logger.info(f"✓ Created SQS DLQ: {dlq_url}")
            else:
                raise

        # Resolve DLQ ARN
        dlq_attr = self.sqs.get_queue_attributes(QueueUrl=dlq_url, AttributeNames=["QueueArn"])
        dlq_arn = dlq_attr["Attributes"]["QueueArn"]

        # Redrive policy JSON
        redrive_policy = json.dumps({
            "deadLetterTargetArn": dlq_arn,
            "maxReceiveCount": "5"
        })

        # 2. Provision Main Queue with redrive policy attached
        try:
            main_res = self.sqs.get_queue_url(QueueName=MAIN_QUEUE_NAME)
            main_url = main_res["QueueUrl"]
            logger.info(f"✓ Found existing Main SQS Queue: {main_url}")
            # Ensure attributes match
            self.sqs.set_queue_attributes(
                QueueUrl=main_url,
                Attributes={
                    "VisibilityTimeout": "30",
                    "MessageRetentionPeriod": "86400",  # 1 day
                    "RedrivePolicy": redrive_policy
                }
            )
        except ClientError as e:
            if e.response["Error"]["Code"] in ("AWS.SimpleQueueService.NonExistentQueue", "QueueDoesNotExist"):
                logger.info(f"Creating Main SQS Queue: {MAIN_QUEUE_NAME}...")
                create_main = self.sqs.create_queue(
                    QueueName=MAIN_QUEUE_NAME,
                    Attributes={
                        "VisibilityTimeout": "30",
                        "MessageRetentionPeriod": "86400",
                        "RedrivePolicy": redrive_policy
                    }
                )
                main_url = create_main["QueueUrl"]
                logger.info(f"✓ Created Main SQS Queue: {main_url}")
            else:
                raise

        main_attr = self.sqs.get_queue_attributes(QueueUrl=main_url, AttributeNames=["QueueArn"])
        main_arn = main_attr["Attributes"]["QueueArn"]

        return {
            "queue_url": main_url,
            "dlq_url": dlq_url,
            "queue_arn": main_arn,
            "dlq_arn": dlq_arn
        }

    def provision_sns(self) -> str:
        """Provisions or verifies the alerts SNS Topic."""
        logger.info(f"Checking SNS Topic: {TOPIC_NAME}...")
        if self.dry_run:
            logger.info(f"[DryRun] Would verify/create SNS Topic '{TOPIC_NAME}'.")
            return f"arn:aws:sns:{self.region}:{self.account_id}:{TOPIC_NAME}"

        try:
            res = self.sns.create_topic(
                Name=TOPIC_NAME,
                Attributes={
                    "DisplayName": "UptimeWatch Incident Alerts"
                }
            )
            topic_arn = res["TopicArn"]
            logger.info(f"✓ SNS Topic provisioned/verified: {topic_arn}")
            return topic_arn
        except ClientError as e:
            logger.error(f"Failed to provision SNS topic: {e}")
            raise

    def provision_s3(self) -> str:
        """
        Provisions a private, encrypted S3 bucket specifically scoped to this AWS account:
        `uptimewatch-reports-bucket-<account_id>`
        Does NOT adopt random untrusted buckets.
        """
        custom_bucket = os.getenv("S3_REPORTS_BUCKET")
        self.bucket_name = custom_bucket or f"uptimewatch-reports-bucket-{self.account_id}"
        logger.info(f"Checking S3 Bucket: {self.bucket_name}...")

        if self.dry_run:
            logger.info(f"[DryRun] Would verify/create S3 bucket '{self.bucket_name}' with AES256, BlockPublicAccess & 30d lifecycle.")
            return self.bucket_name

        # Verify bucket existence and ownership
        bucket_exists = False
        try:
            self.s3.head_bucket(Bucket=self.bucket_name)
            bucket_exists = True
            logger.info(f"✓ Found existing S3 Bucket owned by this account: {self.bucket_name}")
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code")
            if error_code in ("404", "NoSuchBucket"):
                bucket_exists = False
            elif error_code == "403":
                logger.error(f"FATAL: S3 Bucket '{self.bucket_name}' exists in another AWS account or permission is denied.")
                raise RuntimeError(f"Bucket name collision or access denied for bucket '{self.bucket_name}'") from e
            else:
                raise

        # Create if missing
        if not bucket_exists:
            logger.info(f"Creating S3 Bucket '{self.bucket_name}' in region '{self.region}'...")
            if self.region == "us-east-1":
                self.s3.create_bucket(Bucket=self.bucket_name)
            else:
                self.s3.create_bucket(
                    Bucket=self.bucket_name,
                    CreateBucketConfiguration={"LocationConstraint": self.region}
                )
            logger.info(f"✓ S3 Bucket created: {self.bucket_name}")

        # 1. Enforce Server-Side Encryption (AES256)
        logger.info(f"Enforcing default AES256 Server-Side Encryption on {self.bucket_name}...")
        self.s3.put_bucket_encryption(
            Bucket=self.bucket_name,
            ServerSideEncryptionConfiguration={
                "Rules": [
                    {
                        "ApplyServerSideEncryptionByDefault": {
                            "SSEAlgorithm": "AES256"
                        },
                        "BucketKeyEnabled": True
                    }
                ]
            }
        )

        # 2. Enforce 4-Point Block Public Access
        logger.info(f"Enforcing S3 Block Public Access on {self.bucket_name}...")
        self.s3.put_public_access_block(
            Bucket=self.bucket_name,
            PublicAccessBlockConfiguration={
                "BlockPublicAcls": True,
                "IgnorePublicAcls": True,
                "BlockPublicPolicy": True,
                "RestrictPublicBuckets": True
            }
        )

        # 3. Enforce 30-Day Lifecycle Expiration Policy
        logger.info(f"Configuring 30-day lifecycle expiration policy on {self.bucket_name}...")
        self.s3.put_bucket_lifecycle_configuration(
            Bucket=self.bucket_name,
            LifecycleConfiguration={
                "Rules": [
                    {
                        "ID": "ExpireReportsAfter30Days",
                        "Status": "Enabled",
                        "Filter": {"Prefix": ""},
                        "Expiration": {"Days": 30}
                    }
                ]
            }
        )
        return self.bucket_name

    def seed_ssm_parameters(self, config_data: Dict[str, str]) -> None:
        """Upserts configurations securely into SSM Parameter Store without logging secrets."""
        logger.info(f"Seeding AWS SSM Parameter Store under namespace '{SSM_PREFIX}'...")

        if self.dry_run:
            for k in config_data.keys():
                logger.info(f"[DryRun] Would write SSM Parameter: {SSM_PREFIX}/{k}")
            return

        for key, value in config_data.items():
            param_name = f"{SSM_PREFIX}/{key}"
            is_secret = any(s in key.lower() for s in ("db_url", "password", "secret", "token", "key"))
            try:
                self.ssm.put_parameter(
                    Name=param_name,
                    Description=f"UptimeWatch production config parameter: {key}",
                    Value=value,
                    Type="SecureString" if is_secret else "String",
                    Overwrite=True
                )
                logger.info(f"  ✓ Seeded SSM Parameter: {param_name} (Type: {'SecureString' if is_secret else 'String'})")
            except ClientError as e:
                logger.error(f"  ✗ Failed to put parameter {param_name}: {e}")
                raise

    def provision_cloudwatch_logs(self) -> str:
        """Provisions or verifies CloudWatch Log Group with 30-day retention."""
        logger.info(f"Checking CloudWatch Log Group: {LOG_GROUP_NAME}...")
        if self.dry_run:
            logger.info(f"[DryRun] Would verify/create CloudWatch Log Group '{LOG_GROUP_NAME}' with 30-day retention.")
            return f"arn:aws:logs:{self.region}:{self.account_id}:log-group:{LOG_GROUP_NAME}"

        try:
            self.logs.create_log_group(logGroupName=LOG_GROUP_NAME)
            logger.info(f"✓ Created CloudWatch Log Group: {LOG_GROUP_NAME}")
        except ClientError as e:
            if e.response["Error"]["Code"] == "ResourceAlreadyExistsException":
                logger.info(f"✓ Found existing CloudWatch Log Group: {LOG_GROUP_NAME}")
            else:
                logger.error(f"Failed to create CloudWatch Log Group: {e}")
                raise

        # Enforce 30-day retention policy to prevent cost overruns
        try:
            self.logs.put_retention_policy(logGroupName=LOG_GROUP_NAME, retentionInDays=30)
            logger.info(f"✓ Enforced 30-day retention policy on {LOG_GROUP_NAME}")
        except ClientError as e:
            logger.warning(f"Could not set retention policy on {LOG_GROUP_NAME}: {e}")

        return f"arn:aws:logs:{self.region}:{self.account_id}:log-group:{LOG_GROUP_NAME}"

    def run_all(self) -> Dict[str, str]:
        """Runs the complete idempotent, safe setup workflow."""
        logger.info("=" * 65)
        logger.info("  UPTIMEWATCH PRODUCTION AWS PROVISIONER (HARDENED)")
        logger.info("=" * 65)

        # Read database URL securely from environment
        db_url = os.getenv("DB_URL")
        if not db_url:
            if APP_ENV in ("production", "prod"):
                raise RuntimeError(
                    "FATAL: DB_URL environment variable must be set in production before running aws_setup.py. "
                    "Do not commit plaintext credentials to source control."
                )
            else:
                logger.warning("DB_URL not found in environment. Using development placeholder (localhost:5432).")
                db_url = "postgresql://postgres:postgres@localhost:5432/uptimewatch"

        # 1. SQS with DLQ
        sqs_info = self.provision_sqs_with_dlq()

        # 2. SNS Alerts
        topic_arn = self.provision_sns()

        # 3. S3 Bucket
        bucket_name = self.provision_s3()

        # 4. CloudWatch Logs Log Group
        log_group_arn = self.provision_cloudwatch_logs()

        # 5. SSM Parameter Store
        configs = {
            "db_url": db_url,
            "sqs_queue_url": sqs_info["queue_url"],
            "sqs_dlq_url": sqs_info["dlq_url"],
            "sns_topic_arn": topic_arn,
            "s3_bucket_name": bucket_name,
            "log_group_name": LOG_GROUP_NAME
        }

        self.seed_ssm_parameters(configs)

        logger.info("=" * 65)
        logger.info("✓ AWS INFRASTRUCTURE PROVISIONING COMPLETED SUCCESSFULLY!")
        logger.info(f"  • SQS Main Queue URL : {sqs_info['queue_url']}")
        logger.info(f"  • SQS DLQ URL        : {sqs_info['dlq_url']}")
        logger.info(f"  • SNS Topic ARN      : {topic_arn}")
        logger.info(f"  • S3 Bucket Name     : {bucket_name}")
        logger.info(f"  • Log Group Name     : {LOG_GROUP_NAME}")
        logger.info(f"  • SSM Parameter Path : {SSM_PREFIX}/*")
        logger.info("=" * 65)

        return configs


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="UptimeWatch AWS Cloud Resource Provisioner")
    parser.add_argument("--dry-run", action="store_true", help="Validate credentials and planned operations without making changes")
    args = parser.parse_args()

    provisioner = AWSResourceProvisioner(dry_run=args.dry_run)
    provisioner.run_all()
