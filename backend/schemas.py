"""
UptimeWatch Pydantic Schemas
============================
Defines request and response schemas for validation, serialization,
and Swagger documentation.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from urllib.parse import urlparse
from pydantic import BaseModel, Field, field_validator, ConfigDict, AliasChoices


class MonitorBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, description="Friendly monitor name or domain")
    url: str = Field(..., max_length=500, description="Target endpoint URL (HTTP/HTTPS)")
    interval: int = Field(60, ge=10, le=3600, description="Check frequency in seconds (10 to 3600)")
    latency_threshold: int = Field(500, validation_alias=AliasChoices("latency_threshold", "threshold"), ge=10, le=10000, description="Latency threshold in ms for degraded status")
    notification_email: Optional[str] = Field(None, max_length=255, description="Alert destination email")
    user_id: Optional[int] = Field(None, description="Owning user ID")

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        url_str = v.strip()
        parsed = urlparse(url_str)
        if parsed.scheme.lower() not in ("http", "https"):
            raise ValueError("Invalid URL scheme. Only 'http://' and 'https://' endpoints are supported.")
        if not parsed.netloc:
            raise ValueError("Invalid URL. Target must contain a valid hostname or domain.")
        return url_str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        name_str = v.strip()
        if not name_str:
            raise ValueError("Monitor name cannot be empty.")
        return name_str


class MonitorCreate(MonitorBase):
    pass


class MonitorResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[int] = None
    name: str
    url: str
    interval: int
    latency_threshold: int
    status: str
    latency_ms: Optional[int] = None
    uptime_pct: float = 100.0
    error_message: Optional[str] = None
    last_checked_at: Optional[datetime] = None
    created_at: datetime
    featured: bool = False


class MonitoringCheckResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    monitor_id: int
    http_status: Optional[int] = None
    response_time_ms: int
    status: str
    error_details: Optional[str] = None
    checked_at: datetime


class IncidentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    monitor_id: int
    monitor_name: Optional[str] = None
    incident_type: str
    status: str
    message: Optional[str] = None
    started_at: datetime
    resolved_at: Optional[datetime] = None
    timeFormatted: Optional[str] = None


class DashboardResponse(BaseModel):
    global_uptime: float
    avg_latency: int
    total_checks: int
    active_incidents: int
    history_24h: List[Dict[str, Any]]
    total_monitors: int
    up_monitors: int
    down_monitors: int
    degraded_monitors: int


class TelemetryResponse(BaseModel):
    is_simulated: bool
    disclaimer: str
    ec2_instance_id: Optional[str] = None
    ec2_type: Optional[str] = None
    region: Optional[str] = None
    cpu_usage: Optional[float] = None
    memory_usage: Optional[float] = None
    sqs_messages_visible: Optional[int] = None
    sqs_messages_in_flight: Optional[int] = None
    sqs_queue_name: Optional[str] = None
    rds_active_connections: Optional[int] = None
    rds_iops: Optional[int] = None
    rds_engine: Optional[str] = None
    sns_topics_active: Optional[int] = None
    sns_subscriptions: Optional[int] = None
    lambda_invocations_24h: Optional[int] = None


class HealthResponse(BaseModel):
    status: str
    database: str
    app_env: str
    simulation_mode: bool


class UserRegister(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=6, max_length=100)
    role: str = Field("user", description="user or developer")
    developer_secret: Optional[str] = None
    captcha_id: Optional[str] = None
    captcha_answer: Optional[str] = None


class UserLogin(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=1)
    two_factor_code: Optional[str] = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    role: str
    created_at: datetime


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class CaptchaResponse(BaseModel):
    captcha_id: str
    question: str


class SocialLoginRequest(BaseModel):
    provider: str = Field("google", description="google, github, or facebook")
    email: str = Field(..., max_length=255)
    name: str = Field(..., max_length=100)
    avatar_url: Optional[str] = None
    role: Optional[str] = Field("user", description="user or developer")


class TestNotificationRequest(BaseModel):
    target: str = Field(..., description="Phone number with country code (+91...) or email address")
    channel: str = Field("all", description="sms, email, or all")
    message: Optional[str] = None
