"""
UptimeWatch Database Connection Layer
=====================================
Configures SQLAlchemy engine, session factory, and database lifecycle.
Automatically resolves live AWS RDS PostgreSQL database from AWS SSM Parameter Store
or environment, with seamless fallback to SQLite.
"""

import os
import logging

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

logger = logging.getLogger("UptimeWatch-Database")

# 1. Check environment variables
raw_db_url = os.getenv("DATABASE_URL") or os.getenv("DB_URL")

# 2. Try loading from live AWS SSM Parameter Store if not set in environment
if not raw_db_url:
    try:
        from aws_client import aws_manager, get_config
        if not aws_manager.simulation_mode:
            raw_db_url = get_config("db_url")
    except Exception as e:
        logger.warning(f"Could not load db_url from SSM: {e}")

# 3. Fallback to local SQLite if still not set
if not raw_db_url:
    raw_db_url = "sqlite:///./uptimewatch.db"

if raw_db_url.startswith("postgres://"):
    raw_db_url = raw_db_url.replace("postgres://", "postgresql+psycopg2://", 1)
elif raw_db_url.startswith("postgresql://") and not raw_db_url.startswith("postgresql+"):
    raw_db_url = raw_db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

DATABASE_URL = raw_db_url

# Configure connection args & engine
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False
    engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
else:
    # PostgreSQL with pool configuration
    try:
        engine = create_engine(DATABASE_URL, pool_size=10, max_overflow=20, pool_pre_ping=True)
        with engine.connect() as conn:
            pass
        logger.info("Successfully connected to live AWS RDS PostgreSQL database.")
    except Exception as err:
        logger.error(f"Failed to initialize PostgreSQL engine: {err}. Falling back to SQLite.")
        DATABASE_URL = "sqlite:///./uptimewatch.db"
        connect_args["check_same_thread"] = False
        engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency yielding a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Idempotently initializes all database tables without dropping existing data."""
    from backend import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
