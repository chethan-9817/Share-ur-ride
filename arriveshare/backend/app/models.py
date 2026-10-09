"""
SQLAlchemy ORM Models
=====================
Six tables covering users, stations, ride requests, ride groups, drivers,
and trip-share safety records. Schema is PostgreSQL-compatible.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base


class User(Base):
    """A passenger or driver account."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    phone = Column(String, unique=True, index=True, nullable=False)
    role = Column(String, nullable=False, default="passenger")   # passenger | driver
    verified = Column(Boolean, default=False)
    otp_code = Column(String, nullable=True)                     # mock OTP for dev
    created_at = Column(DateTime, default=datetime.utcnow)

    ride_requests = relationship("RideRequest", back_populates="user")
    driver_profile = relationship("Driver", back_populates="user", uselist=False)


class Station(Base):
    """An airport or railway station — the pickup origin."""
    __tablename__ = "stations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)       # airport | railway
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    city = Column(String, nullable=False)

    ride_requests = relationship("RideRequest", back_populates="station")
    ride_groups = relationship("RideGroup", back_populates="station")


class RideGroup(Base):
    """
    A group of passengers sharing one cab.
    Links passengers (via ride_requests), a driver, and the origin station.
    """
    __tablename__ = "ride_groups"

    id = Column(Integer, primary_key=True, index=True)
    station_id = Column(Integer, ForeignKey("stations.id"), nullable=False)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=True)
    status = Column(String, default="forming")        # forming | confirmed | on_trip | completed
    total_distance_km = Column(Float, nullable=True)
    total_fare = Column(Float, nullable=True)
    capacity = Column(Integer, default=4)
    created_at = Column(DateTime, default=datetime.utcnow)

    station = relationship("Station", back_populates="ride_groups")
    driver = relationship("Driver", back_populates="assigned_groups")
    ride_requests = relationship("RideRequest", back_populates="group")


class RideRequest(Base):
    """
    A single passenger's ride request.
    Stores destination, fares (solo vs shared), and the drop-off order
    within a matched group.
    """
    __tablename__ = "ride_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    station_id = Column(Integer, ForeignKey("stations.id"), nullable=False)
    dest_lat = Column(Float, nullable=False)
    dest_lng = Column(Float, nullable=False)
    dest_name = Column(String, nullable=False)
    arrival_time = Column(DateTime, nullable=False)
    flight_train_number = Column(String, nullable=True)
    ride_type = Column(String, default="shared")      # solo | shared
    status = Column(String, default="pending")         # pending | matched | confirmed | on_trip | completed | cancelled
    group_id = Column(Integer, ForeignKey("ride_groups.id"), nullable=True)
    solo_fare = Column(Float, nullable=True)
    shared_fare = Column(Float, nullable=True)
    savings_pct = Column(Float, nullable=True)
    drop_order = Column(Integer, nullable=True)        # 1-based order in the group route
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="ride_requests")
    station = relationship("Station", back_populates="ride_requests")
    group = relationship("RideGroup", back_populates="ride_requests")
    trip_shares = relationship("TripShare", back_populates="ride_request")


class Driver(Base):
    """A cab driver with vehicle info and availability."""
    __tablename__ = "drivers"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    vehicle_number = Column(String, nullable=False)
    vehicle_model = Column(String, nullable=False)
    seats = Column(Integer, default=4)
    available = Column(Boolean, default=True)
    current_lat = Column(Float, nullable=True)
    current_lng = Column(Float, nullable=True)

    user = relationship("User", back_populates="driver_profile")
    assigned_groups = relationship("RideGroup", back_populates="driver")


class TripShare(Base):
    """Safety feature: trip details shared with a trusted contact."""
    __tablename__ = "trip_shares"

    id = Column(Integer, primary_key=True, index=True)
    ride_request_id = Column(Integer, ForeignKey("ride_requests.id"), nullable=False)
    contact_name = Column(String, nullable=False)
    contact_phone = Column(String, nullable=False)
    shared_at = Column(DateTime, default=datetime.utcnow)

    ride_request = relationship("RideRequest", back_populates="trip_shares")
