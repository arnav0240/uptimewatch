"""
UptimeWatch Automated API Test Suite
====================================
Tests FastAPI routes: /api/health, /api/dashboard, /api/monitors, /api/alerts, /api/telemetry.
Uses an isolated in-memory SQLite database.
"""

import os
import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Set test environment
os.environ["APP_ENV"] = "development"
os.environ["SIMULATION_MODE"] = "true"

from backend.database import Base, get_db
from backend.main import app

# Create in-memory SQLite database for isolated testing
TEST_DATABASE_URL = "sqlite:///:memory:"
test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


class TestFastAPIEndpoints(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=test_engine)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        Base.metadata.drop_all(bind=test_engine)

    def setUp(self):
        # Clear tables between tests
        Base.metadata.drop_all(bind=test_engine)
        Base.metadata.create_all(bind=test_engine)

    def test_health_endpoint(self):
        """GET /api/health returns 200 and healthy database status."""
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["database"], "connected")
        self.assertIn("simulation_mode", data)

    def test_empty_dashboard_response(self):
        """GET /api/dashboard with empty database does not crash and returns valid baseline."""
        response = self.client.get("/api/dashboard")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("global_uptime", data)
        self.assertIn("avg_latency", data)
        self.assertIn("total_checks", data)
        self.assertEqual(data["total_monitors"], 0)
        self.assertEqual(data["active_incidents"], 0)
        self.assertIsInstance(data["history_24h"], list)

    def test_create_and_get_monitor(self):
        """POST /api/monitors persists a new monitor and GET /api/monitors lists it."""
        payload = {
            "name": "Auth Service",
            "url": "https://auth.mycompany.internal/health",
            "interval": 30,
            "latency_threshold": 400
        }
        create_res = self.client.post("/api/monitors", json=payload)
        self.assertEqual(create_res.status_code, 201)
        created = create_res.json()
        self.assertEqual(created["name"], "Auth Service")
        self.assertEqual(created["interval"], 30)
        monitor_id = created["id"]

        # Get list
        list_res = self.client.get("/api/monitors")
        self.assertEqual(list_res.status_code, 200)
        monitors = list_res.json()
        self.assertEqual(len(monitors), 1)
        self.assertEqual(monitors[0]["id"], monitor_id)

        # Get single monitor
        single_res = self.client.get(f"/api/monitors/{monitor_id}")
        self.assertEqual(single_res.status_code, 200)
        self.assertEqual(single_res.json()["name"], "Auth Service")

    def test_invalid_url_rejection(self):
        """POST /api/monitors rejects non-HTTP schemes and malformed URLs."""
        invalid_payloads = [
            {"name": "FTP Monitor", "url": "ftp://ftp.example.com/file"},
            {"name": "File Monitor", "url": "file:///etc/passwd"},
            {"name": "Bad Scheme", "url": "javascript:alert(1)"},
            {"name": "No Domain", "url": "https://"},
            {"name": "Short Interval", "url": "https://valid.com", "interval": 2},  # min 10s
        ]

        for payload in invalid_payloads:
            res = self.client.post("/api/monitors", json=payload)
            self.assertEqual(res.status_code, 422, f"Expected 422 for payload: {payload}")

    def test_delete_monitor(self):
        """DELETE /api/monitors/{id} deletes the monitor and cascades."""
        payload = {"name": "Temp Monitor", "url": "https://temp.org"}
        create_res = self.client.post("/api/monitors", json=payload)
        self.assertEqual(create_res.status_code, 201)
        mon_id = create_res.json()["id"]

        del_res = self.client.delete(f"/api/monitors/{mon_id}")
        self.assertEqual(del_res.status_code, 200)

        # Confirm 404 on subsequent get
        get_res = self.client.get(f"/api/monitors/{mon_id}")
        self.assertEqual(get_res.status_code, 404)

    def test_telemetry_endpoint_explicit_simulation_label(self):
        """GET /api/telemetry explicitly identifies simulated metrics in local development."""
        res = self.client.get("/api/telemetry")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["is_simulated"])
        self.assertIn("Local Simulation Mode", data["disclaimer"])
        self.assertEqual(data["sqs_queue_name"], "uptimewatch-checks-queue")

    def test_monitor_history_endpoint(self):
        """GET /api/monitors/{id}/history retrieves check records for a monitor or 404 if missing."""
        # Create monitor
        payload = {"name": "History API Test", "url": "https://api-test.internal"}
        create_res = self.client.post("/api/monitors", json=payload)
        self.assertEqual(create_res.status_code, 201)
        mon_id = create_res.json()["id"]

        # Fetch history for the new monitor
        hist_res = self.client.get(f"/api/monitors/{mon_id}/history")
        self.assertEqual(hist_res.status_code, 200)
        history = hist_res.json()
        self.assertIsInstance(history, list)

        # 404 for non-existent monitor
        missing_res = self.client.get("/api/monitors/999999/history")
        self.assertEqual(missing_res.status_code, 404)

    def test_auth_captcha_register_login(self):
        """Tests captcha challenge generation, user registration, and login flow."""
        # 1. Fetch Captcha
        captcha_res = self.client.get("/api/auth/captcha")
        self.assertEqual(captcha_res.status_code, 200)
        cdata = captcha_res.json()
        self.assertIn("captcha_id", cdata)
        self.assertIn("Security Verification", cdata["question"])

        # 2. Register user
        reg_payload = {
            "name": "Arnav Admin",
            "email": "arnav.admin@test.com",
            "password": "Password123!",
            "role": "developer"
        }
        reg_res = self.client.post("/api/auth/register", json=reg_payload)
        self.assertEqual(reg_res.status_code, 200)
        rdata = reg_res.json()
        self.assertIn("access_token", rdata)
        self.assertEqual(rdata["user"]["role"], "developer")

        # 3. Login user with 2-step verification code
        login_payload = {
            "email": "arnav.admin@test.com",
            "password": "Password123!",
            "two_factor_code": "123456"
        }
        login_res = self.client.post("/api/auth/login", json=login_payload)
        self.assertEqual(login_res.status_code, 200)
        ldata = login_res.json()
        self.assertIn("access_token", ldata)
        self.assertEqual(ldata["user"]["email"], "arnav.admin@test.com")

    def test_developer_aws_budget_endpoint(self):
        """GET /api/developer/aws-budget returns live AWS budget and service status."""
        res = self.client.get("/api/developer/aws-budget")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["budget_limit_usd"], 5.00)
        self.assertEqual(data["remaining_budget_usd"], 5.00)
        self.assertIsInstance(data["services"], list)
        self.assertTrue(len(data["services"]) >= 4)

    def test_social_login_google_and_github(self):
        """POST /api/auth/social-login successfully registers/authenticates Google/GitHub users."""
        payload = {
            "provider": "google",
            "name": "Arnav Brahmane",
            "email": "arnav.brahmane@gmail.com",
            "role": "developer"
        }
        res = self.client.post("/api/auth/social-login", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("access_token", data)
        self.assertTrue(data["access_token"].startswith("utw_social_google_"))
        self.assertEqual(data["user"]["email"], "arnav.brahmane@gmail.com")
        self.assertEqual(data["user"]["role"], "developer")


if __name__ == "__main__":
    unittest.main()
