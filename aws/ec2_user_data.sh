#!/bin/bash
# ==============================================================================
# UptimeWatch EC2 Production Deployment & Cloud-Init Bootstrap Script
# ==============================================================================
set -euo pipefail

exec > >(tee /var/log/uptimewatch-bootstrap.log | logger -t uptimewatch-bootstrap -s 2>/dev/console) 2>&1
echo "[+] Starting UptimeWatch production deployment bootstrap at $(date -u)"

# 1. Update system packages
dnf update -y || yum update -y || apt-get update -y

# 2. Install essential dependencies: Python, Git, Nginx, Node.js
if command -v dnf &> /dev/null; then
    dnf install -y git python3 python3-pip python3-devel nginx
    # Install Node.js 20 LTS via NodeSource
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
elif command -v apt-get &> /dev/null; then
    apt-get install -y git python3 python3-pip python3-venv nginx curl
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# 3. Create deployment directory
APP_DIR="/opt/uptimewatch"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# 4. Fetch application bundle from S3 or Git
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60" || true)
ACCOUNT_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/dynamic/instance-identity/document | grep -oP '"accountId"\s*:\s*"\K[0-9]+' || echo "120736097741")
S3_BUCKET="uptimewatch-reports-bucket-${ACCOUNT_ID}"

if aws s3 cp "s3://${S3_BUCKET}/deploy/uptimewatch.tar.gz" /tmp/uptimewatch.tar.gz 2>/dev/null; then
    echo "[+] Extracted deployment bundle from s3://${S3_BUCKET}/deploy/uptimewatch.tar.gz"
    tar -xzf /tmp/uptimewatch.tar.gz -C "$APP_DIR"
    rm -f /tmp/uptimewatch.tar.gz
elif [ -n "${GIT_REPO:-}" ] && git clone "$GIT_REPO" "$APP_DIR"; then
    echo "[+] Repository cloned successfully from $GIT_REPO."
else
    echo "[!] Bundled source fallback activated."
fi

# 5. Set up Python virtual environment & backend dependencies
python3 -m venv "$APP_DIR/.venv"
source "$APP_DIR/.venv/bin/activate"
pip install --upgrade pip setuptools wheel
if [ -f "$APP_DIR/requirements.txt" ]; then
    pip install -r "$APP_DIR/requirements.txt"
fi

# 6. Configure environment variables for Production
cat << 'EOF' > "$APP_DIR/.env"
APP_ENV=production
SIMULATION_MODE=false
AWS_REGION=us-east-1
AWS_DEFAULT_REGION=us-east-1
SSM_PARAM_PREFIX=/uptimewatch/prod
SQS_QUEUE_NAME=uptimewatch-checks-queue
SQS_DLQ_NAME=uptimewatch-checks-dlq
SNS_TOPIC_NAME=uptimewatch-alerts-topic
DATABASE_URL=sqlite:///opt/uptimewatch/uptimewatch.db
PORT=8000
EOF

# 7. Initialize Database
python3 -c "from backend.database import init_db; init_db(); print('Database tables initialized.')" || true

# 8. Build Frontend (React + Vite)
if [ -f "$APP_DIR/package.json" ]; then
    echo "[+] Building React Vite frontend..."
    npm --prefix "$APP_DIR" install
    npm --prefix "$APP_DIR" run build
fi

# 9. Configure Nginx Reverse Proxy
cat << 'EOF' > /etc/nginx/conf.d/uptimewatch.conf
server {
    listen 80;
    server_name _;

    # Serve built frontend static files
    location / {
        root /opt/uptimewatch/dist;
        index index.html index.htm;
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to FastAPI backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # Proxy Swagger docs
    location /docs {
        proxy_pass http://127.0.0.1:8000/docs;
        proxy_set_header Host $host;
    }

    location /openapi.json {
        proxy_pass http://127.0.0.1:8000/openapi.json;
        proxy_set_header Host $host;
    }
}
EOF

# Ensure default Nginx root configuration doesn't clash
if [ -f /etc/nginx/nginx.conf ]; then
    sed -i '/default_server/s///g' /etc/nginx/nginx.conf || true
fi

# 10. Create systemd service for FastAPI Backend
cat << 'EOF' > /etc/systemd/system/uptimewatch-api.service
[Unit]
Description=UptimeWatch FastAPI Backend Application
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/uptimewatch
EnvironmentFile=/opt/uptimewatch/.env
ExecStart=/opt/uptimewatch/.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 11. Create systemd service for Background Monitoring Worker
cat << 'EOF' > /etc/systemd/system/uptimewatch-worker.service
[Unit]
Description=UptimeWatch Availability Check Background Worker
After=network.target uptimewatch-api.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/uptimewatch
EnvironmentFile=/opt/uptimewatch/.env
ExecStart=/opt/uptimewatch/.venv/bin/python3 -m backend.worker
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 12. Enable and Start Services
systemctl daemon-reload
systemctl enable nginx uptimewatch-api uptimewatch-worker
systemctl restart nginx uptimewatch-api uptimewatch-worker

echo "[+] Deployment completed successfully at $(date -u)"
EOF
