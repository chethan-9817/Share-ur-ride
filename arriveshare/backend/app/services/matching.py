"""
Matching Engine
===============
The heart of ArriveShare. Groups passengers into shared cabs.

Algorithm Overview:
  1. FILTER    — Same station, arrival within ±TIME_WINDOW_MINUTES
  2. SCORE     — Calculate detour for each candidate pair
  3. CLUSTER   — Greedy grouping respecting capacity and max detour
  4. OPTIMIZE  — Nearest-neighbor drop-off ordering
  5. PRICE     — Proportional fare split with savings

Complexity: O(n²) for n pending requests at one station.
For 30 seeded passengers this is < 1 ms.

Design Decisions:
  - We use a greedy approach instead of optimal clustering (NP-hard)
    because groups are small (≤4) and the result is good enough.
  - Haversine is used for all distance checks during matching.
    OSRM (real road distance) is called only after a match is confirmed.
  - A passenger can decline a match and re-enter the pool.
"""

from datetime import timedelta
from typing import List, Optional, Tuple, Dict
from sqlalchemy.orm import Session

from ..config import settings
from ..models import RideRequest, RideGroup, Station, Driver
from .routing import haversine, calculate_detour, optimize_drop_order
from .fare import split_fare, calculate_solo_fare, calculate_group_fare


def find_candidates(
    db: Session,
    ride: RideRequest
) -> List[RideRequest]:
    """
    Step 1: Find all pending shared ride requests that could match.

    Criteria:
      - Same station as the requesting passenger
      - Arrival time within ±TIME_WINDOW_MINUTES
      - Status is 'pending' (not already matched)
      - Ride type is 'shared' (not solo)
      - Not the same user
    """
    time_window = timedelta(minutes=settings.TIME_WINDOW_MINUTES)
    min_time = ride.arrival_time - time_window
    max_time = ride.arrival_time + time_window

    candidates = (
        db.query(RideRequest)
        .filter(
            RideRequest.station_id == ride.station_id,
            RideRequest.arrival_time >= min_time,
            RideRequest.arrival_time <= max_time,
            RideRequest.status == "pending",
            RideRequest.ride_type == "shared",
            RideRequest.id != ride.id,
            RideRequest.user_id != ride.user_id,
        )
        .all()
    )
    return candidates


def score_candidate(
    station: Station,
    ride: RideRequest,
    candidate: RideRequest
) -> float:
    """
    Step 2: Calculate the detour score for pairing two rides.

    Lower detour = better match.
    Returns the detour in km, or float('inf') if incompatible.

    A pair is compatible if:
      - Destinations are within DETOUR_THRESHOLD_KM of each other, OR
      - The detour of combining them is within DETOUR_THRESHOLD_KM
    """
    # Quick check: direct distance between destinations
    dest_distance = haversine(
        ride.dest_lat, ride.dest_lng,
        candidate.dest_lat, candidate.dest_lng
    )

    # If destinations are very close (< 1 km), it's essentially the same place
    if dest_distance < 1.0:
        return 0.0

    # Calculate the actual detour of combining the trips
    detour = calculate_detour(
        station.latitude, station.longitude,
        ride.dest_lat, ride.dest_lng,
        candidate.dest_lat, candidate.dest_lng
    )

    # Accept if detour is within threshold
    if detour <= settings.DETOUR_THRESHOLD_KM:
        return detour

    return float("inf")  # Incompatible


def _group_detour_check(
    station: Station,
    current_dests: List[Dict],
    new_dest: Dict
) -> bool:
    """
    Check if adding a new destination to an existing group
    keeps every existing passenger's detour within MAX_DETOUR_KM.

    We recompute the optimized route with the new destination
    and verify no single passenger's travel distance increases
    beyond their solo distance + MAX_DETOUR_KM.
    """
    all_dests = current_dests + [new_dest]

    # Optimize the route with all destinations
    ordered, total_dist = optimize_drop_order(
        station.latitude, station.longitude, 
        [dict(d) for d in all_dests]  # copy to avoid mutating
    )

    # Check each passenger's effective distance in the shared route
    current_lat, current_lng = station.latitude, station.longitude
    for stop in ordered:
        leg_dist = haversine(current_lat, current_lng, stop["dest_lat"], stop["dest_lng"])
        solo_dist = haversine(
            station.latitude, station.longitude,
            stop["dest_lat"], stop["dest_lng"]
        )
        # The accumulated distance up to this stop
        # is their effective travel distance
        accumulated = sum(
            haversine(
                (station.latitude if i == 0 else ordered[i-1]["dest_lat"]),
                (station.longitude if i == 0 else ordered[i-1]["dest_lng"]),
                ordered[i]["dest_lat"], ordered[i]["dest_lng"]
            )
            for i in range(ordered.index(stop) + 1)
        )
        if accumulated - solo_dist > settings.MAX_DETOUR_KM:
            return False
        current_lat, current_lng = stop["dest_lat"], stop["dest_lng"]

    return True


def match_ride(
    db: Session,
    ride: RideRequest
) -> Optional[Dict]:
    """
    Main matching function. Attempts to find or create a group
    for the given ride request.

    Returns:
        A dict with match result info, or None if no match found.
        If no match, the ride stays 'pending' for future matching
        or the passenger can choose solo.

    Algorithm:
      1. Find time-window candidates at the same station
      2. Score each candidate by detour
      3. Try to add to an existing forming group first
      4. If no group, create a new one with the best candidate(s)
      5. Respect capacity limits; overflow → second group
      6. Optimize drop-off order and calculate fares
    """
    station = db.query(Station).get(ride.station_id)
    if not station:
        return None

    # Calculate solo fare upfront
    solo_dist = haversine(station.latitude, station.longitude, ride.dest_lat, ride.dest_lng)
    ride.solo_fare = calculate_solo_fare(solo_dist)

    # ── Try to join an existing forming group ─────────────────────
    existing_groups = (
        db.query(RideGroup)
        .filter(
            RideGroup.station_id == ride.station_id,
            RideGroup.status == "forming",
        )
        .all()
    )

    for group in existing_groups:
        members = group.ride_requests
        if len(members) >= group.capacity:
            continue  # Group is full

        # Check time window with all existing members
        time_window = timedelta(minutes=settings.TIME_WINDOW_MINUTES)
        time_ok = all(
            abs((ride.arrival_time - m.arrival_time).total_seconds()) <= time_window.total_seconds()
            for m in members
        )
        if not time_ok:
            continue

        # Check detour compatibility with existing group
        current_dests = [
            {"ride_request_id": m.id, "dest_lat": m.dest_lat,
             "dest_lng": m.dest_lng, "dest_name": m.dest_name}
            for m in members
        ]
        new_dest = {
            "ride_request_id": ride.id, "dest_lat": ride.dest_lat,
            "dest_lng": ride.dest_lng, "dest_name": ride.dest_name
        }

        if _group_detour_check(station, current_dests, new_dest):
            # Add to this group
            ride.group_id = group.id
            ride.status = "matched"

            # Recompute route and fares for the whole group
            all_dests = current_dests + [new_dest]
            return _finalize_group(db, group, all_dests, station, requesting_ride_id=ride.id)

    # ── No existing group fits → try to create a new one ──────────
    candidates = find_candidates(db, ride)

    # Score and sort candidates by detour (best matches first)
    scored = []
    for c in candidates:
        detour = score_candidate(station, ride, c)
        if detour < float("inf"):
            scored.append((c, detour))

    scored.sort(key=lambda x: x[1])

    if not scored:
        # No matches available
        ride.solo_fare = calculate_solo_fare(solo_dist)
        db.commit()
        return None

    # Create a new group
    group = RideGroup(
        station_id=ride.station_id,
        status="forming",
        capacity=settings.CAB_CAPACITY,
    )
    db.add(group)
    db.flush()  # Get the group ID

    # Add the requesting ride
    ride.group_id = group.id
    ride.status = "matched"

    group_dests = [{
        "ride_request_id": ride.id,
        "dest_lat": ride.dest_lat,
        "dest_lng": ride.dest_lng,
        "dest_name": ride.dest_name,
    }]

    # Add compatible candidates up to capacity
    for candidate, detour in scored:
        if len(group_dests) >= settings.CAB_CAPACITY:
            break

        new_dest = {
            "ride_request_id": candidate.id,
            "dest_lat": candidate.dest_lat,
            "dest_lng": candidate.dest_lng,
            "dest_name": candidate.dest_name,
        }

        if _group_detour_check(station, group_dests, new_dest):
            candidate.group_id = group.id
            candidate.status = "matched"
            group_dests.append(new_dest)

    if len(group_dests) < 2:
        # Only one person in the group — no real match
        ride.group_id = None
        ride.status = "pending"
        db.delete(group)
        db.commit()
        return None

    return _finalize_group(db, group, group_dests, station, requesting_ride_id=ride.id)


def _finalize_group(
    db: Session,
    group: RideGroup,
    destinations: List[Dict],
    station: Station,
    requesting_ride_id: Optional[int] = None,
) -> Dict:
    """
    After forming a group, optimize the route, calculate fares,
    assign a driver, and return the match result.
    """
    # Step 4: Optimize drop-off order
    ordered, total_distance = optimize_drop_order(
        station.latitude, station.longitude, destinations
    )

    group.total_distance_km = round(total_distance, 2)
    group.total_fare = calculate_group_fare(total_distance)

    # Step 5: Calculate fair fare split
    passengers_data = []
    for dest in ordered:
        passengers_data.append({
            "ride_request_id": dest["ride_request_id"],
            "dest_lat": dest["dest_lat"],
            "dest_lng": dest["dest_lng"],
            "dest_name": dest["dest_name"],
        })

    fare_splits = split_fare(
        passengers_data, total_distance,
        station.latitude, station.longitude
    )

    # Update each ride request with fare info and drop order
    for dest in ordered:
        ride_req = db.query(RideRequest).get(dest["ride_request_id"])
        if ride_req:
            ride_req.drop_order = dest["order"]
            fare_info = next(
                (f for f in fare_splits if f["ride_request_id"] == dest["ride_request_id"]),
                None
            )
            if fare_info:
                ride_req.solo_fare = fare_info["solo_fare"]
                ride_req.shared_fare = fare_info["shared_fare"]
                ride_req.savings_pct = fare_info["savings_pct"]

    # Assign a mock driver (pick first available)
    driver = (
        db.query(Driver)
        .filter(Driver.available == True, Driver.seats >= len(ordered))
        .first()
    )
    if driver:
        group.driver_id = driver.id
        driver.available = False

    db.commit()

    # Build response: specific fare for the requesting passenger
    target_id = requesting_ride_id or ordered[0]["ride_request_id"]
    fare_info = next(
        (f for f in fare_splits if f["ride_request_id"] == target_id),
        fare_splits[0]
    )

    co_travelers = []
    for dest in ordered:
        if requesting_ride_id and dest["ride_request_id"] == requesting_ride_id:
            continue
        rr = db.query(RideRequest).get(dest["ride_request_id"])
        if rr and rr.user:
            co_travelers.append({
                "first_name": rr.user.name.split()[0],
                "verified": rr.user.verified,
                "dest_name": rr.dest_name,
                "drop_order": dest["order"],
            })

    return {
        "group_id": group.id,
        "co_travelers": co_travelers,
        "dropoff_order": [
            {"order": d["order"], "dest_name": d["dest_name"],
             "lat": d["dest_lat"], "lng": d["dest_lng"]}
            for d in ordered
        ],
        "total_route_km": round(total_distance, 2),
        "solo_fare": fare_info["solo_fare"],
        "shared_fare": fare_info["shared_fare"],
        "savings_pct": fare_info["savings_pct"],
        "message": f"You save {fare_info['savings_pct']}%!",
    }


def decline_and_rematch(db: Session, ride: RideRequest) -> Optional[Dict]:
    """
    Passenger declines a match. Remove them from the group,
    recompute fares for remaining members, and re-enter the pool.
    """
    old_group_id = ride.group_id

    # Remove from current group
    ride.group_id = None
    ride.status = "pending"
    ride.shared_fare = None
    ride.savings_pct = None
    ride.drop_order = None

    if old_group_id:
        group = db.query(RideGroup).get(old_group_id)
        if group:
            remaining = [r for r in group.ride_requests if r.id != ride.id]
            if len(remaining) < 2:
                # Group no longer viable, dissolve it
                for r in remaining:
                    r.group_id = None
                    r.status = "pending"
                    r.shared_fare = None
                    r.savings_pct = None
                    r.drop_order = None
                # Free the driver
                if group.driver:
                    group.driver.available = True
                db.delete(group)
            else:
                # Recompute for remaining members
                station = db.query(Station).get(group.station_id)
                dests = [{
                    "ride_request_id": r.id,
                    "dest_lat": r.dest_lat,
                    "dest_lng": r.dest_lng,
                    "dest_name": r.dest_name,
                } for r in remaining]
                _finalize_group(db, group, dests, station)

    db.commit()

    # Try to find a new match
    return match_ride(db, ride)
