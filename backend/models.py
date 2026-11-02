"""
UptimeWatch Database Models
===========================
Defines persistent database schemas for Monitors, Checks, and Incidents.
Includes foreign keys, cascade deletes, and query indexes.
"""

from datetime import datetime, timezone

def get_utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)
from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    ForeignKey,
    Index
)
from sqlalchemy.orm import relationship
from backend.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="user")  # "user" or "developer"
    created_at = Column(DateTime, nullable=False, default=get_utc_now)


class Monitor(Base):
    __tablename__ = "monitors"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(String(100), nullable=False)
    url = Column(String(500), nullable=False)
    interval = Column(Integer, nullable=False, default=60)  # Polling interval in seconds
    latency_threshold = Column(Integer, nullable=False, default=500)  # Degraded threshold in ms
    status = Column(String(20), nullable=False, default="PENDING", index=True)  # PENDING, UP, DOWN, DEGRADED
    last_response_time = Column(Integer, nullable=True)  # Latency in ms
    last_checked_at = Column(DateTime, nullable=True, index=True)
    notification_email = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, default=get_utc_now)

    # Cascade delete checks and incidents when a monitor is removed
    checks = relationship(
        "MonitoringCheck",
        back_populates="monitor",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="desc(MonitoringCheck.checked_at)"
    )
    incidents = relationship(
        "Incident",
        back_populates="monitor",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="desc(Incident.started_at)"
    )


class MonitoringCheck(Base):
    __tablename__ = "monitoring_checks"

    id = Column(Integer, primary_key=True, index=True)
    monitor_id = Column(
        Integer,
        ForeignKey("monitors.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    http_status = Column(Integer, nullable=True)
    response_time_ms = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, index=True)  # UP, DOWN, DEGRADED
    error_details = Column(Text, nullable=True)
    checked_at = Column(DateTime, nullable=False, default=get_utc_now, index=True)

    monitor = relationship("Monitor", back_populates="checks")

    __table_args__ = (
        Index("idx_checks_monitor_checked_at", "monitor_id", "checked_at"),
    )


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)
    monitor_id = Column(
        Integer,
        ForeignKey("monitors.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    incident_type = Column(String(50), nullable=False)  # OUTAGE, LATENCY_WARNING
    status = Column(String(20), nullable=False, default="OPEN", index=True)  # OPEN, RESOLVED
    error_details = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=False, default=get_utc_now, index=True)
    resolved_at = Column(DateTime, nullable=True)

    monitor = relationship("Monitor", back_populates="incidents")

    __table_args__ = (
        Index("idx_incidents_monitor_status", "monitor_id", "status"),
    )
