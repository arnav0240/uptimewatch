"""
UptimeWatch Monitoring Engine & Worker Test Suite
=================================================
Tests HTTP health checking, timeout/connection error resilience,
latency threshold degradation, and incident lifecycle transitions.
All HTTP calls are deterministically mocked.
"""

import os
import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta
import requests

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Set test environment
os.environ["APP_ENV"] = "development"
os.environ["SIMULATION_MODE"] = "true"

from backend.database import Base
from backend.models import Monitor, MonitoringCheck, Incident
from backend.monitoring import execute_http_check, process_monitor_check, compute_uptime_pct
from backend.worker import run_worker_pass

TEST_DB_URL = "sqlite:///:memory:"
test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


class TestMonitoringEngine(unittest.TestCase):

    def setUp(self):
        Base.metadata.drop_all(bind=test_engine)
        Base.metadata.create_all(bind=test_engine)
        self.db = TestingSession()

    def tearDown(self):
        self.db.close()

    @patch("requests.get")
    def test_successful_http_check(self, mock_get):
        """HTTP 200 response within latency threshold records status UP."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        status, elapsed_ms, http_status, error_details = execute_http_check(
            url="https://api.example.com/health",
            timeout_sec=5.0,
            latency_threshold_ms=500
        )

        self.assertEqual(status, "UP")
        self.assertEqual(http_status, 200)
        self.assertIsNone(error_details)
        self.assertGreaterEqual(elapsed_ms, 0)

    @patch("requests.get")
    def test_timeout_handling(self, mock_get):
        """Request timeout marks monitor as DOWN with clear error details."""
        mock_get.side_effect = requests.exceptions.Timeout("Read timeout after 5s")

        status, elapsed_ms, http_status, error_details = execute_http_check(
            url="https://slow-api.example.com",
            timeout_sec=5.0,
            latency_threshold_ms=500
        )

        self.assertEqual(status, "DOWN")
        self.assertIsNone(http_status)
        self.assertIn("Connection timed out", error_details)

    @patch("requests.get")
    def test_connection_error_handling(self, mock_get):
        """DNS failure or connection refused marks monitor as DOWN."""
        mock_get.side_effect = requests.exceptions.ConnectionError("Failed to resolve host")

        status, elapsed_ms, http_status, error_details = execute_http_check(
            url="https://non-existent-domain.internal",
            timeout_sec=5.0,
            latency_threshold_ms=500
        )

        self.assertEqual(status, "DOWN")
        self.assertIsNone(http_status)
        self.assertIn("Connection refused or DNS resolution failed", error_details)

    @patch("backend.monitoring.time.perf_counter")
    @patch("requests.get")
    def test_latency_threshold_handling(self, mock_get, mock_perf):
        """HTTP 200 taking longer than threshold marks monitor as DEGRADED."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        # Simulate 850ms elapsed time (start at 10.0, end at 10.85)
        mock_perf.side_effect = [10.0, 10.85]

        status, elapsed_ms, http_status, error_details = execute_http_check(
            url="https://heavy-query.example.com",
            timeout_sec=5.0,
            latency_threshold_ms=500
        )

        self.assertEqual(status, "DEGRADED")
        self.assertEqual(http_status, 200)
        self.assertEqual(elapsed_ms, 850)
        self.assertIn("exceeded threshold", error_details)

    @patch("backend.monitoring.execute_http_check")
    def test_incident_creation_and_recovery(self, mock_check):
        """
        Tests full incident lifecycle:
        1. Down check -> creates single OPEN incident.
        2. Subsequent Down check -> does NOT duplicate open incident.
        3. Recovery UP check -> resolves open incident.
        """
        monitor = Monitor(name="Billing API", url="https://billing.example.com", interval=30, latency_threshold=400)
        self.db.add(monitor)
        self.db.commit()
        self.db.refresh(monitor)

        # 1. First failure
        mock_check.return_value = ("DOWN", 120, 502, "HTTP 502 Bad Gateway")
        process_monitor_check(self.db, monitor)

        open_incidents = self.db.query(Incident).filter(Incident.monitor_id == monitor.id, Incident.status == "OPEN").all()
        self.assertEqual(len(open_incidents), 1)
        self.assertEqual(open_incidents[0].incident_type, "OUTAGE")
        self.assertEqual(monitor.status, "DOWN")

        # 2. Second failure - should NOT duplicate incident
        mock_check.return_value = ("DOWN", 115, 502, "HTTP 502 Bad Gateway")
        process_monitor_check(self.db, monitor)

        all_incidents = self.db.query(Incident).filter(Incident.monitor_id == monitor.id).all()
        self.assertEqual(len(all_incidents), 1, "Expected exactly 1 incident record, no duplicates")

        # 3. Recovery check
        mock_check.return_value = ("UP", 95, 200, None)
        process_monitor_check(self.db, monitor)

        open_incidents = self.db.query(Incident).filter(Incident.monitor_id == monitor.id, Incident.status == "OPEN").all()
        self.assertEqual(len(open_incidents), 0, "Expected open incident to be marked RESOLVED")

        resolved_inc = self.db.query(Incident).filter(Incident.monitor_id == monitor.id).first()
        self.assertEqual(resolved_inc.status, "RESOLVED")
        self.assertIsNotNone(resolved_inc.resolved_at)
        self.assertEqual(monitor.status, "UP")

    @patch("backend.monitoring.execute_http_check")
    def test_worker_run_pass_without_aws(self, mock_check):
        """Worker checks due monitors without requiring AWS credentials."""
        mock_check.return_value = ("UP", 60, 200, None)

        # Add 2 monitors: one due (never checked), one recently checked (not due)
        due_mon = Monitor(name="Due Monitor", url="https://due.com", interval=60)
        not_due_mon = Monitor(
            name="Recent Monitor",
            url="https://recent.com",
            interval=300,
            last_checked_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=10)
        )
        self.db.add_all([due_mon, not_due_mon])
        self.db.commit()

        checks_processed = run_worker_pass(self.db)
        self.assertEqual(checks_processed, 1, "Only due monitors should be processed")


if __name__ == "__main__":
    unittest.main()
