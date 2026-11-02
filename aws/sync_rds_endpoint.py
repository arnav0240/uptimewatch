#!/usr/bin/env python3
"""
Sync RDS PostgreSQL Endpoint and Credentials with AWS SSM Parameter Store
- Waits until uptimewatch-db status is 'available'
- Sets a known secure master password and immediately saves the complete DB_URL
  to SSM Parameter Store (/uptimewatch/prod/db_url) as a SecureString
"""
import os
import sys
import time
import secrets
import string

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

import boto3
from botocore.exceptions import ClientError

REGION = "us-east-1"
DB_IDENTIFIER = "uptimewatch-db"
DB_NAME = "uptimewatch"
MASTER_USER = "postgres"

def generate_secure_password(length=24):
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))

def main():
    session = boto3.Session(region_name=REGION)
    rds = session.client("rds")
    ssm = session.client("ssm")

    print(f"[*] Checking status of Amazon RDS instance '{DB_IDENTIFIER}'...")
    try:
        desc = rds.describe_db_instances(DBInstanceIdentifier=DB_IDENTIFIER)
        instance = desc["DBInstances"][0]
        status = instance["DBInstanceStatus"]
    except ClientError as e:
        print(f"FATAL: Could not find RDS instance: {e}")
        sys.exit(1)

    while status != "available":
        print(f"    Status: '{status}'. Waiting for RDS instance to become 'available' (polling in 15s)...")
        time.sleep(15)
        desc = rds.describe_db_instances(DBInstanceIdentifier=DB_IDENTIFIER)
        instance = desc["DBInstances"][0]
        status = instance["DBInstanceStatus"]

    if status == "available":
        endpoint = instance.get("Endpoint", {}).get("Address")
        port = instance.get("Endpoint", {}).get("Port", 5432)
        print(f"✓ RDS Instance is available!")
        print(f"  • Endpoint: {endpoint}:{port}")

        # Check if master password already exists in SSM
        existing_pwd = None
        try:
            param = ssm.get_parameter(Name="/uptimewatch/prod/db_master_password", WithDecryption=True)
            existing_pwd = param["Parameter"]["Value"]
        except ClientError:
            pass

        if not existing_pwd:
            new_password = generate_secure_password()
            print("  • Updating master password on RDS instance...")
            rds.modify_db_instance(
                DBInstanceIdentifier=DB_IDENTIFIER,
                MasterUserPassword=new_password,
                ApplyImmediately=True
            )
            ssm.put_parameter(
                Name="/uptimewatch/prod/db_master_password",
                Description="UptimeWatch RDS Master Database Password",
                Value=new_password,
                Type="SecureString",
                Overwrite=True
            )
            existing_pwd = new_password
            print("  ✓ Master password synchronized with SSM Parameter Store.")

        # Construct and seed full database URL into SSM
        db_url = f"postgresql://{MASTER_USER}:{existing_pwd}@{endpoint}:{port}/{DB_NAME}"
        ssm.put_parameter(
            Name="/uptimewatch/prod/db_url",
            Description="UptimeWatch PostgreSQL production connection string",
            Value=db_url,
            Type="SecureString",
            Overwrite=True
        )
        print("✓ Full production DB_URL securely seeded into /uptimewatch/prod/db_url!")

if __name__ == "__main__":
    main()
