"""
Routing Service
===============
Handles distance, detour, OSRM road queries, and permutation route optimization.

Key Improvements (Milestone 1):
  1. Exact Permutations: With N <= 4 stops, all permutations (N! <= 24) are evaluated
     to guarantee the true minimum distance while checking each rider's max detour.
  2. Dual Detour Model: Detour <= min(solo_dist * MAX_DETOUR_PCT, MAX_DETOUR_KM).
  3. Bounding-Box Pre-Filter: O(1) coordinate reject before distance math.
  4. Cached OSRM with Timeout & Fallback: In-memory cache + 3s timeout to Haversine fallback.
"""

import math
import time
import itertools
import httpx
from typing import List, Tuple, Dict, Optional
from ..config import settings

# ── In-Memory OSRM Cache ──────────────────────────────────────────────
# Key: tuple of rounded (lat, lng) coords, Value: (distance_km, points, timestamp)
_OSRM_CACHE: Dict[Tuple[Tuple[float, float], ...], Tuple[float, List[Tuple[float, float]], float]] = {}
_CACHE_TTL_SECONDS = 3600  # 1 hour cache


# ── Haversine (Fast, Offline) ─────────────────────────────────────────

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points on Earth in kilometers.
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


# ── Bounding-Box Pre-Filter ───────────────────────────────────────────

def bounding_box_filter(
    lat1: float, lon1: float,
    lat2: float, lon2: float,
    max_km: float
) -> bool:
    """
    Ultra-fast O(1) pre-filter checking if point 2 is within a bounding box
    of max_km around point 1.
    1 degree latitude ~= 111 km.
    1 degree longitude ~= 111 * cos(lat) km.
    """
    lat_delta_deg = max_km / 111.0
    # Guard latitude at poles
    cos_lat = math.cos(math.radians(lat1))
    lon_delta_deg = max_km / (111.0 * max(0.01, cos_lat))

    if abs(lat2 - lat1) > lat_delta_deg or abs(lon2 - lon1) > lon_delta_deg:
        return False
    return True


# ── Detour Model ──────────────────────────────────────────────────────

def is_detour_compatible(
    solo_distance_km: float,
    added_detour_km: float,
    max_detour_pct: Optional[float] = None,
    max_detour_km: Optional[float] = None,
) -> bool:
    """
    Dual-constraint detour rule:
    Extra distance added must be <= (solo_distance * MAX_DETOUR_PCT)
    AND <= MAX_DETOUR_KM.
    """
    pct_limit = max_detour_pct if max_detour_pct is not None else settings.MAX_DETOUR_PCT
    km_limit = max_detour_km if max_detour_km is not None else settings.MAX_DETOUR_KM

    allowed_detour = min(solo_distance_km * pct_limit, km_limit)
    return added_detour_km <= (allowed_detour + 1e-6)


def calculate_detour(
    station_lat: float, station_lng: float,
    dest_a_lat: float, dest_a_lng: float,
    dest_b_lat: float, dest_b_lng: float
) -> float:
    """
    Calculate the extra distance caused by combining destinations A and B:
    Detour = min(S->A->B, S->B->A) - max(S->A, S->B)
    """
    dist_s_a = haversine(station_lat, station_lng, dest_a_lat, dest_a_lng)
    dist_s_b = haversine(station_lat, station_lng, dest_b_lat, dest_b_lng)
    dist_a_b = haversine(dest_a_lat, dest_a_lng, dest_b_lat, dest_b_lng)

    route_a_first = dist_s_a + dist_a_b
    route_b_first = dist_s_b + dist_a_b

    best_combined = min(route_a_first, route_b_first)
    longest_solo = max(dist_s_a, dist_s_b)

    return best_combined - longest_solo


# ── Exact Permutation Drop-Order Routing ──────────────────────────────

def optimize_drop_order_exact(
    station_lat: float, station_lng: float,
    destinations: List[Dict],
    max_detour_km: Optional[float] = None,
    max_detour_pct: Optional[float] = None,
) -> Tuple[List[Dict], float, bool]:
    """
    Evaluate all N! permutations (N <= 4) to find the order that minimizes
    total route distance while strictly enforcing every passenger's max detour.

    Args:
        station_lat, station_lng: Origin station coordinates
        destinations: List of dicts with:
            ride_request_id, dest_lat, dest_lng, dest_name, (optional solo_distance_km)
        max_detour_km: Cap in km (default from settings)
        max_detour_pct: Fraction of solo distance (default from settings)

    Returns:
        (best_ordered_destinations, best_total_distance_km, is_valid)
        Each destination dict receives an 'order' field (1-based).
        is_valid is True if every passenger's detour is within limits.
    """
    if not destinations:
        return [], 0.0, True

    if len(destinations) == 1:
        single = dict(destinations[0])
        dist = haversine(station_lat, station_lng, single["dest_lat"], single["dest_lng"])
        single["order"] = 1
        return [single], round(dist, 2), True

    pct_limit = max_detour_pct if max_detour_pct is not None else settings.MAX_DETOUR_PCT
    km_limit = max_detour_km if max_detour_km is not None else settings.MAX_DETOUR_KM

    best_order = None
    best_distance = float("inf")
    best_valid = False

    # Precalculate solo distances
    solo_dists = {}
    for d in destinations:
        s_id = d["ride_request_id"]
        solo_dists[s_id] = haversine(station_lat, station_lng, d["dest_lat"], d["dest_lng"])

    # Brute-force all permutations
    for perm in itertools.permutations(destinations):
        perm_list = list(perm)
        current_lat, current_lng = station_lat, station_lng
        accumulated_dist = 0.0
        perm_valid = True

        for stop in perm_list:
            leg_dist = haversine(current_lat, current_lng, stop["dest_lat"], stop["dest_lng"])
            accumulated_dist += leg_dist
            current_lat, current_lng = stop["dest_lat"], stop["dest_lng"]

            # Detour check for this passenger in this position
            s_id = stop["ride_request_id"]
            solo_dist = solo_dists[s_id]
            detour = accumulated_dist - solo_dist

            allowed_detour = min(solo_dist * pct_limit, km_limit)
            if detour > (allowed_detour + 1e-6):
                perm_valid = False
                break

        # We prefer valid permutations; among valid, lowest distance wins.
        # If no valid permutation exists, pick shortest distance as fallback with is_valid=False.
        if perm_valid:
            if not best_valid or accumulated_dist < best_distance:
                best_distance = accumulated_dist
                best_order = perm_list
                best_valid = True
        elif not best_valid:
            if accumulated_dist < best_distance:
                best_distance = accumulated_dist
                best_order = perm_list
                best_valid = False

    result_list = []
    for idx, d in enumerate(best_order or destinations, start=1):
        item = dict(d)
        item["order"] = idx
        result_list.append(item)

    return result_list, round(best_distance, 2), best_valid


def optimize_drop_order(
    station_lat: float, station_lng: float,
    destinations: List[Dict]
) -> Tuple[List[Dict], float]:
    """
    Standard drop-order interface (calls exact permutation solver).
    Returns (ordered_destinations, total_distance_km).
    """
    ordered, dist, _ = optimize_drop_order_exact(station_lat, station_lng, destinations)
    return ordered, dist


# ── OSRM Road Distance (Cached, Timeout, Fallback) ───────────────────

def _cache_key(coords: List[Tuple[float, float]]) -> Tuple[Tuple[float, float], ...]:
    # Round to 4 decimal places (~11 meters) for cache hit rate
    return tuple((round(lat, 4), round(lng, 4)) for lat, lng in coords)


async def get_osrm_distance(
    coords: List[Tuple[float, float]]
) -> Tuple[float, List[Tuple[float, float]]]:
    """
    Query road distance for coordinates via OSRM.
    Features:
      - In-memory TTL cache
      - Strict timeout with settings.OSRM_TIMEOUT_SECONDS
      - Haversine fallback on failure or timeout
    """
    if len(coords) < 2:
        return 0.0, []

    key = _cache_key(coords)
    now = time.time()

    # Check cache
    if key in _OSRM_CACHE:
        dist, points, cached_time = _OSRM_CACHE[key]
        if now - cached_time < _CACHE_TTL_SECONDS:
            return dist, points

    coord_str = ";".join(f"{lng},{lat}" for lat, lng in coords)
    url = f"{settings.OSRM_BASE_URL}/route/v1/driving/{coord_str}"
    params = {"overview": "simplified", "geometries": "geojson"}

    try:
        timeout = getattr(settings, "OSRM_TIMEOUT_SECONDS", 3.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

        if data.get("code") == "Ok" and data.get("routes"):
            route = data["routes"][0]
            distance_km = round(route["distance"] / 1000.0, 2)
            geometry = route.get("geometry", {}).get("coordinates", [])
            points = [(pt[1], pt[0]) for pt in geometry]

            # Cache the result
            _OSRM_CACHE[key] = (distance_km, points, now)
            return distance_km, points
    except Exception:
        pass  # Fall through to haversine fallback

    # Fallback: sum of haversine distances
    total = sum(
        haversine(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1])
        for i in range(len(coords) - 1)
    )
    return round(total, 2), coords


def get_solo_distance(
    station_lat: float, station_lng: float,
    dest_lat: float, dest_lng: float
) -> float:
    """Direct distance from station to destination."""
    return round(haversine(station_lat, station_lng, dest_lat, dest_lng), 2)
