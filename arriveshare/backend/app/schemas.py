"""
Pydantic Schemas
================
Request and response models for the API layer.
Separate from ORM models to keep validation and serialization clean.
"""

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


# ── Auth ──────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    name: str
    email: str
    phone: str
    role: str = "passenger"


class OTPRequest(BaseModel):
    email: str


class OTPVerify(BaseModel):
    email: str
    otp: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    phone: str
    role: str
    verified: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Stations ──────────────────────────────────────────────────────────

class StationResponse(BaseModel):
    id: int
    name: str
    type: str
    latitude: float
    longitude: float
    city: str

    model_config = ConfigDict(from_attributes=True)


# ── Ride Requests ─────────────────────────────────────────────────────

class RideRequestCreate(BaseModel):
    station_id: int
    dest_lat: float
    dest_lng: float
    dest_name: str
    arrival_time: datetime
    flight_train_number: Optional[str] = None
    ride_type: str = "shared"      # solo | shared


class RideRequestResponse(BaseModel):
    id: int
    user_id: int
    station_id: int
    dest_lat: float
    dest_lng: float
    dest_name: str
    arrival_time: datetime
    flight_train_number: Optional[str] = None
    ride_type: str
    status: str
    group_id: Optional[int] = None
    solo_fare: Optional[float] = None
    shared_fare: Optional[float] = None
    savings_pct: Optional[float] = None
    drop_order: Optional[int] = None
    created_at: datetime
    user: Optional[UserResponse] = None
    station: Optional[StationResponse] = None

    model_config = ConfigDict(from_attributes=True)


class RideStatusUpdate(BaseModel):
    status: str


# ── Ride Groups ───────────────────────────────────────────────────────

class DriverBrief(BaseModel):
    id: int
    vehicle_number: str
    vehicle_model: str
    seats: int
    user: Optional[UserResponse] = None

    model_config = ConfigDict(from_attributes=True)


class GroupResponse(BaseModel):
    id: int
    station_id: int
    driver_id: Optional[int] = None
    status: str
    total_distance_km: Optional[float] = None
    total_fare: Optional[float] = None
    capacity: int
    created_at: datetime
    ride_requests: List[RideRequestResponse] = []
    station: Optional[StationResponse] = None
    driver: Optional[DriverBrief] = None

    model_config = ConfigDict(from_attributes=True)


# ── Matching ──────────────────────────────────────────────────────────

class CoTraveler(BaseModel):
    """Minimal info shown to co-travelers (safety: first name only)."""
    first_name: str
    verified: bool
    dest_name: str
    drop_order: int


class MatchResult(BaseModel):
    group_id: int
    co_travelers: List[CoTraveler]
    dropoff_order: List[dict]       # [{order, dest_name, lat, lng}]
    total_route_km: float
    solo_fare: float
    shared_fare: float
    savings_pct: float
    message: str                    # e.g. "You save 42%!"


# ── Driver ────────────────────────────────────────────────────────────

class DriverResponse(BaseModel):
    id: int
    user_id: int
    vehicle_number: str
    vehicle_model: str
    seats: int
    available: bool
    current_lat: Optional[float] = None
    current_lng: Optional[float] = None
    user: Optional[UserResponse] = None

    model_config = ConfigDict(from_attributes=True)


class DriverAssignment(BaseModel):
    group: GroupResponse
    stops: List[dict]               # ordered stops with lat/lng/name
    total_earnings: float


# ── Trip Share (Safety) ───────────────────────────────────────────────

class TripShareCreate(BaseModel):
    contact_name: str
    contact_phone: str


class TripShareResponse(BaseModel):
    id: int
    ride_request_id: int
    contact_name: str
    contact_phone: str
    shared_at: datetime

    model_config = ConfigDict(from_attributes=True)
