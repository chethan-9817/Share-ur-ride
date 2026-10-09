"""
Fare Calculation Service
========================
Computes solo fares, shared fares, and per-passenger savings.

Fare Model:
  Solo Fare   = BASE_FARE + (direct_distance_km × RATE_PER_KM)
  Group Fare  = BASE_FARE + (optimized_route_km × RATE_PER_KM)
                (BASE_FARE is charged once for the whole group, not per person)

Split Strategy (proportional to solo distance):
  Each passenger's weight  = their solo_distance
  Total weight             = sum of all solo_distances
  Passenger's share        = (weight / total_weight) × group_fare

  This is fair because:
  - You pay proportional to how far YOU are going
  - Passengers going farther pay more, but still less than solo
  - Nobody subsidizes someone else's longer trip

Savings:
  savings_pct = (1 − shared_fare / solo_fare) × 100
"""

from typing import List, Dict, Tuple
from ..config import settings
from .routing import haversine


def calculate_solo_fare(distance_km: float) -> float:
    """
    Calculate the fare for a solo (unshared) ride.

    Formula: BASE_FARE + distance_km × RATE_PER_KM

    Example:
        20 km ride → ₹50 + 20 × ₹12 = ₹290
    """
    return round(settings.BASE_FARE + distance_km * settings.RATE_PER_KM, 2)


def calculate_group_fare(total_route_km: float) -> float:
    """
    Calculate the total fare for the group's optimized route.

    The base fare is charged ONCE for the entire group (not per person),
    which is the main source of savings alongside the shorter combined route.
    """
    return round(settings.BASE_FARE + total_route_km * settings.RATE_PER_KM, 2)


def split_fare(
    passengers: List[Dict],
    total_route_km: float,
    station_lat: float,
    station_lng: float
) -> List[Dict]:
    """
    Split the group fare proportionally based on each passenger's solo distance.

    Args:
        passengers: List of dicts with keys:
            ride_request_id, dest_lat, dest_lng, dest_name, user_id
        total_route_km: The optimized group route distance
        station_lat, station_lng: Origin station coordinates

    Returns:
        List of dicts, each containing:
            ride_request_id, solo_distance_km, solo_fare,
            shared_fare, savings_pct, weight

    Worked Example (3 passengers from Kempegowda Airport):
    ┌──────────┬────────────┬────────────┬───────────┬──────────┬─────────┐
    │ Passenger │ Solo Dist  │ Solo Fare  │ Weight    │ Shared   │ Savings │
    ├──────────┼────────────┼────────────┼───────────┼──────────┼─────────┤
    │ A        │ 20 km      │ ₹290       │ 20/53     │ ₹132     │ 54%     │
    │ B        │ 15 km      │ ₹230       │ 15/53     │ ₹99      │ 57%     │
    │ C        │ 18 km      │ ₹266       │ 18/53     │ ₹119     │ 55%     │
    ├──────────┼────────────┼────────────┼───────────┼──────────┼─────────┤
    │ TOTAL    │            │            │           │ ₹350     │         │
    └──────────┴────────────┴────────────┴───────────┴──────────┴─────────┘
    Optimized route: 25 km → Group fare = ₹50 + 25×₹12 = ₹350
    """
    group_fare = calculate_group_fare(total_route_km)
    result = []

    # Step 1: Calculate each passenger's solo distance (their "weight")
    for p in passengers:
        solo_dist = haversine(station_lat, station_lng, p["dest_lat"], p["dest_lng"])
        p["solo_distance_km"] = solo_dist
        p["solo_fare"] = calculate_solo_fare(solo_dist)

    # Step 2: Sum of all weights
    total_weight = sum(p["solo_distance_km"] for p in passengers)

    if total_weight == 0:
        # Edge case: all passengers at the station (0 distance)
        equal_share = group_fare / len(passengers)
        for p in passengers:
            result.append({
                "ride_request_id": p["ride_request_id"],
                "solo_distance_km": 0,
                "solo_fare": settings.BASE_FARE,
                "shared_fare": round(equal_share, 2),
                "savings_pct": round((1 - equal_share / settings.BASE_FARE) * 100, 1),
                "weight": 0,
            })
        return result

    # Step 3: Proportional split
    for p in passengers:
        weight = p["solo_distance_km"] / total_weight
        shared_fare = round(group_fare * weight, 2)
        solo_fare = p["solo_fare"]

        # Savings can't be negative (shared should always be cheaper)
        savings = max(0, round((1 - shared_fare / solo_fare) * 100, 1)) if solo_fare > 0 else 0

        result.append({
            "ride_request_id": p["ride_request_id"],
            "solo_distance_km": round(p["solo_distance_km"], 2),
            "solo_fare": solo_fare,
            "shared_fare": shared_fare,
            "savings_pct": savings,
            "weight": round(weight, 4),
        })

    return result
