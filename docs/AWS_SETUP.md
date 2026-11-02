# UptimeWatch — AWS Production Setup & Deployment Guide

This guide provides the exact step-by-step instructions for establishing secure, least-privilege AWS access for **UptimeWatch** in your AWS account (`us-east-1`).

---

## 🔒 Security Principles Followed

1. **No Root Access Keys:** Your AWS root account remains strictly for console management and billing alerts.
2. **Instance Profile Authentication:** The EC2 instance running UptimeWatch uses an IAM Role with temporary STS credentials—no static access keys or secrets stored on disk.
3. **Strict Least Privilege:** Permissions are restricted to `us-east-1`, specific resource names, and enforced by `aws:ResourceAccount: ${aws:PrincipalAccount}` to prevent cross-account leakage.
4. **Free Tier Protection:** 30-day lifecycle expiration rules on S3 and 30-day retention policies on CloudWatch Logs prevent persistent storage accumulation.

---

## Step 1: Pre-create the CloudWatch Log Group

Because the runtime IAM policy removes `logs:CreateLogGroup` to prevent unauthorized administrative resource creation at runtime, the Log Group **must exist before the application starts**.

### Console Steps:
1. Open the [AWS Management Console](https://console.aws.amazon.com/) in region **US East (N. Virginia) `us-east-1`**.
2. In the top search bar, type **CloudWatch** and select it.
3. In the left navigation menu, expand **Logs** and click **Log groups**.
4. Click the orange **Create log group** button.
5. Fill in the fields:
   * **Log group name:** `/uptimewatch/prod`
   * **Retention setting:** Select **30 days (1 month)** *(essential to stay within Free Tier limits)*.
   * **KMS key ARN:** Leave blank (uses default AWS-managed encryption).
6. Click **Create**.

*(Note: If you run `aws_setup.py`, it will also automatically and idempotently create this log group with the 30-day retention policy).*

---

## Step 2: Create the IAM Policy (`UptimeWatch-Runtime-Policy`)

### Console Steps:
1. In the AWS Management Console search bar, type **IAM** and select it.
2. In the left navigation menu, click **Policies**.
3. Click the blue **Create policy** button.
4. In the Policy editor, click the **JSON** tab (top right of the editor).
5. Delete the default placeholder text and paste the complete content of [`aws/iam_policies.json`](../aws/iam_policies.json):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SQSProcessingAccess",
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl"
      ],
      "Resource": [
        "arn:aws:sqs:us-east-1:*:uptimewatch-checks-queue",
        "arn:aws:sqs:us-east-1:*:uptimewatch-checks-dlq"
      ],
      "Condition": {
        "StringEquals": {
          "aws:ResourceAccount": "${aws:PrincipalAccount}"
        }
      }
    },
    {
      "Sid": "SNSPublishAlerts",
      "Effect": "Allow",
      "Action": [
        "sns:Publish",
        "sns:GetTopicAttributes"
      ],
      "Resource": "arn:aws:sns:us-east-1:*:uptimewatch-alerts-topic",
      "Condition": {
        "StringEquals": {
          "aws:ResourceAccount": "${aws:PrincipalAccount}"
        }
      }
    },
    {
      "Sid": "S3ReportBucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::uptimewatch-reports-bucket-*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceAccount": "${aws:PrincipalAccount}"
        }
      }
    },
    {
      "Sid": "S3ReportObjectOperations",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::uptimewatch-reports-bucket-*/*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceAccount": "${aws:PrincipalAccount}"
        }
      }
    },
    {
      "Sid": "SSMParameterReadOnly",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      "Resource": "arn:aws:ssm:us-east-1:*:parameter/uptimewatch/prod/*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceAccount": "${aws:PrincipalAccount}"
        }
      }
    },
    {
      "Sid": "CloudWatchLogsStreaming",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:DescribeLogStreams",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:*:log-group:/uptimewatch/*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceAccount": "${aws:PrincipalAccount}"
        }
      }
    },
    {
      "Sid": "CloudWatchCustomMetrics",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "cloudwatch:namespace": "UptimeWatch"
        }
      }
    }
  ]
}
```

6. Click **Next** at the bottom of the page.
7. Under **Policy details**:
   * **Policy name:** `UptimeWatch-Runtime-Policy`
   * **Description:** `Least-privilege runtime policy for UptimeWatch EC2 monitoring instance (SQS, SNS, S3, SSM, Logs, Metrics in us-east-1).`
8. Click the blue **Create policy** button.

---

## Step 3: Create the IAM Role (`UptimeWatch-EC2-Role`)

This role attaches to the EC2 instance so that boto3 automatically retrieves short-lived temporary credentials from the EC2 Instance Metadata Service (IMDSv2).

### Console Steps:
1. In IAM, click **Roles** in the left navigation menu.
2. Click the blue **Create role** button.
3. Under **Trusted entity type**, select **AWS service**.
4. Under **Use case**, select **EC2** (Allows EC2 instances to call AWS services on your behalf).
5. Click **Next**.
6. On the **Add permissions** screen, search for: `UptimeWatch-Runtime-Policy`.
7. Check the checkbox next to `UptimeWatch-Runtime-Policy`.
8. Click **Next**.
9. Under **Role details**:
   * **Role name:** `UptimeWatch-EC2-Role`
   * **Description:** `EC2 instance profile role granting UptimeWatch monitoring worker and backend access to AWS services.`
10. Click **Create role**.

---

## Step 4: Run Automated Cloud Resource Provisioning (`aws_setup.py`)

Once you are ready to provision the actual SQS queues, SNS topic, S3 bucket, and CloudWatch log group:

1. **Pre-flight Validation (Dry Run):**
   ```bash
   python aws_setup.py --dry-run
   ```
   *Validates credentials and prints planned actions without creating any resources.*

2. **Idempotent Resource Provisioning:**
   ```bash
   python aws_setup.py
   ```
   *Creates:*
   * SQS Queue: `uptimewatch-checks-queue` + Dead-Letter Queue `uptimewatch-checks-dlq` (with redrive policy maxReceiveCount: 5)
   * SNS Topic: `uptimewatch-alerts-topic`
   * S3 Bucket: `uptimewatch-reports-bucket-<ACCOUNT_ID>` (with AES256, 4-point Block Public Access, and 30-day lifecycle expiration)
   * CloudWatch Log Group: `/uptimewatch/prod` (with 30-day retention policy)
   * SSM Parameter Store: `/uptimewatch/prod/*` configuration parameters

---

## 📋 Resource Reference Matrix

| Service | Resource Name / ARN Pattern | Free Tier Allocation | Security Guardrail |
| :--- | :--- | :--- | :--- |
| **SQS** | `uptimewatch-checks-queue`, `uptimewatch-checks-dlq` | 1,000,000 requests/month free | DLQ redrive policy (maxReceiveCount: 5) |
| **SNS** | `uptimewatch-alerts-topic` | 1,000,000 publishes & 1,000 emails/mo | Single topic restricted to alerts |
| **S3** | `uptimewatch-reports-bucket-<ACCOUNT_ID>` | 5 GB storage, 20,000 GETs, 2,000 PUTs | AES256 encryption, Block Public Access, 30-day lifecycle rule |
| **CloudWatch Logs** | `/uptimewatch/prod` | 5 GB ingestion & archive free | Explicit 30-day retention to prevent storage costs |
| **CloudWatch Metrics** | Namespace `UptimeWatch` | 10 custom metrics free | Restricted strictly to `UptimeWatch` namespace |
| **SSM Parameter Store** | `/uptimewatch/prod/*` | Standard parameters are free | Encrypted SecureString for database URLs |
