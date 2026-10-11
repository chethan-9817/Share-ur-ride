"""
Matching Engine (Milestone 1 Upgrade)
=====================================
The heart of ArriveShare. Groups passengers into shared cabs deterministically,
safely, and fairly.

Key Enhancements:
  1. Dual Detour Constraints: Detour <= min(solo_distance * MAX_DETOUR_PCT, MAX_DETOUR_KM).
  2. Bounding-Box Pre-Filter: O(1) early exclusion before distance calculations.
  3. Exact Permutations: Evaluates all drop-off sequences for N <= 4 passengers.
  4. Acceptance Window: Sets accept_expires_at (default 2 min) countdown.
  5. Price Guarantee: Locked accepted_fare cannot increase; platform absorbs delta.
  6. State Machine Guards: All status transitions invoke state_machine.
  7. Late Joiners: Can join forming/accepting groups if seats are free and trip not started.
  8. Background Worker: Periodic matching scanner and expired acceptance handler.
"""

from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Tuple
from sqlalchemy.orm import Session

from ..config import settings
from ..models import RideRequest, RideGroup, Station, Driver
from .routing import (
    haversine,
    bounding_box_filter,
    is_detour_compatible,
    optimize_drop_order_exact,
)
from .fare import (
    compute_fare,
    split_fare,
    apply_price_guarantee,
)
from .state_machine import (
    RideRequestStatus,
    RideGroupStatus,
    transition_ride_request,
    transition_ride_group,
)


def find_candidates(
    db: Session,
    ride: RideRequest,
) -> List[RideRequest]:
    """
    Step 1: Find pending shared ride requests at the same station
    within the flexible arrival time window.
    """
    window_mins = ride.match_window_minutes or settings.DEFAULT_MATCH_WINDOW_MINUTES
    time_window = timedelta(minutes=window_mins)
    min_time = ride.arrival_time - time_window
    max_time = ride.arrival_time + time_window

    query = (
        db.query(RideRequest)
        .filter(
            RideRequest.station_id == ride.station_id,
            RideRequest.arrival_time >= min_time,
            RideRequest.arrival_time <= max_time,
            RideRequest.status == RideRequestStatus.PENDING,
            RideRequest.ride_type == "shared",
            RideRequest.id != ride.id,
            RideRequest.user_id != ride.user_id,
        )
    )

    candidates = query.all()

    # Pre-filter: bounding box check against rider destination + max detour
    max_reach_km = 45.0  # Max Bangalore metro reach
    filtered = [
        c for c in candidates
        if bounding_box_filter(ride.dest_lat, ride.dest_lng, c.dest_lat, c.dest_lng, max_reach_km)
    ]
    return filtered


def check_candidate_pair(
    station: Station,
    ride: RideRequest,
    candidate: RideRequest,
) -> Tuple[bool, float]:
    """
    Step 2: Score pair compatibility using the dual detour model.
    Returns (is_compatible, total_route_km).
    """
    dests = [
        {"ride_request_id": ride.id, "dest_lat": ride.dest_lat, "dest_lng": ride.dest_lng, "dest_name": ride.dest_name},
        {"ride_request_id": candidate.id, "dest_lat": candidate.dest_lat, "dest_lng": candidate.dest_lng, "dest_name": candidate.dest_name},
    ]
    ordered, total_dist, is_valid = optimize_drop_order_exact(
        station.latitude, station.longitude, dests,
        max_detour_km=settings.MAX_DETOUR_KM,
        max_detour_pct=settings.MAX_DETOUR_PCT,
    )
    return is_valid, total_dist


def match_ride(
    db: Session,
    ride: RideRequest,
) -> Optional[Dict]:
    """
    Main matching entry point.
    Attempts to:
      1. Add to an existing open group (late joiner flow).
      2. Or assemble a new group from pending candidates.
    Returns match summary or None if no match yet.
    """
    if ride.ride_type != "shared" or ride.status not in (RideRequestStatus.PENDING, RideRequestStatus.MATCHED):
        return None

    station = db.get(Station, ride.station_id)
    if not station:
        return None

    # Always ensure solo distance and fare are up to date
    solo_dist = haversine(station.latitude, station.longitude, ride.dest_lat, ride.dest_lng)
    ride.solo_fare = compute_fare(solo_dist)

    now = datetime.now(timezone.utc)
    accept_expires = now + timedelta(seconds=settings.ACCEPT_WINDOW_SECONDS)

    # ── 1. Try to join an existing open group ─────────────────────────
    open_groups = (
        db.query(RideGroup)
        .filter(
            RideGroup.station_id == ride.station_id,
            RideGroup.status.in_([RideGroupStatus.FORMING, RideGroupStatus.ACCEPTING]),
        )
        .all()
    )

    for group in open_groups:
        active_members = [
            r for r in group.ride_requests
            if r.status in (RideRequestStatus.PENDING, RideRequestStatus.MATCHED, RideRequestStatus.CONFIRMED)
        ]
        if len(active_members) >= group.capacity:
            continue

        # Check arrival time alignment with all members
        rider_window = timedelta(minutes=ride.match_window_minutes or settings.DEFAULT_MATCH_WINDOW_MINUTES)
        time_ok = all(
            abs((ride.arrival_time - m.arrival_time).total_seconds()) <= rider_window.total_seconds()
            for m in active_members
        )
        if not time_ok:
            continue

        candidate_dests = [
            {
                "ride_request_id": m.id,
                "dest_lat": m.dest_lat,
                "dest_lng": m.dest_lng,
                "dest_name": m.dest_name,
            }
            for m in active_members
        ]
        candidate_dests.append({
            "ride_request_id": ride.id,
            "dest_lat": ride.dest_lat,
            "dest_lng": ride.dest_lng,
            "dest_name": ride.dest_name,
        })

        ordered, total_dist, is_valid = optimize_drop_order_exact(
            station.latitude, station.longitude, candidate_dests,
            max_detour_km=settings.MAX_DETOUR_KM,
            max_detour_pct=settings.MAX_DETOUR_PCT,
        )

        if is_valid:
            # Successfully fits as a late joiner!
            ride.group_id = group.id
            transition_ride_request(db, ride, RideRequestStatus.MATCHED)
            ride.accept_expires_at = accept_expires
            group.accept_expires_at = accept_expires
            if group.status == RideGroupStatus.FORMING:
                transition_ride_group(db, group, RideGroupStatus.ACCEPTING)

            return _finalize_group(db, group, ordered, station, requesting_ride_id=ride.id)

    # ── 2. Create a new group from pending candidates ─────────────────
    candidates = find_candidates(db, ride)
    compatible_pairs = []

    for c in candidates:
        is_ok, dist = check_candidate_pair(station, ride, c)
        if is_ok:
            compatible_pairs.append((c, dist))

    # Sort by total distance (best matches first)
    compatible_pairs.sort(key=lambda x: x[1])

    if not compatible_pairs:
        db.commit()
        return None

    # Create new group
    group = RideGroup(
        station_id=ride.station_id,
        status=RideGroupStatus.ACCEPTING,
        capacity=settings.CAB_CAPACITY,
        accept_expires_at=accept_expires,
    )
    db.add(group)
    db.flush()

    ride.group_id = group.id
    transition_ride_request(db, ride, RideRequestStatus.MATCHED)
    ride.accept_expires_at = accept_expires

    current_dests = [{
        "ride_request_id": ride.id,
        "dest_lat": ride.dest_lat,
        "dest_lng": ride.dest_lng,
        "dest_name": ride.dest_name,
    }]

    for candidate, _ in compatible_pairs:
        if len(current_dests) >= settings.CAB_CAPACITY:
            break

        test_dests = current_dests + [{
            "ride_request_id": candidate.id,
            "dest_lat": candidate.dest_lat,
            "dest_lng": candidate.dest_lng,
            "dest_name": candidate.dest_name,
        }]

        ordered, total_dist, is_valid = optimize_drop_order_exact(
            station.latitude, station.longitude, test_dests,
            max_detour_km=settings.MAX_DETOUR_KM,
            max_detour_pct=settings.MAX_DETOUR_PCT,
        )

        if is_valid:
            candidate.group_id = group.id
            transition_ride_request(db, candidate, RideRequestStatus.MATCHED)
            candidate.accept_expires_at = accept_expires
            current_dests = ordered

    if len(current_dests) < 2:
        # Unable to form valid group
        ride.group_id = None
        transition_ride_request(db, ride, RideRequestStatus.PENDING)
        ride.accept_expires_at = None
        db.delete(group)
        db.commit()
        return None

    return _finalize_group(db, group, current_dests, station, requesting_ride_id=ride.id)


def _finalize_group(
    db: Session,
    group: RideGroup,
    ordered_destinations: List[Dict],
    station: Station,
    requesting_ride_id: Optional[int] = None,
) -> Dict:
    """
    Finalize group route ordering, calculate unified proportional fares,
    enforce price guarantee, assign available driver, and persist changes.
    """
    # Optimize drop-off sequence
    ordered, total_distance, _ = optimize_drop_order_exact(
        station.latitude, station.longitude, ordered_destinations,
        max_detour_km=settings.MAX_DETOUR_KM,
        max_detour_pct=settings.MAX_DETOUR_PCT,
    )

    group.total_distance_km = round(total_distance, 2)
    group.total_fare = compute_fare(total_distance)

    # Calculate fair proportional fare split
    passengers_input = [
        {
            "ride_request_id": d["ride_request_id"],
            "dest_lat": d["dest_lat"],
            "dest_lng": d["dest_lng"],
            "dest_name": d["dest_name"],
        }
        for d in ordered
    ]
    fare_splits = split_fare(passengers_input, total_distance, station.latitude, station.longitude)

    group_subsidy_total = 0.0

    # Update each member ride request
    for dest in ordered:
        r_id = dest["ride_request_id"]
        rr = db.get(RideRequest, r_id)
        if not rr:
            continue

        rr.drop_order = dest["order"]
        f_info = next((f for f in fare_splits if f["ride_request_id"] == r_id), None)
        if f_info:
            raw_shared_fare = f_info["shared_fare"]
            # Apply Price Guarantee protection
            charged_fare, subsidy = apply_price_guarantee(rr.accepted_fare, raw_shared_fare)
            rr.solo_fare = f_info["solo_fare"]
            rr.shared_fare = charged_fare
            rr.platform_subsidy = round((rr.platform_subsidy or 0.0) + subsidy, 2)
            group_subsidy_total += subsidy

            # Recalculate savings based on what rider actually pays
            if rr.solo_fare and rr.solo_fare > 0:
                rr.savings_pct = round(((rr.solo_fare - charged_fare) / rr.solo_fare) * 100, 1)

    group.platform_subsidy = round((group.platform_subsidy or 0.0) + group_subsidy_total, 2)

    # Assign available driver if not assigned
    if not group.driver_id:
        driver = (
            db.query(Driver)
            .filter(Driver.available == True, Driver.seats >= len(ordered))
            .first()
        )
        if not driver:
            # Fallback to assign an existing driver if all drivers are currently flagged unavailable
            driver = db.query(Driver).filter(Driver.seats >= len(ordered)).first()

        if driver:
            group.driver_id = driver.id
            driver.available = False

    db.commit()

    # Build response breakdown for the requesting passenger
    target_id = requesting_ride_id or ordered[0]["ride_request_id"]
    target_split = next((f for f in fare_splits if f["ride_request_id"] == target_id), fare_splits[0])
    target_ride = db.get(RideRequest, target_id)

    co_travelers = []
    for dest in ordered:
        if requesting_ride_id and dest["ride_request_id"] == requesting_ride_id:
            continue
        rr = db.get(RideRequest, dest["ride_request_id"])
        if rr and rr.user:
            co_travelers.append({
                "first_name": rr.user.name.split()[0],
                "verified": rr.user.verified,
                "dest_name": rr.dest_name,
                "drop_order": dest["order"],
            })

    fare_breakdown = {
        "solo_fare": target_ride.solo_fare if target_ride else target_split["solo_fare"],
        "shared_fare": target_ride.shared_fare if target_ride else target_split["shared_fare"],
        "savings_inr": round(
            (target_ride.solo_fare - target_ride.shared_fare)
            if (target_ride and target_ride.solo_fare and target_ride.shared_fare)
            else target_split["savings_inr"],
            2,
        ),
        "savings_pct": target_ride.savings_pct if target_ride else target_split["savings_pct"],
        "distance_share_pct": target_split["distance_share_pct"],
        "platform_subsidy": target_ride.platform_subsidy if target_ride else 0.0,
        "price_guarantee_locked": target_ride.accepted_fare is not None if target_ride else False,
    }

    return {
        "group_id": group.id,
        "status": group.status,
        "co_travelers": co_travelers,
        "dropoff_order": [
            {"order": d["order"], "dest_name": d["dest_name"], "lat": d["dest_lat"], "lng": d["dest_lng"]}
            for d in ordered
        ],
        "total_route_km": round(total_distance, 2),
        "solo_fare": fare_breakdown["solo_fare"],
        "shared_fare": fare_breakdown["shared_fare"],
        "savings_pct": fare_breakdown["savings_pct"],
        "savings_inr": fare_breakdown["savings_inr"],
        "distance_share_pct": fare_breakdown["distance_share_pct"],
        "platform_subsidy": fare_breakdown["platform_subsidy"],
        "accept_expires_at": group.accept_expires_at.isoformat() if group.accept_expires_at else None,
        "message": f"You save {fare_breakdown['savings_pct']}% (₹{fare_breakdown['savings_inr']})!",
    }


def decline_and_rematch(db: Session, ride: RideRequest) -> Optional[Dict]:
    """
    Passenger declines a match. Remove them from group, recompute fares
    under price guarantee for remaining members, and re-pool.
    """
    old_group_id = ride.group_id

    # Transition declining ride back to pending
    transition_ride_request(db, ride, RideRequestStatus.PENDING)
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
                # Group is no longer viable
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
                dests = [{
                    "ride_request_id": r.id,
                    "dest_lat": r.dest_lat,
                    "dest_lng": r.dest_lng,
                    "dest_name": r.dest_name,
                } for r in remaining]
                _finalize_group(db, group, dests, station)

    db.commit()
    # Attempt to find a new match for the re-pooled rider
    return match_ride(db, ride)


def run_background_matching(db: Session):
    """
    Periodic background job:
      1. Auto-expire accepting groups past accept_expires_at.
      2. Scan all pending shared ride requests and auto-match or join groups.
    """
    now = datetime.now(timezone.utc)

    # 1. Handle expired accepting groups
    expired_groups = (
        db.query(RideGroup)
        .filter(
            RideGroup.status == RideGroupStatus.ACCEPTING,
            RideGroup.accept_expires_at != None,
            RideGroup.accept_expires_at < now,
        )
        .all()
    )

    for group in expired_groups:
        unconfirmed = [r for r in group.ride_requests if r.status == RideRequestStatus.MATCHED]
        confirmed = [r for r in group.ride_requests if r.status == RideRequestStatus.CONFIRMED]

        # Reset unconfirmed members to pending
        for u in unconfirmed:
            transition_ride_request(db, u, RideRequestStatus.PENDING)
            u.group_id = None
            u.accept_expires_at = None

        if len(confirmed) >= 2:
            # Group can continue with confirmed members
            station = db.get(Station, group.station_id)
            dests = [{
                "ride_request_id": r.id,
                "dest_lat": r.dest_lat,
                "dest_lng": r.dest_lng,
                "dest_name": r.dest_name,
            } for r in confirmed]
            transition_ride_group(db, group, RideGroupStatus.CONFIRMED)
            _finalize_group(db, group, dests, station)
        else:
            # Dissolve group
            for c in confirmed:
                transition_ride_request(db, c, RideRequestStatus.PENDING)
                c.group_id = None
                c.accept_expires_at = None
            if group.driver:
                group.driver.available = True
            transition_ride_group(db, group, RideGroupStatus.CANCELLED)
            db.delete(group)

    db.commit()

    # 2. Auto-match pending shared requests
    pending_rides = (
        db.query(RideRequest)
        .filter(
            RideRequest.status == RideRequestStatus.PENDING,
            RideRequest.ride_type == "shared",
        )
        .order_by(RideRequest.created_at.asc())
        .all()
    )

    for ride in pending_rides:
        if ride.status == RideRequestStatus.PENDING:
            match_ride(db, ride)
