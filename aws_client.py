#!/usr/bin/env python3
"""
UptimeWatch AWS Connection & Client Module
==========================================
Enterprise-grade singleton AWS client factory providing:
- Thread-safe, cached boto3 client management (SQS, SNS, S3, SSM)
- Cached Parameter Store resolution with decryption (get_config)
- Strict mode isolation: fail-fast in production, explicit local simulation fallback
- Sanitized logging: zero exposure of credentials or passwords
"""

import os
import re
import json
import logging
from typing import Dict, Any, Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] (AWS-Client) %(message)s")
logger = logging.getLogger("UptimeWatch-AWS-Client")

# Detect boto3 availability
try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError, PartialCredentialsError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False
    ClientError = Exception
    NoCredentialsError = Exception
    PartialCredentialsError = Exception

DEFAULT_REGION = os.getenv("AWS_DEFAULT_REGION", os.getenv("AWS_REGION", "us-east-1"))
SSM_PARAM_PREFIX = os.getenv("SSM_PARAM_PREFIX", "/uptimewatch/prod")
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
SIMULATION_MODE_ENV = os.getenv("SIMULATION_MODE", "").strip().lower()

# Local simulation fallback configuration (STRICTLY FOR LOCAL DEV ONLY)
LOCAL_CONFIG_FALLBACK = {
    f"{SSM_PARAM_PREFIX}/db_url": "postgresql://postgres:postgres@localhost:5432/uptimewatch",
    f"{SSM_PARAM_PREFIX}/sqs_queue_url": "https://sqs.us-east-1.amazonaws.com/123456789012/uptimewatch-checks-queue",
    f"{SSM_PARAM_PREFIX}/sns_topic_arn": "arn:aws:sns:us-east-1:123456789012:uptimewatch-alerts-topic",
    f"{SSM_PARAM_PREFIX}/s3_bucket_name": "uptimewatch-reports-bucket-local",
}


def sanitize_value(key: str, val: str) -> str:
    """Masks sensitive values (database URLs, passwords, tokens) for safe logging."""
    if not val:
        return ""
    sensitive_keywords = ("db_url", "password", "secret", "token", "key", "credential")
    if any(k in key.lower() for k in sensitive_keywords):
        # Mask password in URI if standard db URI pattern exists
        masked_uri = re.sub(r"://([^:@]+):([^@]+)@", r"://\1:********@", val)
        if masked_uri != val:
            return masked_uri
        return "******** (masked)"
    return val


class AWSClientManager:
    """Singleton AWS Client Factory managing connections to AWS cloud services."""
    _instance: Optional["AWSClientManager"] = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(AWSClientManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, region: str = DEFAULT_REGION):
        if getattr(self, "_initialized", False):
            return

        self.region = region
        self._session = None
        self._clients: Dict[str, Any] = {}
        self._config_cache: Dict[str, str] = {}
        self.simulation_mode = self._determine_simulation_mode()

        if self.simulation_mode:
            logger.info("⚡ UptimeWatch running in LOCAL SIMULATION MODE (bypassing live AWS calls).")
        else:
            self._init_live_aws_session()

        self._initialized = True

    def _determine_simulation_mode(self) -> bool:
        """
        Determines whether simulation mode is enabled.
        In production, simulation mode is strictly forbidden and will never be silently activated.
        """
        app_env = os.getenv("APP_ENV", "development").strip().lower()
        sim_mode_env = os.getenv("SIMULATION_MODE", "").strip().lower()
        is_production = app_env in ("production", "prod")

        # Explicit environment variable check
        if sim_mode_env in ("true", "1", "yes"):
            if is_production:
                raise RuntimeError(
                    "FATAL CONFIG ERROR: SIMULATION_MODE=true is forbidden when APP_ENV=production. "
                    "Production workloads must connect to real AWS infrastructure."
                )
            return True
        elif sim_mode_env in ("false", "0", "no"):
            return False

        # In production without explicit SIMULATION_MODE, always use live mode
        if is_production:
            return False

        # In development without boto3 installed, permit simulation mode
        if not BOTO3_AVAILABLE:
            logger.warning("boto3 is not installed. Defaulting to local simulation mode for development.")
            return True

        # In development, check if credentials exist and are valid; if not, permit local simulation
        try:
            session = boto3.Session(region_name=self.region)
            credentials = session.get_credentials()
            if not credentials:
                logger.warning("No AWS credentials found in development. Using local simulation mode.")
                return True
            # Verify credentials with quick STS call
            sts = session.client("sts")
            sts.get_caller_identity()
            return False
        except (NoCredentialsError, PartialCredentialsError, ClientError) as e:
            logger.warning(f"AWS credentials invalid or expired in development ({e}). Defaulting to local simulation mode.")
            return True
        except Exception:
            return True

    def _init_live_aws_session(self):
        """Initializes and verifies the live AWS session. Fails fast on error."""
        if not BOTO3_AVAILABLE:
            raise RuntimeError(
                "FATAL: boto3 library is required to run in live AWS mode. Install with `pip install boto3`."
            )

        logger.info(f"Connecting to live AWS environment (Region: {self.region}, Environment: {APP_ENV})...")
        try:
            self._session = boto3.Session(region_name=self.region)
            sts = self._session.client("sts")
            identity = sts.get_caller_identity()
            account = identity.get("Account")
            arn = identity.get("Arn")
            logger.info(f"✓ AWS Identity Verified: Account={account} | Principal={arn}")
        except (NoCredentialsError, PartialCredentialsError) as err:
            error_msg = (
                f"FATAL: AWS credentials not found or incomplete in live mode ({err}). "
                "Ensure EC2 IAM Role is attached or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are exported."
            )
            logger.error(error_msg)
            raise RuntimeError(error_msg) from err
        except ClientError as err:
            error_code = err.response.get("Error", {}).get("Code", "Unknown")
            error_msg = f"FATAL: AWS STS verification failed [{error_code}]: {err}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from err
        except Exception as err:
            error_msg = f"FATAL: Unexpected failure initializing AWS Session: {err}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from err

    def get_client(self, service_name: str):
        """Returns or creates a cached boto3 client for the given service."""
        if self.simulation_mode:
            logger.debug(f"[Simulation] Simulated client requested for service: {service_name}")
            return None

        if service_name not in self._clients:
            try:
                self._clients[service_name] = self._session.client(service_name)
            except Exception as e:
                logger.error(f"Failed to instantiate AWS client for service '{service_name}': {e}")
                raise
        return self._clients[service_name]

    @property
    def sqs(self):
        return self.get_client("sqs")

    @property
    def sns(self):
        return self.get_client("sns")

    @property
    def s3(self):
        return self.get_client("s3")

    @property
    def ssm(self):
        return self.get_client("ssm")

    def clear_cache(self):
        """Clears the local configuration cache."""
        self._config_cache.clear()


# Module-level instance
aws_manager = AWSClientManager()


def get_config(parameter_name: str, force_refresh: bool = False) -> str:
    """
    Fetches a parameter dynamically from AWS SSM Parameter Store with decryption enabled.
    In simulation mode, uses LOCAL_CONFIG_FALLBACK.
    In live AWS mode, fails fast and never falls back to mock endpoints or localhost.
    
    Args:
        parameter_name: SSM parameter key (e.g. 'db_url' or full path '/uptimewatch/prod/db_url')
        force_refresh: If True, bypasses the in-memory cache and fetches fresh value
    """
    if not parameter_name.startswith("/"):
        full_path = f"{SSM_PARAM_PREFIX}/{parameter_name}"
    else:
        full_path = parameter_name

    # Check in-memory cache if not forcing refresh
    if not force_refresh and full_path in aws_manager._config_cache:
        return aws_manager._config_cache[full_path]

    # Handle Simulation Mode
    if aws_manager.simulation_mode:
        fallback_val = LOCAL_CONFIG_FALLBACK.get(full_path)
        if fallback_val is None:
            raise KeyError(f"[Simulation Mode] Configuration key '{full_path}' not defined in simulation fallback table.")
        logger.info(f"[Simulation] Resolved config '{full_path}' -> '{sanitize_value(full_path, fallback_val)}'")
        aws_manager._config_cache[full_path] = fallback_val
        return fallback_val

    # Live AWS Mode
    try:
        ssm_client = aws_manager.ssm
        response = ssm_client.get_parameter(Name=full_path, WithDecryption=True)
        value = response["Parameter"]["Value"]
        logger.debug(f"Retrieved SSM Parameter: {full_path}")
        aws_manager._config_cache[full_path] = value
        return value
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "Unknown")
        msg = f"AWS SSM Parameter lookup failed for '{full_path}' [{code}]: {e}"
        logger.error(msg)
        # NEVER fall back to localhost in live mode
        raise RuntimeError(msg) from e
    except Exception as e:
        msg = f"Unexpected failure looking up SSM Parameter '{full_path}': {e}"
        logger.error(msg)
        raise RuntimeError(msg) from e


def clear_config_cache():
    """Utility function to clear the cached SSM configurations."""
    aws_manager.clear_cache()


# ==============================================================
# High-Level Worker & API Helpers
# ==============================================================

def dispatch_health_check_to_sqs(monitor_id: int, url: str, timeout_sec: int = 10) -> str:
    """Enqueues a synthetic health check job into Amazon SQS."""
    payload = {
        "monitor_id": monitor_id,
        "url": url,
        "timeout_sec": timeout_sec,
        "timestamp": "ISO8601"
    }
    
    if aws_manager.simulation_mode:
        logger.info(f"[Simulation] Enqueued check job to SQS for monitor #{monitor_id} ({url})")
        return "msg-simulated-sqs-id-12345"

    try:
        queue_url = get_config("sqs_queue_url")
        response = aws_manager.sqs.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps(payload),
            MessageAttributes={
                "ServiceType": {
                    "DataType": "String",
                    "StringValue": "HTTP_PING"
                }
            }
        )
        msg_id = response.get("MessageId", "unknown")
        logger.info(f"Dispatched check for #{monitor_id} to SQS (MessageId: {msg_id})")
        return msg_id
    except Exception as e:
        logger.error(f"Failed to dispatch SQS health check message for monitor #{monitor_id}: {e}")
        raise


def publish_sns_alert(monitor_name: str, status: str, message: str, notification_target: Optional[str] = None) -> str:
    """
    Publishes an availability alert or recovery notice to Amazon SNS topic
    and optionally sends a direct SMS or email if a target is provided.
    """
    subject = f"[UptimeWatch {status.upper()}] Incident Alert: {monitor_name}"
    body = (
        f"🚨 UptimeWatch Watchdog Alert\n"
        f"----------------------------------------\n"
        f"Monitor : {monitor_name}\n"
        f"Status  : {status.upper()}\n"
        f"Details : {message}\n"
        f"CloudWatch Event Dispatched via AWS SNS."
    )

    if aws_manager.simulation_mode:
        logger.info(f"[Simulation] Published SNS alert for {monitor_name}: {status}")
        return "msg-simulated-sns-id-98765"

    msg_id = None
    try:
        topic_arn = get_config("sns_topic_arn")
        response = aws_manager.sns.publish(
            TopicArn=topic_arn,
            Subject=subject[:100],  # SNS Subject max 100 chars
            Message=body
        )
        msg_id = response.get("MessageId", "unknown")
        logger.info(f"Published alert to SNS Topic {topic_arn} (MessageId: {msg_id})")
    except Exception as e:
        logger.error(f"Failed to publish to SNS Topic for {monitor_name}: {e}")

    # If notification_target is a phone number, send direct SMS
    if notification_target and any(c.isdigit() for c in notification_target) and "@" not in notification_target:
        clean_phone = notification_target.strip()
        if not clean_phone.startswith("+"):
            clean_phone = f"+91{clean_phone}" if len(clean_phone) == 10 else f"+{clean_phone}"
        try:
            sms_res = aws_manager.sns.publish(
                PhoneNumber=clean_phone,
                Message=f"[UptimeWatch ALERT] {monitor_name} is {status.upper()}: {message[:100]}"
            )
            logger.info(f"Published direct SMS to {clean_phone} (MessageId: {sms_res.get('MessageId')})")
        except Exception as e:
            logger.warning(f"Failed to send direct SMS to {clean_phone}: {e}")

    return msg_id or "dispatched"


def send_direct_sms(phone_number: str, message: str) -> str:
    """Dispatches a direct SMS message using AWS SNS."""
    clean_phone = phone_number.strip()
    if not clean_phone.startswith("+"):
        clean_phone = f"+91{clean_phone}" if len(clean_phone) == 10 else f"+{clean_phone}"

    if aws_manager.simulation_mode:
        logger.info(f"[Simulation] Direct SMS to {clean_phone}: {message}")
        return "msg-simulated-sms-id-77777"

    try:
        response = aws_manager.sns.publish(
            PhoneNumber=clean_phone,
            Message=f"[UptimeWatch] {message}",
            MessageAttributes={
                "AWS.SNS.SMS.SMSType": {
                    "DataType": "String",
                    "StringValue": "Transactional"
                }
            }
        )
        msg_id = response.get("MessageId", "unknown")
        logger.info(f"Direct SMS sent to {clean_phone} (MessageId: {msg_id})")
        return msg_id
    except Exception as e:
        logger.error(f"Failed to send direct SMS to {clean_phone}: {e}")
        raise


def upload_report_to_s3(report_filename: str, report_data: bytes, content_type: str = "application/json") -> str:
    """Uploads an availability report to the private S3 bucket."""
    if aws_manager.simulation_mode:
        logger.info(f"[Simulation] Uploaded report {report_filename} ({len(report_data)} bytes) to S3")
        return f"s3://uptimewatch-reports-bucket-local/{report_filename}"

    try:
        bucket_name = get_config("s3_bucket_name")
        aws_manager.s3.put_object(
            Bucket=bucket_name,
            Key=report_filename,
            Body=report_data,
            ContentType=content_type,
            ServerSideEncryption="AES256"
        )
        s3_uri = f"s3://{bucket_name}/{report_filename}"
        logger.info(f"Report uploaded successfully to {s3_uri}")
        return s3_uri
    except Exception as e:
        logger.error(f"Failed to upload report '{report_filename}' to S3: {e}")
        raise


if __name__ == "__main__":
    import sys
    if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    print("\n[*] Testing UptimeWatch AWS Connection Module...")
    print(f"  - Current APP_ENV       : {APP_ENV}")
    print(f"  - Simulation Mode Active: {aws_manager.simulation_mode}")
    print(f"  - Resolved db_url       : {sanitize_value('db_url', get_config('db_url'))}")
    print(f"  - Resolved sqs_queue_url: {get_config('sqs_queue_url')}")
    print(f"  - Resolved sns_topic_arn: {get_config('sns_topic_arn')}")
    print(f"  - Resolved s3_bucket_name: {get_config('s3_bucket_name')}")
    
    # Test high level methods in simulation mode
    sample_msg_id = dispatch_health_check_to_sqs(1, "https://college-portal.edu")
    sample_alert_id = publish_sns_alert("api.mycollege.edu", "DOWN", "HTTP 502 Bad Gateway")
    sample_s3_uri = upload_report_to_s3("sample-report.json", b'{"status": "ok"}')
    print("[SUCCESS] All UptimeWatch AWS helper calls completed cleanly!")
