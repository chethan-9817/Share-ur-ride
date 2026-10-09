"""
Matching Endpoints
==================
Trigger the matching engine and preview potential matches.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RideRequest, User
from ..auth import get_current_user
from ..schemas import MatchResult, RideRequestResponse
from ..services.matching import match_ride, decline_and_rematch

router = APIRouter(prefix="/api/matches", tags=["matching"])


@router.post("/find/{ride_id}", response_model=MatchResult)
def find_match(
    ride_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Trigger the matching engine for a specific ride request.
    Returns match details if found, or 404 with a suggestion to book solo.
    """
    ride = db.query(RideRequest).filter(
        RideRequest.id == ride_id,
        RideRequest.user_id == current_user.id,
    ).first()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    if ride.ride_type != "shared":
        raise HTTPException(status_code=400, detail="Only shared rides can be matched")

    if ride.status not in ("pending",):
        raise HTTPException(status_code=400, detail=f"Ride is already {ride.status}")

    result = match_ride(db, ride)
    if not result:
        raise HTTPException(
            status_code=404,
            detail="No matches found right now. You can wait or book a solo ride.",
        )

    return result


@router.post("/decline/{ride_id}", response_model=dict)
def decline_match(
    ride_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Decline the current match and re-enter the matching pool.
    Fares for remaining group members are recomputed.
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
