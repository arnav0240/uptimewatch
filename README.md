# UptimeWatch — Cloud-Native Availability Monitoring & Alerting Platform

UptimeWatch is a website availability monitoring and alerting platform featuring a FastAPI backend, SQLAlchemy ORM, background synthetic health check worker, and a React + Vite dashboard.

---

## Architecture Overview (Phase 2 Local Implementation)

```
                     ┌────────────────────────────────────────┐
                     │          React + Vite Frontend         │
                     │          (http://localhost:5173)       │
                     └───────────────────┬────────────────────┘
                                         │ Reverse Proxy (/api)
                                         ▼
                     ┌────────────────────────────────────────┐
                     │          FastAPI REST API              │
                     │          (http://localhost:8000)       │
                     └─────────┬──────────────────────┬───────┘
                               │                      │
                               ▼                      ▼
┌──────────────────────────────────────┐    ┌───────────────────────────────────┐
│       Background Worker Daemon       │    │        Database Layer             │
│    (Polls active monitors at cadence)│───▶│  (SQLite local / PostgreSQL RDS)  │
└──────────────────────────────────────┘    └───────────────────────────────────┘
```

- **Frontend**: React 19 + Vite + Tailwind CSS + Recharts + Lucide Icons.
- **Backend API**: FastAPI with Pydantic request/response validation schemas, CORS configuration, and Swagger/OpenAPI docs.
- **Database Layer**: SQLAlchemy 2.0 with connection pooling, foreign keys, cascade deletes, and indexing. Default: SQLite (`uptimewatch.db`); Production-ready for AWS RDS via `DATABASE_URL`.
- **Monitoring Engine**: HTTP/HTTPS check probe measuring latency, evaluating thresholds, detecting failures/timeouts/connection errors, and tracking incidents with automatic recovery.
- **Worker Daemon**: Standalone background process with graceful shutdown (`Ctrl+C`), polling monitors based on their check interval.

---

## Quickstart Guide (Windows PowerShell)

Open PowerShell in the project directory (`C:\Users\ARNAV BRAHMANE\OneDrive\Desktop\CCL\MINIPROJECT`):

### 1. Create and Activate Virtual Environment

```powershell
# Create Python virtual environment
python -m venv .venv

# Enable script execution if restricted (run once if needed)
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# Activate virtual environment
.venv\Scripts\Activate.ps1
```

### 2. Install Dependencies

```powershell
# Install backend Python dependencies
pip install -r requirements.txt

# Install frontend Node dependencies (if not already installed)
npm install
```

### 3. Configure Local Environment Variables

```powershell
# Copy the example environment file
Copy-Item .env.example .env
```

Ensure `.env` contains:
```env
APP_ENV=local
SIMULATION_MODE=true
DATABASE_URL=sqlite:///./uptimewatch.db
PORT=8000
```

---

## Running the Application

For full operation, run the **FastAPI Backend**, the **Monitoring Worker**, and the **React Frontend** in separate terminal windows.

### Terminal 1: Start FastAPI Backend

```powershell
.venv\Scripts\Activate.ps1
uvicorn backend.main:app --reload --port 8000
```
- API Base: `http://localhost:8000`
- Swagger UI Docs: `http://localhost:8000/docs`
- ReDoc Docs: `http://localhost:8000/redoc`

### Terminal 2: Start Monitoring Worker

```powershell
.venv\Scripts\Activate.ps1

# Continuous polling daemon
python backend/worker.py

# Or run a single check pass across all due monitors:
python backend/worker.py --once
```

### Terminal 3: Start React Frontend

```powershell
npm run dev
```
- Frontend Dashboard: `http://localhost:5173`
- Vite dev server automatically proxies `/api/*` to `http://localhost:8000/api/*`.

---

## Running Automated Tests

Run the complete test suite (endpoints, schemas, URL security, database persistence, timeout handling, incidents, and worker):

```powershell
.venv\Scripts\Activate.ps1
pytest tests/ -v
```

To build the frontend for production:
```powershell
npm run build
```

---

## Implemented API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status, database engine, and uptime |
| `GET` | `/api/dashboard` | Aggregated KPIs (uptime %, avg latency, checks, active incidents, 24h history) |
| `GET` | `/api/monitors` | List all registered monitors with recent status & latency |
| `POST` | `/api/monitors` | Register a new monitor and trigger an immediate health probe |
| `GET` | `/api/monitors/{id}` | Retrieve monitor details and recent check history |
| `DELETE` | `/api/monitors/{id}` | Delete a monitor and cascade-delete its checks and incidents |
| `GET` | `/api/monitors/{id}/history` | Paginated chronological check results for a monitor |
| `GET` | `/api/alerts` | List active and recent incidents / recovery events |
| `GET` | `/api/telemetry` | CloudWatch / SQS telemetry endpoint (labeled simulation mode in Phase 2) |

---

## Database Schema

The database uses SQLAlchemy models defined in `backend/models.py`:

1. **`monitors`**:
   - `id` (INTEGER, Primary Key)
   - `name` (VARCHAR(100), Indexed)
   - `url` (VARCHAR(500))
   - `interval` (INTEGER, default 60s)
   - `latency_threshold` (INTEGER, default 500ms)
   - `status` (VARCHAR(20), UP / DOWN / DEGRADED / PENDING)
   - `last_response_time` (INTEGER, ms)
   - `last_checked_at` (DATETIME)
   - `notification_email` (VARCHAR(255), optional)
   - `created_at` (DATETIME)

2. **`monitoring_checks`**:
   - `id` (INTEGER, Primary Key)
   - `monitor_id` (INTEGER, Foreign Key `monitors.id`, ON DELETE CASCADE)
   - `status_code` (INTEGER, HTTP status or 0 on network error)
   - `response_time_ms` (INTEGER)
   - `result_status` (VARCHAR(20), UP / DOWN / DEGRADED)
   - `error_details` (TEXT, error message or null)
   - `checked_at` (DATETIME, Indexed)

3. **`incidents`**:
   - `id` (INTEGER, Primary Key)
   - `monitor_id` (INTEGER, Foreign Key `monitors.id`, ON DELETE CASCADE)
   - `incident_type` (VARCHAR(50), OUTAGE / DEGRADED)
   - `status` (VARCHAR(20), OPEN / RESOLVED)
   - `error_details` (TEXT)
   - `started_at` (DATETIME)
   - `resolved_at` (DATETIME, null while open)

---

## Distinction Between Local and AWS Functionality

| Capability | Local Development (Phase 2) | Future AWS Cloud Deployment (Phase 3+) |
|---|---|---|
| **API Runtime** | Local Uvicorn server (`http://localhost:8000`) | FastAPI on Amazon EC2 / ECS behind Application Load Balancer |
| **Database** | SQLite file (`uptimewatch.db`) | Amazon RDS PostgreSQL Multi-AZ cluster |
| **Worker Execution** | Local polling loop (`python backend/worker.py`) | Distributed worker fleet consuming Amazon SQS FIFO queues |
| **Alerting** | In-app incident tracking & toast feedback | Amazon SNS topics dispatching SMS, Email, and Lambda webhooks |
| **Telemetry** | Explicitly labeled simulated metrics (`/api/telemetry`) | Live Amazon CloudWatch alarms, CPU, memory, and SQS queue depths |
| **Reporting** | Local mock report generation | Daily SLA reports archived in Amazon S3 Parquet / CSV buckets |
