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
    TIME_WINDOW_MINUTES: int = 20       # Default arrival time window (± mins)
    DEFAULT_MATCH_WINDOW_MINUTES: int = 20  # Rider flexible wait window
    DETOUR_THRESHOLD_KM: float = 3.0    # Legacy threshold fallback
    MAX_DETOUR_PCT: float = 0.30        # Max detour as a fraction of solo distance (30%)
    MAX_DETOUR_KM: float = 6.0          # Absolute upper cap on detour in km
    CAB_CAPACITY: int = 4               # Max passengers per cab
    ACCEPT_WINDOW_SECONDS: int = 120    # 2 minutes to accept formed group
    BACKGROUND_MATCH_INTERVAL_SECONDS: int = 20  # Periodic background matching interval
    DEMO_MODE: bool = True              # Demo mode flag for quick-login & test tools

    # External services
    OSRM_BASE_URL: str = "https://router.project-osrm.org"
    OSRM_TIMEOUT_SECONDS: float = 3.0   # Timeout for OSRM queries before haversine fallback

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
