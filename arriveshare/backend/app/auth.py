"""
Authentication Module
=====================
Simple JWT auth with mock OTP verification.
In dev mode, OTP is always "1234".
"""

from datetime import datetime, timedelta, timezone
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
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
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
        sub = payload.get("sub")
        if sub is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_id = int(sub)
    except (JWTError, ValueError):
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


from .services.email import is_demo_email, generate_otp, send_verification_email


@router.post("/register", response_model=UserResponse)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """Register a new user account."""
    # Check for existing email or phone
    existing = db.query(User).filter(
        (User.email == user_data.email) | (User.phone == user_data.phone)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email or phone already registered")

    is_demo = is_demo_email(user_data.email)
    otp = MOCK_OTP if is_demo else generate_otp(6)

    user = User(
        name=user_data.name,
        email=user_data.email,
        phone=user_data.phone,
        role=user_data.role,
        otp_code=otp,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    if not is_demo:
        send_verification_email(user.email, user.name, otp)

    return user


@router.post("/send-otp")
def send_otp(data: OTPRequest, db: Session = Depends(get_db)):
    """Send OTP to user: mock OTP for demo users, real email for new users."""
    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_demo = is_demo_email(user.email)
    if is_demo:
        user.otp_code = MOCK_OTP
        hint = "Use 1234 in dev mode (Demo account)"
    else:
        otp = generate_otp(6)
        user.otp_code = otp
        send_verification_email(user.email, user.name, otp)
        hint = "Verification code sent to your email"

    db.commit()
    return {
        "message": f"OTP sent to {data.email}",
        "hint": hint,
        "is_demo": is_demo,
    }


@router.post("/verify-otp", response_model=Token)
def verify_otp(data: OTPVerify, db: Session = Depends(get_db)):
    """Verify OTP and return a JWT access token."""
    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_demo = is_demo_email(user.email)
    if data.otp != user.otp_code and not (is_demo and data.otp == MOCK_OTP):
        raise HTTPException(status_code=400, detail="Invalid OTP")

    user.verified = True
    user.otp_code = None
    db.commit()

    token = create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Get the currently authenticated user's profile."""
    return current_user
