"""
UptimeWatch Background Monitoring Worker
========================================
Separately runnable polling daemon that continuously evaluates due monitors,
dispatches synthetic health checks, and persists results.
Supports --once flag for isolated execution and automated testing.
"""

import os
import sys
import time
import signal
import argparse
import logging
import concurrent.futures
from datetime import datetime, timezone, timedelta

from backend.database import SessionLocal, init_db
from backend.models import Monitor
from backend.monitoring import process_monitor_check, execute_http_check

# Optional AWS client integration
try:
    from aws_client import aws_manager, dispatch_health_check_to_sqs
    AWS_CLIENT_AVAILABLE = True
except Exception:
    AWS_CLIENT_AVAILABLE = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] (UptimeWatch-Worker) %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("UptimeWatch-Worker")

# Flag for graceful shutdown
_running = True


def _handle_shutdown(signum, frame):
    global _running
    logger.info("Shutdown signal received. Finishing active checks and exiting gracefully...")
    _running = False


signal.signal(signal.SIGINT, _handle_shutdown)
signal.signal(signal.SIGTERM, _handle_shutdown)


def _probe_worker(args_tuple):
    """Worker helper for concurrent HTTP probing."""
    monitor_id, url, threshold = args_tuple
    try:
        result = execute_http_check(url=url, timeout_sec=5.0, latency_threshold_ms=threshold)
        return monitor_id, result
    except Exception as e:
        logger.error(f"Probing error for monitor #{monitor_id} ({url}): {e}")
        return monitor_id, ("DOWN", 0, None, f"Probing exception: {str(e)[:120]}")


def run_worker_pass(db) -> int:
    """
    Executes a single monitoring pass over all active monitors that are due for polling.
    Runs HTTP checks concurrently to prevent a single slow/unreachable site from stalling others.
    Persists check results sequentially to protect SQLite database integrity.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    monitors = db.query(Monitor).all()
    
    due_monitors = [
        m for m in monitors
        if m.last_checked_at is None
        or (now - m.last_checked_at) >= timedelta(seconds=max(m.interval, 5))
    ]

    if not due_monitors:
        return 0

    # 1. Concurrently probe due monitors without blocking
    probe_results = {}
    max_workers = min(len(due_monitors), 10)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        probe_tasks = [
            (m.id, m.url, m.latency_threshold)
            for m in due_monitors
        ]
        for monitor_id, check_res in executor.map(_probe_worker, probe_tasks):
            probe_results[monitor_id] = check_res

    # 2. Sequentially record results to DB
    checks_count = 0
    for monitor in due_monitors:
        if not _running:
            break
        result = probe_results.get(monitor.id)
        if not result:
            continue
        try:
            check = process_monitor_check(db=db, monitor=monitor, check_result=result)
            checks_count += 1
            logger.info(
                f"✓ Check #{check.id} for '{monitor.name}': {check.status} "
                f"({check.response_time_ms}ms, HTTP {check.http_status or 'N/A'})"
            )

            # Modular AWS SQS dispatch telemetry
            if AWS_CLIENT_AVAILABLE:
                try:
                    dispatch_health_check_to_sqs(monitor.id, monitor.url)
                except Exception as sqs_err:
                    logger.warning(f"Could not enqueue SQS message for monitor #{monitor.id}: {sqs_err}")

        except Exception as e:
            logger.error(f"Error persisting check for monitor #{monitor.id} ({monitor.name}): {e}", exc_info=True)

    return checks_count


def start_worker(poll_interval_sec: float = 5.0, run_once: bool = False):
    """Starts the background worker loop."""
    logger.info("Initializing UptimeWatch monitoring worker...")
    init_db()

    if run_once:
        logger.info("Executing single monitoring pass (--once)...")
        with SessionLocal() as db:
            count = run_worker_pass(db)
        logger.info(f"Single pass completed. Processed {count} due check(s). Exiting.")
        return count

    logger.info(f"Starting continuous polling loop (cadence: {poll_interval_sec}s). Press Ctrl+C to stop.")
    try:
        while _running:
            try:
                with SessionLocal() as db:
                    run_worker_pass(db)
            except Exception as e:
                logger.error(f"Unexpected error in worker loop: {e}", exc_info=True)

            # Responsive sleep for clean Ctrl+C shutdown
            steps = int(max(poll_interval_sec, 1.0) * 10)
            for _ in range(steps):
                if not _running:
                    break
                time.sleep(0.1)
    except KeyboardInterrupt:
        logger.info("Ctrl+C received. Exiting.")

    logger.info("Monitoring worker stopped.")


if __name__ == "__main__":
    env_interval = float(os.getenv("WORKER_POLL_INTERVAL", "5.0"))
    parser = argparse.ArgumentParser(description="UptimeWatch Background Monitoring Worker")
    parser.add_argument("--once", action="store_true", help="Execute one pass across all due monitors and exit")
    parser.add_argument("--interval", type=float, default=env_interval, help="Polling loop sleep interval in seconds")
    args = parser.parse_args()

    start_worker(poll_interval_sec=args.interval, run_once=args.once)

