"""
Matching Endpoints (Milestone 1 Upgrade)
========================================
Trigger matching engine, query live match state, and handle match decline.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RideRequest, User, RideGroup, Station
from ..auth import get_current_user
from ..schemas import MatchResult
from ..services.matching import match_ride, decline_and_rematch, _finalize_group

router = APIRouter(prefix="/api/matches", tags=["matching"])


@router.post("/find/{ride_id}", response_model=MatchResult)
def find_match(
    ride_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Trigger or fetch the match for a specific ride request.
    If the ride was already auto-matched in the background, returns the existing match.
    """
    ride = db.query(RideRequest).filter(
        RideRequest.id == ride_id,
        RideRequest.user_id == current_user.id,
    ).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    if ride.ride_type != "shared":
        raise HTTPException(status_code=400, detail="Only shared rides can be matched")

    # If already matched into a group, return active match details
    if ride.status == "matched" and ride.group_id:
        group = db.get(RideGroup, ride.group_id)
        station = db.get(Station, ride.station_id)
        if group and station:
            active_dests = [
                {
                    "ride_request_id": r.id,
                    "dest_lat": r.dest_lat,
                    "dest_lng": r.dest_lng,
                    "dest_name": r.dest_name,
                }
                for r in group.ride_requests
                if r.status in ("matched", "confirmed")
            ]
            if len(active_dests) >= 2:
                return _finalize_group(db, group, active_dests, station, requesting_ride_id=ride.id)

    if ride.status not in ("pending",):
        raise HTTPException(status_code=400, detail=f"Ride is already {ride.status}")

    result = match_ride(db, ride)
    if not result:
        raise HTTPException(
            status_code=404,
            detail="No matches found right now. You can wait or book a solo ride.",
        )

    return result


@router.get("/status/{ride_id}")
def get_match_status(
    ride_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Poll live background matching state for the radar UI.
    """
    ride = db.query(RideRequest).filter(
        RideRequest.id == ride_id,
        RideRequest.user_id == current_user.id,
    ).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    return {
        "ride_id": ride.id,
        "status": ride.status,
        "group_id": ride.group_id,
        "accept_expires_at": ride.accept_expires_at.isoformat() if ride.accept_expires_at else None,
        "shared_fare": ride.shared_fare,
        "solo_fare": ride.solo_fare,
    }


@router.post("/decline/{ride_id}", response_model=dict)
def decline_match(
    ride_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Decline the current match and re-enter the matching pool.
    Fares for remaining group members are recomputed under price guarantee.
    """
    ride = db.query(RideRequest).filter(
        RideRequest.id == ride_id,
        RideRequest.user_id == current_user.id,
    ).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    if ride.status != "matched":
        raise HTTPException(status_code=400, detail="No active match to decline")

    new_result = decline_and_rematch(db, ride)

    if new_result:
        return {"status": "rematched", "match": new_result}
    else:
        return {
            "status": "unmatched",
            "message": "No new matches found. Ride is back in the pool.",
        }
