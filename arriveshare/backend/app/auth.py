"""
Authentication Module
=====================
Simple JWT auth with mock OTP verification.
In dev mode, OTP is always "1234".
"""

from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User
from .schemas import UserCreate, OTPRequest, OTPVerify, Token, UserResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

# Mock OTP for development — always "1234"
MOCK_OTP = "1234"


def create_access_token(data: dict) -> str:
    """Create a JWT token with expiration."""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency: extract and validate the current user from JWT."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    try:
        payload = jwt.decode(
            credentials.credentials, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        user_id: int = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Like get_current_user but returns None instead of raising if unauthenticated."""
    if credentials is None:
        return None
    try:
        return get_current_user(credentials, db)
    except HTTPException:
        return None


@router.post("/register", response_model=UserResponse)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """Register a new user account."""
    # Check for existing email or phone
    existing = db.query(User).filter(
        (User.email == user_data.email) | (User.phone == user_data.phone)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email or phone already registered")

    user = User(
        name=user_data.name,
        email=user_data.email,
        phone=user_data.phone,
        role=user_data.role,
        otp_code=MOCK_OTP,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/send-otp")
def send_otp(data: OTPRequest, db: Session = Depends(get_db)):
    """Send a mock OTP to the user's email (always '1234' in dev)."""
    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.otp_code = MOCK_OTP
    db.commit()
    return {"message": f"OTP sent to {data.email}", "hint": "Use 1234 in dev mode"}


@router.post("/verify-otp", response_model=Token)
def verify_otp(data: OTPVerify, db: Session = Depends(get_db)):
    """Verify OTP and return a JWT access token."""
    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.otp_code != data.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")

    user.verified = True
    user.otp_code = None
    db.commit()

    token = create_access_token({"sub": user.id})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Get the currently authenticated user's profile."""
    return current_user
