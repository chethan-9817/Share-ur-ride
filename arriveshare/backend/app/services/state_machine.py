"""
Central State Machine Module
=============================
Governs all state transitions for RideRequest and RideGroup.
Enforces transition matrix and optimistic concurrency locks.
"""

from typing import Optional, Set, Dict
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from ..models import RideRequest, RideGroup


class RideRequestStatus:
    PENDING = "pending"
    MATCHED = "matched"
    CONFIRMED = "confirmed"
    ON_TRIP = "on_trip"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class RideGroupStatus:
    FORMING = "forming"
    ACCEPTING = "accepting"
    CONFIRMED = "confirmed"
    ON_TRIP = "on_trip"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


# Allowed status transitions
RIDE_REQUEST_TRANSITIONS: Dict[str, Set[str]] = {
    RideRequestStatus.PENDING: {
        RideRequestStatus.MATCHED,
        RideRequestStatus.CONFIRMED,   # Solo ride booking
        RideRequestStatus.CANCELLED,
    },
    RideRequestStatus.MATCHED: {
        RideRequestStatus.CONFIRMED,
        RideRequestStatus.ON_TRIP,     # Direct departure / boarding
        RideRequestStatus.PENDING,     # Declined or timed out
        RideRequestStatus.CANCELLED,
    },
    RideRequestStatus.CONFIRMED: {
        RideRequestStatus.ON_TRIP,
        RideRequestStatus.CANCELLED,
    },
    RideRequestStatus.ON_TRIP: {
        RideRequestStatus.COMPLETED,
        RideRequestStatus.CANCELLED,   # Emergency abort
    },
    RideRequestStatus.COMPLETED: set(),
    RideRequestStatus.CANCELLED: set(),
}

RIDE_GROUP_TRANSITIONS: Dict[str, Set[str]] = {
    RideGroupStatus.FORMING: {
        RideGroupStatus.ACCEPTING,
        RideGroupStatus.CONFIRMED,
        RideGroupStatus.CANCELLED,
    },
    RideGroupStatus.ACCEPTING: {
        RideGroupStatus.CONFIRMED,
        RideGroupStatus.ON_TRIP,      # Driver initiates trip
        RideGroupStatus.FORMING,      # Member declined, back to forming
        RideGroupStatus.CANCELLED,    # Group dissolved
    },
    RideGroupStatus.CONFIRMED: {
        RideGroupStatus.ON_TRIP,
        RideGroupStatus.CANCELLED,
    },
    RideGroupStatus.ON_TRIP: {
        RideGroupStatus.COMPLETED,
        RideGroupStatus.CANCELLED,
    },
    RideGroupStatus.COMPLETED: set(),
    RideGroupStatus.CANCELLED: set(),
}


def transition_ride_request(
    db: Session,
    ride: RideRequest,
    target_status: str,
    expected_version: Optional[int] = None,
) -> RideRequest:
    """
    Transition a ride request to target_status.
    Validates legal transitions and increments version for optimistic locking.
    """
    if expected_version is not None and ride.version != expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "CONCURRENCY_CONFLICT",
                "message": "Ride request was modified by another concurrent operation. Please refresh.",
                "current_version": ride.version,
                "expected_version": expected_version,
            },
        )

    current_status = ride.status
    if current_status == target_status:
        return ride

    allowed = RIDE_REQUEST_TRANSITIONS.get(current_status, set())
    if target_status not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "INVALID_STATE_TRANSITION",
                "entity": "RideRequest",
                "id": ride.id,
                "current_status": current_status,
                "target_status": target_status,
                "allowed_transitions": sorted(list(allowed)),
            },
        )

    ride.status = target_status
    ride.version = (ride.version or 1) + 1
    return ride


def transition_ride_group(
    db: Session,
    group: RideGroup,
    target_status: str,
    expected_version: Optional[int] = None,
) -> RideGroup:
    """
    Transition a ride group to target_status.
    Validates legal transitions and increments version.
    """
    if expected_version is not None and group.version != expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "CONCURRENCY_CONFLICT",
                "message": "Ride group was modified by another concurrent operation. Please refresh.",
                "current_version": group.version,
                "expected_version": expected_version,
            },
        )

    current_status = group.status
    if current_status == target_status:
        return group

    allowed = RIDE_GROUP_TRANSITIONS.get(current_status, set())
    if target_status not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "INVALID_STATE_TRANSITION",
                "entity": "RideGroup",
                "id": group.id,
                "current_status": current_status,
                "target_status": target_status,
                "allowed_transitions": sorted(list(allowed)),
            },
        )

    group.status = target_status
    group.version = (group.version or 1) + 1
    return group
