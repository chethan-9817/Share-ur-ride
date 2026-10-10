"""
Application Configuration
=========================
All settings are loaded from environment variables (.env file).
No hardcoded secrets — every tunable parameter is configurable.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from .env file."""

    # Database
    DATABASE_URL: str = "sqlite:///./arriveshare.db"

    # JWT Auth
    SECRET_KEY: str = "arriveshare-dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # Fare configuration (INR)
    BASE_FARE: float = 50.0       # Base fare charged once per trip
    RATE_PER_KM: float = 12.0     # Per-kilometer rate

    # Matching engine
    TIME_WINDOW_MINUTES: int = 20       # Max time diff between arrivals to match
    DETOUR_THRESHOLD_KM: float = 3.0    # Max detour to add a passenger's destination
    MAX_DETOUR_KM: float = 5.0          # Absolute max detour any single passenger tolerates
    CAB_CAPACITY: int = 4               # Max passengers per cab

    # External services
    OSRM_BASE_URL: str = "https://router.project-osrm.org"

    # SMTP Email Configuration
    SMTP_ENABLED: bool = False
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = "no-reply@arriveshare.com"
    SMTP_FROM_NAME: str = "ArriveShare"
    SMTP_USE_TLS: bool = True

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
