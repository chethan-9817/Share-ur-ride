"""
Ride Request Endpoints (Milestone 1 Upgrade)
============================================
CRUD operations for passenger ride requests, auto-matching, flexible updates,
confirmation under price guarantee, and transaction-safe cancellation.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RideRequest, User, TripShare, Station, RideGroup
from ..auth import get_current_user
from ..schemas import (
    RideRequestCreate, RideRequestUpdate, RideRequestResponse, RideStatusUpdate,
    TripShareCreate, TripShareResponse,
)
from ..services.routing import haversine
from ..services.fare import compute_fare
from ..services.matching import match_ride, _finalize_group
from ..services.state_machine import (
    RideRequestStatus, RideGroupStatus,
    transition_ride_request, transition_ride_group,
)
from ..config import settings

router = APIRouter(prefix="/api/rides", tags=["rides"])


@router.post("", response_model=RideRequestResponse)
def create_ride(
    data: RideRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new ride request and immediately trigger auto-matching if shared.
    Calculates the solo fare upfront.
    """
    station = db.query(Station).filter(Station.id == data.station_id).first()
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")

    # Direct solo distance and fare
    solo_dist = haversine(station.latitude, station.longitude, data.dest_lat, data.dest_lng)
    solo_fare = compute_fare(solo_dist)

    ride = RideRequest(
        user_id=current_user.id,
        station_id=data.station_id,
        dest_lat=data.dest_lat,
        dest_lng=data.dest_lng,
        dest_name=data.dest_name,
        arrival_time=data.arrival_time,
        flight_train_number=data.flight_train_number,
        match_window_minutes=data.match_window_minutes or settings.DEFAULT_MATCH_WINDOW_MINUTES,
        ride_type=data.ride_type,
        solo_fare=solo_fare,
        status=RideRequestStatus.PENDING if data.ride_type == "shared" else RideRequestStatus.CONFIRMED,
    )
    db.add(ride)
    db.commit()
    db.refresh(ride)

    # Auto-matching trigger (a): run matching immediately on ride creation
    if ride.ride_type == "shared":
        match_ride(db, ride)
        db.refresh(ride)

    return ride


@router.patch("/{ride_id}", response_model=RideRequestResponse)
def update_ride(
    ride_id: int,
    data: RideRequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Flexible arrival and destination updates.
    Allows adjusting arrival time, flight/train info, destination, or tolerance window.
    Immediately re-runs auto-matching (trigger b).
    """
    ride = db.query(RideRequest).filter(
        RideRequest.id == ride_id,
        RideRequest.user_id == current_user.id,
    ).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    if ride.status in (RideRequestStatus.ON_TRIP, RideRequestStatus.COMPLETED, RideRequestStatus.CANCELLED):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit ride in '{ride.status}' status",
        )

    # If ride was in a group and is modifying destination or arrival, safely detach or update
    old_group_id = ride.group_id
    if old_group_id and (data.arrival_time is not None or data.dest_lat is not None):
        # Reset group association to re-evaluate group fit
        ride.group_id = None
        transition_ride_request(db, ride, RideRequestStatus.PENDING)
        ride.shared_fare = None
        ride.savings_pct = None
        ride.drop_order = None

        group = db.get(RideGroup, old_group_id)
        if group:
            remaining = [r for r in group.ride_requests if r.id != ride.id and r.status != RideRequestStatus.CANCELLED]
            if len(remaining) < 2:
                for r in remaining:
                    transition_ride_request(db, r, RideRequestStatus.PENDING)
                    r.group_id = None
                if group.driver:
                    group.driver.available = True
                transition_ride_group(db, group, RideGroupStatus.CANCELLED)
                db.delete(group)
            else:
                station = db.get(Station, group.station_id)
                dests = [{
                    "ride_request_id": r.id, "dest_lat": r.dest_lat,
                    "dest_lng": r.dest_lng, "dest_name": r.dest_name
                } for r in remaining]
                _finalize_group(db, group, dests, station)

    # Apply updates
    if data.dest_lat is not None:
        ride.dest_lat = data.dest_lat
    if data.dest_lng is not None:
        ride.dest_lng = data.dest_lng
    if data.dest_name is not None:
        ride.dest_name = data.dest_name
    if data.arrival_time is not None:
        ride.arrival_time = data.arrival_time
    if data.flight_train_number is not None:
        ride.flight_train_number = data.flight_train_number
    if data.match_window_minutes is not None:
        ride.match_window_minutes = data.match_window_minutes

    # Recompute solo fare if destination changed
    station = db.get(Station, ride.station_id)
    if station:
        solo_dist = haversine(station.latitude, station.longitude, ride.dest_lat, ride.dest_lng)
        ride.solo_fare = compute_fare(solo_dist)

    db.commit()
    db.refresh(ride)

    # Auto-matching trigger (b): re-trigger matching on modification
    if ride.ride_type == "shared" and ride.status == RideRequestStatus.PENDING:
        match_ride(db, ride)
        db.refresh(ride)

    return ride


@router.get("/my", response_model=List[RideRequestResponse])
def my_rides(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all ride requests for the current user."""
    return (
        db.query(RideRequest)
        .filter(RideRequest.user_id == current_user.id)
        .order_by(RideRequest.created_at.desc())
        .all()
    )


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
    """Update ride status governed by the Central State Machine."""
    ride = db.query(RideRequest).filter(RideRequest.id == ride_id).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    # In non-demo mode, only drivers or system can transition on_trip/completed
    if not settings.DEMO_MODE and data.status in (RideRequestStatus.ON_TRIP, RideRequestStatus.COMPLETED):
        if current_user.role != "driver" and current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Only drivers or admins can update trip progress")

    transition_ride_request(db, ride, data.status)
    db.commit()
    db.refresh(ride)
    return ride


@router.post("/{ride_id}/confirm", response_model=RideRequestResponse)
def confirm_ride(
    ride_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Confirm acceptance of a matched ride.
    Locks in the Price Guarantee (accepted_fare).
    Transitions the group to 'confirmed' if all members have accepted.
    """
    ride = db.query(RideRequest).filter(
        RideRequest.id == ride_id,
        RideRequest.user_id == current_user.id,
    ).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    if ride.status not in (RideRequestStatus.PENDING, RideRequestStatus.MATCHED):
        raise HTTPException(status_code=400, detail=f"Ride cannot be confirmed in state '{ride.status}'")

    # Transition via state machine
    transition_ride_request(db, ride, RideRequestStatus.CONFIRMED)

    # Lock in Price Guarantee
    if ride.shared_fare:
        ride.accepted_fare = ride.shared_fare

    # Check if all members of the group have accepted
    if ride.group_id:
        group = db.get(RideGroup, ride.group_id)
        if group:
            all_confirmed = all(
                r.status == RideRequestStatus.CONFIRMED
                for r in group.ride_requests
                if r.status != RideRequestStatus.CANCELLED
            )
            if all_confirmed:
                transition_ride_group(db, group, RideGroupStatus.CONFIRMED)

    db.commit()
    db.refresh(ride)
    return ride


@router.post("/{ride_id}/cancel", response_model=RideRequestResponse)
def cancel_ride(
    ride_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cancel a ride request.
    Under Price Guarantee:
      Remaining members retain their accepted fare (platform absorbs any delta),
      or group dissolves if fewer than 2 passengers remain.
    """
    ride = db.query(RideRequest).filter(
        RideRequest.id == ride_id,
        RideRequest.user_id == current_user.id,
    ).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    if ride.status in (RideRequestStatus.COMPLETED, RideRequestStatus.CANCELLED):
        raise HTTPException(status_code=400, detail=f"Ride is already {ride.status}")

    old_group_id = ride.group_id

    # Transition ride to cancelled
    transition_ride_request(db, ride, RideRequestStatus.CANCELLED)
    ride.group_id = None
    ride.shared_fare = None
    ride.savings_pct = None
    ride.drop_order = None
    ride.accept_expires_at = None

    if old_group_id:
        group = db.get(RideGroup, old_group_id)
        if group:
            remaining = [
                r for r in group.ride_requests
                if r.id != ride.id and r.status != RideRequestStatus.CANCELLED
            ]
            if len(remaining) < 2:
                # Group not viable without this rider -> dissolve
                for r in remaining:
                    transition_ride_request(db, r, RideRequestStatus.PENDING)
                    r.group_id = None
                    r.shared_fare = None
                    r.savings_pct = None
                    r.drop_order = None
                    r.accept_expires_at = None

                if group.driver:
                    group.driver.available = True
                transition_ride_group(db, group, RideGroupStatus.CANCELLED)
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
                # Re-finalizes remaining riders with Price Guarantee preservation
                _finalize_group(db, group, dests, station)

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
    """Share trip details with a trusted contact."""
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
