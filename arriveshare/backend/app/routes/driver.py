"""
Driver Endpoints
================
Driver dashboard: view assignments, stops, earnings, and update trip status.
"""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Driver, RideGroup, User
from ..auth import get_current_user
from ..schemas import DriverResponse, GroupResponse, RideStatusUpdate
from ..services.routing import get_osrm_distance

router = APIRouter(prefix="/api/driver", tags=["driver"])


@router.get("/profile", response_model=DriverResponse)
def get_driver_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the current user's driver profile."""
    driver = db.query(Driver).filter(Driver.user_id == current_user.id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver profile not found")
    return driver


@router.get("/assignments", response_model=List[GroupResponse])
def list_assignments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all ride groups assigned to this driver."""
    driver = db.query(Driver).filter(Driver.user_id == current_user.id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver profile not found")

    groups = (
        db.query(RideGroup)
        .filter(RideGroup.driver_id == driver.id)
        .order_by(RideGroup.created_at.desc())
        .all()
    )
    return groups


@router.get("/assignments/{group_id}")
async def get_assignment_detail(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get detailed assignment info for a group:
    ordered stops, passenger names, total earnings, and road geometry.
    """
    driver = db.query(Driver).filter(Driver.user_id == current_user.id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver profile not found")

    group = db.query(RideGroup).filter(
        RideGroup.id == group_id,
        RideGroup.driver_id == driver.id,
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # Build ordered stops for the driver
    stops = [{
        "order": 0,
        "type": "pickup",
        "name": group.station.name,
        "lat": group.station.latitude,
        "lng": group.station.longitude,
    }]

    sorted_requests = sorted(
        group.ride_requests,
        key=lambda r: r.drop_order or 999,
    )

    for req in sorted_requests:
        stops.append({
            "order": req.drop_order,
            "type": "dropoff",
            "name": req.dest_name,
            "lat": req.dest_lat,
            "lng": req.dest_lng,
            "passenger_name": req.user.name.split()[0] if req.user else "Unknown",
            "passenger_verified": req.user.verified if req.user else False,
        })

    # Fetch real road geometry from OSRM (or fallback)
    coords = [(s["lat"], s["lng"]) for s in stops]
    road_distance, geometry = await get_osrm_distance(coords)

    return {
        "group_id": group.id,
        "status": group.status,
        "total_distance_km": group.total_distance_km or round(road_distance, 2),
        "total_earnings": group.total_fare,
        "passenger_count": len(group.ride_requests),
        "stops": stops,
        "geometry": geometry,
        "vehicle": {
            "number": driver.vehicle_number,
            "model": driver.vehicle_model,
        },
    }


@router.patch("/assignments/{group_id}/status")
def update_assignment_status(
    group_id: int,
    data: RideStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update the trip status (for simulation)."""
    driver = db.query(Driver).filter(Driver.user_id == current_user.id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver profile not found")

    group = db.query(RideGroup).filter(
        RideGroup.id == group_id,
        RideGroup.driver_id == driver.id,
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Assignment not found")

    from ..services.state_machine import transition_ride_group, transition_ride_request

    transition_ride_group(db, group, data.status)

    # Also update all ride requests in the group
    for req in group.ride_requests:
        if req.status != "cancelled":
            if data.status == "on_trip":
                transition_ride_request(db, req, "on_trip")
            elif data.status == "completed":
                transition_ride_request(db, req, "completed")
                driver.available = True

    db.commit()
    return {"status": group.status, "message": f"Group {group_id} updated to {data.status}"}


@router.post("/toggle-availability", response_model=DriverResponse)
def toggle_availability(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Toggle driver available status between True and False."""
    driver = db.query(Driver).filter(Driver.user_id == current_user.id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver profile not found")

    driver.available = not driver.available
    db.commit()
    db.refresh(driver)
    return driver
