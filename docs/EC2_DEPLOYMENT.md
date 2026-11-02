# UptimeWatch — Complete EC2 Deployment Guide

This guide explains how to deploy the entire **UptimeWatch** application (FastAPI backend, background synthetic health check worker, SQLite/PostgreSQL database, and React + Vite frontend via Nginx) onto an **Amazon EC2** instance.

---

## 🏗️ Architecture on Amazon EC2

```
                           [ Internet Users / Browser ]
                                        │
                                        ▼  Port 80 (HTTP)
                    ┌───────────────────────────────────────┐
                    │          Nginx Reverse Proxy          │
                    └───────────┬───────────────────────┬───┘
                                │                       │
            Static Assets       │                       │  Proxy /api/*
            (React + Vite)      │                       ▼
                                │             ┌───────────────────┐
                                ▼             │  FastAPI Backend  │
                        /opt/uptimewatch/dist │   (Port 8000)     │
                                              └─────────┬─────────┘
                                                        │
                                                        ▼
                                              ┌───────────────────┐
                                              │  Database Layer   │
                                              │ (SQLite / RDS PG) │
                                              └─────────▲─────────┘
                                                        │
                                              ┌─────────┴─────────┐
                                              │ Background Worker │
                                              │  (Systemd Daemon) │
                                              └───────────────────┘
```

---

## ⚡ Option 1: Automated 1-Click Deployment via Python

We provide a turnkey deployment script [`aws/deploy_ec2.py`](../aws/deploy_ec2.py) that automatically:
1. Configures the EC2 Security Group (`uptimewatch-ec2-sg`) with inbound rules on **Port 22 (SSH)**, **Port 80 (HTTP)**, and **Port 8000**.
2. Resolves the latest official **Amazon Linux 2023** AMI.
3. Automatically attaches the appropriate IAM role (`LabInstanceProfile` in AWS Academy or `UptimeWatch-EC2-Role`).
4. Boots the instance with cloud-init [`aws/ec2_user_data.sh`](../aws/ec2_user_data.sh) which installs Python 3, Node.js, Nginx, builds the frontend, and enables systemd daemons.

### Step 1: Ensure AWS Credentials are Active
If you are using **AWS Academy / Vocareum Learner Lab**:
1. Open your AWS Academy / Vocareum portal.
2. Click **Start Lab** (ensure the indicator circle is **Green**).
3. Click **AWS Details** ➔ **AWS CLI**.
4. Copy the block and paste it into `~/.aws/credentials`:
   ```ini
   [default]
   aws_access_key_id=ASIA...
   aws_secret_access_key=...
   aws_session_token=IQoJ...
   ```

### Step 2: Run the Deployment Script
```powershell
.venv\Scripts\Activate.ps1
python aws/deploy_ec2.py
```

The script will launch the instance and print:
```
======================================================================
🚀 UPTIMEWATCH EC2 DEPLOYMENT SUCCESSFUL!
======================================================================
  • Instance ID : i-0abc12345def6789a
  • State       : running
  • Public IP   : 54.210.xx.xx
  • Public DNS  : ec2-54-210-xx-xx.compute-1.amazonaws.com

🌐 Live Application Access:
  • Web Dashboard : http://54.210.xx.xx
  • REST API Docs : http://54.210.xx.xx/docs
  • API Health    : http://54.210.xx.xx/api/health
======================================================================
```

---

## 🖥️ Option 2: Manual Deployment via AWS Management Console

If you prefer using the AWS Management Console:

### Step 1: Launch EC2 Instance
1. Go to **EC2 Console** ➔ **Instances** ➔ **Launch an instance**.
2. **Name**: `UptimeWatch-Server`.
3. **Application and OS Images**: **Amazon Linux 2023 AMI** (Free Tier eligible).
4. **Instance type**: `t2.micro` or `t3.micro`.
5. **Key pair**: Select an existing key pair or create one.
6. **Network settings**:
   - Check **Allow SSH traffic from anywhere (0.0.0.0/0)**.
   - Check **Allow HTTP traffic from the internet (0.0.0.0/0)**.
   - Add a Custom TCP rule for Port `8000` (optional for direct API access).
7. **Advanced Details**:
   - **IAM instance profile**: Select `LabInstanceProfile` (if in AWS Academy) or `UptimeWatch-EC2-Role`.
   - **User data**: Paste the entire contents of [`aws/ec2_user_data.sh`](../aws/ec2_user_data.sh).
8. Click **Launch instance**.

---

## 🔍 Verifying & Managing the Deployment on EC2

Once the EC2 instance is running, connect via SSH or EC2 Instance Connect:

```bash
# Check the deployment progress
tail -f /var/log/uptimewatch-bootstrap.log

# Check the FastAPI Backend service
sudo systemctl status uptimewatch-api

# Check the Background Monitoring Worker service
sudo systemctl status uptimewatch-worker

# Check Nginx status
sudo systemctl status nginx

# View real-time worker logs
sudo journalctl -u uptimewatch-worker -f
```

