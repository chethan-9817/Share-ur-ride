"""
Unified Fare Calculation Service
=================================
One authoritative fare engine used across quotes, matching, and final billing.

Core Principles:
  1. Single Fare Formula:
     Fare = BASE_FARE + (distance_km * RATE_PER_KM)
  2. Proportional Share:
     Each rider's weight = their own solo distance.
     Shared fare = (weight / sum_weights) * total_group_fare.
  3. No Rider Pays More Than Solo:
     Shared fare is strictly capped at solo fare.
  4. Complete Breakdown Object:
     Returns solo fare, shared fare, savings in INR and %, and distance share %.
  5. Price Guarantee Protection:
     If a co-passenger cancels and fare would increase, rider keeps their
     locked accepted_fare. The platform absorbs the delta as platform_subsidy.
"""

from typing import List, Dict, Tuple, Optional
from ..config import settings
from .routing import haversine


def compute_fare(distance_km: float) -> float:
    """
    The ONE canonical fare function used for quotes and final calculations.
    Formula: BASE_FARE + distance_km * RATE_PER_KM
    """
    clean_dist = max(0.0, float(distance_km))
    return round(settings.BASE_FARE + clean_dist * settings.RATE_PER_KM, 2)


# Backwards-compatible aliases
def calculate_solo_fare(distance_km: float) -> float:
    return compute_fare(distance_km)


def calculate_group_fare(total_route_km: float) -> float:
    return compute_fare(total_route_km)


def split_fare(
    passengers: List[Dict],
    total_route_km: float,
    station_lat: float,
    station_lng: float
) -> List[Dict]:
    """
    Split the total group fare proportionally based on each rider's solo distance.

    Args:
        passengers: List of dicts with keys:
            ride_request_id, dest_lat, dest_lng, dest_name, (optional solo_distance_km)
        total_route_km: Optimized group road distance
        station_lat, station_lng: Origin station coordinates

    Returns:
        List of dicts with full breakdown object:
            ride_request_id, solo_distance_km, solo_fare,
            shared_fare, savings_inr, savings_pct, distance_share_pct, weight
    """
    group_fare = compute_fare(total_route_km)
    result = []

    # Step 1: Compute solo distance and solo fare for each passenger
    for p in passengers:
        if "solo_distance_km" not in p or p["solo_distance_km"] is None:
            p["solo_distance_km"] = round(
                haversine(station_lat, station_lng, p["dest_lat"], p["dest_lng"]), 2
            )
        p["solo_fare"] = compute_fare(p["solo_distance_km"])

    total_weight = sum(p["solo_distance_km"] for p in passengers)

    # Edge case: zero total distance
    if total_weight <= 0:
        equal_fare = round(group_fare / max(1, len(passengers)), 2)
        for p in passengers:
            solo = p["solo_fare"]
            shared = min(equal_fare, solo)
            savings_inr = round(max(0.0, solo - shared), 2)
            savings_pct = round((savings_inr / solo) * 100, 1) if solo > 0 else 0.0
            result.append({
                "ride_request_id": p["ride_request_id"],
                "solo_distance_km": 0.0,
                "solo_fare": solo,
                "shared_fare": shared,
                "savings_inr": savings_inr,
                "savings_pct": savings_pct,
                "distance_share_pct": round(100.0 / len(passengers), 1),
                "weight": 0.0,
            })
        return result

    # Step 2: Proportional split with solo fare guardrail
    for p in passengers:
        solo_dist = p["solo_distance_km"]
        weight = solo_dist / total_weight
        raw_shared = round(group_fare * weight, 2)
        solo_fare = p["solo_fare"]

        # Strict guardrail: No rider ever pays more than solo fare
        shared_fare = min(raw_shared, solo_fare)
        savings_inr = round(max(0.0, solo_fare - shared_fare), 2)
        savings_pct = round((savings_inr / solo_fare) * 100, 1) if solo_fare > 0 else 0.0

        result.append({
            "ride_request_id": p["ride_request_id"],
            "solo_distance_km": solo_dist,
            "solo_fare": solo_fare,
            "shared_fare": shared_fare,
            "savings_inr": savings_inr,
            "savings_pct": savings_pct,
            "distance_share_pct": round(weight * 100, 1),
            "weight": round(weight, 4),
        })

    return result


def apply_price_guarantee(
    accepted_fare: Optional[float],
    new_calculated_shared_fare: float,
) -> Tuple[float, float]:
    """
    Enforce Price Guarantee:
    If a rider has already locked in an accepted_fare and the newly recalculated
    fare is higher (e.g., due to a co-passenger cancelling), the rider pays their
    locked accepted_fare. The platform absorbs the difference as a subsidy.

    Returns:
        (final_fare_charged_to_rider, platform_subsidy)
    """
    if accepted_fare is not None and accepted_fare > 0:
        if new_calculated_shared_fare > accepted_fare:
            subsidy = round(new_calculated_shared_fare - accepted_fare, 2)
            return accepted_fare, subsidy
    return new_calculated_shared_fare, 0.0
