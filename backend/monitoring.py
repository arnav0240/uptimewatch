"""
UptimeWatch Monitoring Engine
=============================
Performs resilient HTTP/HTTPS health checks, measures latency,
detects status transitions, and manages incident lifecycle idempotently.
"""

import time
import logging
from datetime import datetime, timezone, timedelta
from typing import Tuple, Optional
from urllib.parse import urlparse
import requests

from sqlalchemy.orm import Session
from backend.models import Monitor, MonitoringCheck, Incident

logger = logging.getLogger("UptimeWatch-Monitoring")

# Safe user-agent identifying UptimeWatch synthetic probes
USER_AGENT = "UptimeWatch-Canary/1.0 (+https://uptimewatch.internal)"


def execute_http_check(
    url: str,
    timeout_sec: float = 10.0,
    latency_threshold_ms: int = 500
) -> Tuple[str, int, Optional[int], Optional[str]]:
    """
    Sends an HTTP GET request to the target URL and measures response time.
    
    Returns:
        tuple: (status, response_time_ms, http_status_code, error_details)
        status values: 'UP', 'DOWN', 'DEGRADED'
    """
    # 1. Scheme security validation
    parsed = urlparse(url.strip())
    if parsed.scheme.lower() not in ("http", "https"):
        return "DOWN", 0, None, f"Unsupported scheme '{parsed.scheme}'. Only HTTP/HTTPS allowed."
    if not parsed.netloc:
        return "DOWN", 0, None, "Invalid URL: missing hostname or domain."

    start_time = time.perf_counter()
    headers = {"User-Agent": USER_AGENT}

    try:
        connect_timeout = min(3.0, timeout_sec)
        read_timeout = max(1.0, timeout_sec)
        response = requests.get(
            url,
            timeout=(connect_timeout, read_timeout),
            headers=headers,
            allow_redirects=True
        )
        elapsed_ms = round((time.perf_counter() - start_time) * 1000)
        status_code = response.status_code

        # Server error (5xx)
        if status_code >= 500:
            return "DOWN", elapsed_ms, status_code, f"HTTP {status_code} Server Error"

        # Client error (4xx)
        if status_code >= 400:
            return "DOWN", elapsed_ms, status_code, f"HTTP {status_code} Client Error"

        # Latency check (threshold exceeded)
        if elapsed_ms > latency_threshold_ms:
            return (
                "DEGRADED",
                elapsed_ms,
                status_code,
                f"Response time {elapsed_ms}ms exceeded threshold ({latency_threshold_ms}ms)"
            )

        # Successful check
        return "UP", elapsed_ms, status_code, None

    except requests.exceptions.Timeout:
        elapsed_ms = round((time.perf_counter() - start_time) * 1000)
        return "DOWN", elapsed_ms, None, f"Connection timed out after {timeout_sec}s"

    except requests.exceptions.SSLError as e:
        elapsed_ms = round((time.perf_counter() - start_time) * 1000)
        return "DOWN", elapsed_ms, None, f"SSL/TLS Certificate verification failed: {e.__class__.__name__}"

    except requests.exceptions.ConnectionError:
        elapsed_ms = round((time.perf_counter() - start_time) * 1000)
        return "DOWN", elapsed_ms, None, "Connection refused or DNS resolution failed"

    except requests.exceptions.RequestException as e:
        elapsed_ms = round((time.perf_counter() - start_time) * 1000)
        return "DOWN", elapsed_ms, None, f"Request failed: {str(e)[:150]}"


def process_monitor_check(
    db: Session,
    monitor: Monitor,
    timeout_sec: float = 10.0,
    check_result: Optional[Tuple[str, int, Optional[int], Optional[str]]] = None
) -> MonitoringCheck:
    """
    Executes a health check for the given monitor, saves the check record,
    updates monitor status, and manages incident transitions without duplicates.
    Optionally accepts pre-computed `check_result` for concurrent worker execution.
    """
    if check_result is None:
        status, elapsed_ms, http_status, error_details = execute_http_check(
            url=monitor.url,
            timeout_sec=timeout_sec,
            latency_threshold_ms=monitor.latency_threshold
        )
    else:
        status, elapsed_ms, http_status, error_details = check_result

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Record check entry
    check = MonitoringCheck(
        monitor_id=monitor.id,
        http_status=http_status,
        response_time_ms=elapsed_ms,
        status=status,
        error_details=error_details,
        checked_at=now
    )
    db.add(check)

    monitor.status = status
    monitor.last_response_time = elapsed_ms
    monitor.last_checked_at = now

    # ==============================================================
    # State Transition & Incident Management
    # ==============================================================
    if status == "DOWN":
        # Resolve any open warning incidents superseded by outage
        open_warnings = (
            db.query(Incident)
            .filter(
                Incident.monitor_id == monitor.id,
                Incident.incident_type == "LATENCY_WARNING",
                Incident.status == "OPEN"
            )
            .all()
        )
        for w in open_warnings:
            w.status = "RESOLVED"
            w.resolved_at = now

        # Check if an open OUTAGE incident already exists
        existing_outage = (
            db.query(Incident)
            .filter(
                Incident.monitor_id == monitor.id,
                Incident.incident_type == "OUTAGE",
                Incident.status == "OPEN"
            )
            .first()
        )
        if not existing_outage:
            logger.warning(f"🚨 OUTAGE Incident detected for '{monitor.name}' ({monitor.url}): {error_details}")
            incident = Incident(
                monitor_id=monitor.id,
                incident_type="OUTAGE",
                status="OPEN",
                error_details=error_details or "Monitor is unreachable",
                started_at=now
            )
            db.add(incident)
            try:
                from aws_client import publish_sns_alert
                publish_sns_alert(monitor.name, "DOWN", error_details or "Monitor is unreachable", notification_target=monitor.notification_email)
            except Exception as e:
                logger.warning(f"Failed to dispatch SNS alert for {monitor.name}: {e}")

    elif status == "DEGRADED":
        # Check if an open warning already exists
        existing_warning = (
            db.query(Incident)
            .filter(
                Incident.monitor_id == monitor.id,
                Incident.status == "OPEN"
            )
            .first()
        )
        if not existing_warning:
            logger.info(f"⚠️ Latency threshold exceeded for '{monitor.name}': {elapsed_ms}ms")
            incident = Incident(
                monitor_id=monitor.id,
                incident_type="LATENCY_WARNING",
                status="OPEN",
                error_details=error_details,
                started_at=now
            )
            db.add(incident)
            try:
                from aws_client import publish_sns_alert
                publish_sns_alert(monitor.name, "DEGRADED", error_details or f"Latency exceeded threshold ({elapsed_ms}ms)", notification_target=monitor.notification_email)
            except Exception as e:
                logger.warning(f"Failed to dispatch SNS warning for {monitor.name}: {e}")

    elif status == "UP":
        # Monitor is healthy: resolve any open incidents for this monitor
        open_incidents = (
            db.query(Incident)
            .filter(
                Incident.monitor_id == monitor.id,
                Incident.status == "OPEN"
            )
            .all()
        )
        if open_incidents:
            for inc in open_incidents:
                inc.status = "RESOLVED"
                inc.resolved_at = now
                logger.info(f"✅ Incident #{inc.id} RESOLVED for '{monitor.name}' (Service is UP).")
            try:
                from aws_client import publish_sns_alert
                publish_sns_alert(monitor.name, "RECOVERED", f"Service has recovered and is UP ({elapsed_ms}ms, HTTP {http_status or 200})", notification_target=monitor.notification_email)
            except Exception as e:
                logger.warning(f"Failed to dispatch SNS recovery alert for {monitor.name}: {e}")

    db.commit()
    db.refresh(check)
    return check


def compute_uptime_pct(db: Session, monitor_id: int, hours: int = 24) -> float:
    """Calculates the uptime percentage for a monitor over the specified lookback window."""
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)
    checks = (
        db.query(MonitoringCheck.status)
        .filter(
            MonitoringCheck.monitor_id == monitor_id,
            MonitoringCheck.checked_at >= since
        )
        .all()
    )

    if not checks:
        return 100.0

    total = len(checks)
    up_count = sum(1 for c in checks if c.status in ("UP", "DEGRADED"))
    return round((up_count / total) * 100.0, 2)
