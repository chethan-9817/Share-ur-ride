"""
Routing Service
===============
Handles all distance and route calculations.

Strategy:
  1. Haversine — instant, used for fast filtering (O(1) per pair)
  2. OSRM     — real road distances, used only for matched groups
  3. Nearest-neighbor — greedy drop-off ordering for small groups

We prefer haversine for filtering because the OSRM public server
has rate limits. OSRM is called only after a match is confirmed
to get accurate road distances for fare calculation.
"""

import math
import httpx
from typing import List, Tuple, Dict
from ..config import settings


# ── Haversine (fast, offline) ─────────────────────────────────────────

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points on Earth.

    Args:
        lat1, lon1: Coordinates of point A (degrees)
        lat2, lon2: Coordinates of point B (degrees)

    Returns:
        Distance in kilometers.

    Formula:
        a = sin²(Δlat/2) + cos(lat1) · cos(lat2) · sin²(Δlon/2)
        c = 2 · arcsin(√a)
        d = R · c   where R = 6371 km
    """
    R = 6371.0  # Earth's radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) *
         math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    c = 2 * math.asin(math.sqrt(a))
    return R * c


# ── Detour Calculation ────────────────────────────────────────────────

def calculate_detour(
    station_lat: float, station_lng: float,
    dest_a_lat: float, dest_a_lng: float,
    dest_b_lat: float, dest_b_lng: float
) -> float:
    """
    Calculate the extra distance caused by adding destination B
    to a trip from station → destination A (or vice versa).

    Detour = min(S→A→B, S→B→A) − max(S→A, S→B)

    A small detour means B is "along the way" to A or very close to it.
    If detour ≤ DETOUR_THRESHOLD_KM, the two are compatible for sharing.

    Returns:
        Detour in km (can be negative if B is strictly between S and A).
    """
    dist_s_a = haversine(station_lat, station_lng, dest_a_lat, dest_a_lng)
    dist_s_b = haversine(station_lat, station_lng, dest_b_lat, dest_b_lng)
    dist_a_b = haversine(dest_a_lat, dest_a_lng, dest_b_lat, dest_b_lng)

    # Two possible orderings for the shared route
    route_a_first = dist_s_a + dist_a_b   # S → A → B
    route_b_first = dist_s_b + dist_a_b   # S → B → A

    best_combined = min(route_a_first, route_b_first)
    longest_solo = max(dist_s_a, dist_s_b)

    return best_combined - longest_solo


# ── Nearest-Neighbor Route Optimization ───────────────────────────────

def optimize_drop_order(
    station_lat: float, station_lng: float,
    destinations: List[Dict]
) -> Tuple[List[Dict], float]:
    """
    Given a station (start point) and a list of passenger destinations,
    compute the drop-off order that minimizes total travel distance
    using the greedy nearest-neighbor heuristic.

    This is O(n²) but n ≤ 4, so it's instant.

    Args:
        station_lat, station_lng: Starting coordinates
        destinations: List of dicts with keys:
            ride_request_id, dest_lat, dest_lng, dest_name

    Returns:
        (ordered_destinations, total_distance_km)
        Each destination dict gets an added 'order' key (1-based).
    """
    if not destinations:
        return [], 0.0

    remaining = list(destinations)
    ordered = []
    current_lat, current_lng = station_lat, station_lng
    total_distance = 0.0

    while remaining:
        # Find the nearest unvisited destination
        nearest = min(
            remaining,
            key=lambda d: haversine(current_lat, current_lng, d["dest_lat"], d["dest_lng"])
        )
        dist_to_nearest = haversine(
            current_lat, current_lng,
            nearest["dest_lat"], nearest["dest_lng"]
        )

        total_distance += dist_to_nearest
        nearest["order"] = len(ordered) + 1
        ordered.append(nearest)
        remaining.remove(nearest)
        current_lat, current_lng = nearest["dest_lat"], nearest["dest_lng"]

    return ordered, total_distance


# ── OSRM Road Distance (optional, with fallback) ─────────────────────

async def get_osrm_distance(
    coords: List[Tuple[float, float]]
) -> Tuple[float, List[Tuple[float, float]]]:
    """
    Get the actual road distance for a sequence of coordinates via OSRM.

    Args:
        coords: List of (latitude, longitude) tuples in visit order.

    Returns:
        (total_distance_km, route_geometry_points)

    Falls back to haversine sum if OSRM is unavailable.
    """
    if len(coords) < 2:
        return 0.0, []

    # OSRM expects lng,lat (note the order!)
    coord_str = ";".join(f"{lng},{lat}" for lat, lng in coords)
    url = f"{settings.OSRM_BASE_URL}/route/v1/driving/{coord_str}"
    params = {"overview": "simplified", "geometries": "geojson"}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

        if data.get("code") == "Ok" and data.get("routes"):
            route = data["routes"][0]
            distance_km = route["distance"] / 1000.0
            geometry = route.get("geometry", {}).get("coordinates", [])
            # Convert from [lng, lat] to (lat, lng)
            points = [(pt[1], pt[0]) for pt in geometry]
            return distance_km, points
    except Exception:
        pass  # Fall through to haversine fallback

    # Fallback: sum of haversine distances between consecutive points
    total = sum(
        haversine(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1])
        for i in range(len(coords) - 1)
    )
    return total, []


def get_solo_distance(
    station_lat: float, station_lng: float,
    dest_lat: float, dest_lng: float
) -> float:
    """Direct haversine distance from station to one destination."""
    return haversine(station_lat, station_lng, dest_lat, dest_lng)
