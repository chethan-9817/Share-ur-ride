"""
Authentication Endpoints
========================
Endpoints for user registration, mock OTP request/verification, and profile retrieval.
Adheres to the planned repository routes structure.
"""

from ..auth import (
    router,
    create_access_token,
    get_current_user,
    get_optional_user,
    MOCK_OTP,
)

__all__ = [
    "router",
    "create_access_token",
    "get_current_user",
    "get_optional_user",
    "MOCK_OTP",
]
