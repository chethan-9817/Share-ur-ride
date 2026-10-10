"""
Ride Request Endpoints
======================
CRUD operations for passenger ride requests, plus trip sharing.
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RideRequest, User, TripShare
from ..auth import get_current_user
from ..schemas import (
    RideRequestCreate, RideRequestResponse, RideStatusUpdate,
    TripShareCreate, TripShareResponse,
)
from ..services.routing import haversine
from ..services.fare import calculate_solo_fare

router = APIRouter(prefix="/api/rides", tags=["rides"])


@router.post("", response_model=RideRequestResponse)
def create_ride(
    data: RideRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new ride request.
    Calculates the solo fare immediately so the passenger
    can see what they'd pay without sharing.
    """
    from ..models import Station
    station = db.query(Station).filter(Station.id == data.station_id).first()
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")

    # Calculate solo distance and fare
    solo_dist = haversine(
        station.latitude, station.longitude,
        data.dest_lat, data.dest_lng
    )
    solo_fare = calculate_solo_fare(solo_dist)

    ride = RideRequest(
        user_id=current_user.id,
        station_id=data.station_id,
        dest_lat=data.dest_lat,
        dest_lng=data.dest_lng,
        dest_name=data.dest_name,
        arrival_time=data.arrival_time,
        flight_train_number=data.flight_train_number,
        ride_type=data.ride_type,
        solo_fare=solo_fare,
        status="pending" if data.ride_type == "shared" else "confirmed",
    )
    db.add(ride)
    db.commit()
    db.refresh(ride)
    return ride


@router.get("/my", response_model=List[RideRequestResponse])
def my_rides(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all ride requests for the current user."""
    rides = (
        db.query(RideRequest)
        .filter(RideRequest.user_id == current_user.id)
        .order_by(RideRequest.created_at.desc())
        .all()
    )
    return rides


@router.get("/{ride_id}", response_model=RideRequestResponse)
def get_ride(
    ride_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific ride request with its details."""
    ride = db.query(RideRequest).filter(RideRequest.id == ride_id).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    return ride


@router.patch("/{ride_id}/status", response_model=RideRequestResponse)
def update_ride_status(
    ride_id: int,
    data: RideStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update ride status (for simulation/testing)."""
    ride = db.query(RideRequest).filter(RideRequest.id == ride_id).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    valid_statuses = ["pending", "matched", "confirmed", "on_trip", "completed", "cancelled"]
    if data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")

    ride.status = data.status
    db.commit()
    db.refresh(ride)
    return ride


@router.post("/{ride_id}/confirm", response_model=RideRequestResponse)
def confirm_ride(
    ride_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Confirm a matched ride."""
    ride = db.query(RideRequest).filter(
        RideRequest.id == ride_id,
        RideRequest.user_id == current_user.id,
    ).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    if ride.status not in ("pending", "matched"):
        raise HTTPException(status_code=400, detail="Ride cannot be confirmed in current state")

    ride.status = "confirmed"

    # Check if all members of the group have confirmed
    if ride.group_id:
        from ..models import RideGroup
        group = db.get(RideGroup, ride.group_id)
        if group:
            all_confirmed = all(r.status == "confirmed" for r in group.ride_requests)
            if all_confirmed:
                group.status = "confirmed"

    db.commit()
    db.refresh(ride)
    return ride


@router.post("/{ride_id}/share-trip", response_model=TripShareResponse)
def share_trip(
    ride_id: int,
    data: TripShareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Share trip details with a trusted contact (safety feature)."""
    ride = db.query(RideRequest).filter(
        RideRequest.id == ride_id,
        RideRequest.user_id == current_user.id,
    ).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    trip_share = TripShare(
        ride_request_id=ride.id,
        contact_name=data.contact_name,
        contact_phone=data.contact_phone,
    )
    db.add(trip_share)
    db.commit()
    db.refresh(trip_share)
    return trip_share


@router.post("/{ride_id}/cancel", response_model=RideRequestResponse)
def cancel_ride(
    ride_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cancel a ride request.
    If part of a group, recalculates the route and fares for remaining riders,
    or dissolves the group if fewer than 2 passengers remain.
    """
    ride = db.query(RideRequest).filter(
        RideRequest.id == ride_id,
        RideRequest.user_id == current_user.id,
    ).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    if ride.status in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Ride is already {ride.status}")

    old_group_id = ride.group_id
    ride.status = "cancelled"
    ride.group_id = None
    ride.shared_fare = None
    ride.savings_pct = None
    ride.drop_order = None

    if old_group_id:
        from ..models import RideGroup, Station
        from ..services.matching import _finalize_group

        group = db.get(RideGroup, old_group_id)
        if group:
            remaining = [
                r for r in group.ride_requests
                if r.id != ride.id and r.status != "cancelled"
            ]
            if len(remaining) < 2:
                # Group not viable without this rider, dissolve
                for r in remaining:
                    r.group_id = None
                    r.status = "pending"
                    r.shared_fare = None
                    r.savings_pct = None
                    r.drop_order = None
                if group.driver:
                    group.driver.available = True
                db.delete(group)
            else:
                station = db.get(Station, group.station_id)
                dests = [
                    {
                        "ride_request_id": r.id,
                        "dest_lat": r.dest_lat,
                        "dest_lng": r.dest_lng,
                        "dest_name": r.dest_name,
                    }
                    for r in remaining
                ]
                _finalize_group(db, group, dests, station)

    db.commit()
    db.refresh(ride)
    return ride
