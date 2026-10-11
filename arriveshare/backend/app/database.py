"""
Database Setup
==============
SQLAlchemy engine and session factory.
Uses SQLite for MVP; swap to PostgreSQL by changing DATABASE_URL in .env.
"""

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from .config import settings
SQLALCHEMY_DATABASE_URL = settings.DATABASE_URL

# SQLite needs check_same_thread=False for FastAPI's async workers.
# PostgreSQL doesn't need this flag, so we conditionally add it.
connect_args = {}
if "sqlite" in SQLALCHEMY_DATABASE_URL:
    connect_args["check_same_thread"] = False

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args=connect_args)

# Enable WAL mode and busy timeout for concurrent SQLite reads/writes
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    if "sqlite" in SQLALCHEMY_DATABASE_URL:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA busy_timeout=5000;")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI dependency that provides a DB session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
