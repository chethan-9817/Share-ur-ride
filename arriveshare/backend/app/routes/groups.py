"""
Group Endpoints
===============
View ride group details including passengers, route, and fares.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RideGroup, User
from ..auth import get_current_user
from ..schemas import GroupResponse
from ..services.routing import get_osrm_distance

router = APIRouter(prefix="/api/groups", tags=["groups"])


@router.get("/{group_id}", response_model=GroupResponse)
def get_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get full details of a ride group: passengers, route, fares, driver."""
    group = db.query(RideGroup).filter(RideGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


@router.get("/{group_id}/route")
async def get_group_route(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get the optimized route for a group — ordered stops with coordinates.
    Also returns OSRM road geometry for map polyline rendering.
    """
    group = db.query(RideGroup).filter(RideGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    # Build ordered stops
    stops = []
    station = group.station

    # Start: station
    stops.append({
        "order": 0,
        "type": "pickup",
        "name": station.name,
        "lat": station.latitude,
        "lng": station.longitude,
    })

    # Drop-offs sorted by drop_order
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
            "passenger": req.user.name.split()[0] if req.user else "Unknown",
        })

    # Fetch real road geometry from OSRM (or fallback)
    coords = [(s["lat"], s["lng"]) for s in stops]
    road_distance, geometry = await get_osrm_distance(coords)

    return {
        "group_id": group_id,
        "total_distance_km": group.total_distance_km or round(road_distance, 2),
        "total_fare": group.total_fare,
        "stops": stops,
        "geometry": geometry,
    }
