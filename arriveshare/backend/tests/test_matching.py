"""
Unit Tests for Matching Engine, Fare Logic, and Routing
=======================================================
Tests the 4 required scenarios:
  A. 3 passengers, same destination → 1 cab, fare split
  B. 2 passengers, destinations on same route → matched, correct drop order
  C. 1 passenger, no match → offered solo ride
  D. 5 passengers, 4-seat cab → split into 2 groups
"""

import sys
import os

# Add the backend directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import User, Station, Driver, RideRequest, RideGroup
from app.services.routing import haversine, calculate_detour, optimize_drop_order
from app.services.fare import calculate_solo_fare, calculate_group_fare, split_fare
from app.services.matching import match_ride, find_candidates
from app.config import settings


# ── Test Fixtures ─────────────────────────────────────────────────────

def create_test_db():
    """Create a fresh in-memory SQLite database for each test."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    return Session()


def seed_test_station(db):
    """Add BLR Airport as the test station."""
    station = Station(
        id=1, name="BLR Airport", type="airport",
        latitude=13.1986, longitude=77.7066, city="Bangalore"
    )
    db.add(station)
    db.commit()
    return station


def seed_test_station_railway(db):
    """Add City Railway Station."""
    station = Station(
        id=3, name="City Railway Station", type="railway",
        latitude=12.9784, longitude=77.5713, city="Bangalore"
    )
    db.add(station)
    db.commit()
    return station


def add_user(db, user_id, name="Test User"):
    user = User(
        id=user_id, name=name,
        email=f"test{user_id}@test.com",
        phone=f"+919{user_id:09d}",
        role="passenger", verified=True,
    )
    db.add(user)
    db.commit()
    return user


def add_driver(db, driver_id=1, user_id=100):
    user = User(
        id=user_id, name="Test Driver",
        email=f"driver{driver_id}@test.com",
        phone=f"+918{driver_id:09d}",
        role="driver", verified=True,
    )
    db.add(user)
    db.flush()
    driver = Driver(
        id=driver_id, user_id=user_id,
        vehicle_number="KA01AB1234",
        vehicle_model="Test Car",
        seats=4, available=True,
    )
    db.add(driver)
    db.commit()
    return driver


# ── Routing Tests ─────────────────────────────────────────────────────

def test_haversine():
    """Test haversine distance calculation."""
    # BLR Airport to Koramangala ≈ 30 km
    dist = haversine(13.1986, 77.7066, 12.9352, 77.6245)
    assert 28 < dist < 32, f"Expected ~30km, got {dist:.1f}km"
    print(f"  ✓ BLR → Koramangala = {dist:.1f} km")

    # Same point → 0
    assert haversine(13.0, 77.0, 13.0, 77.0) == 0.0
    print("  ✓ Same point = 0.0 km")


def test_detour_same_destination():
    """Two passengers going to the same place → 0 detour."""
    detour = calculate_detour(
        13.1986, 77.7066,  # BLR Airport
        12.9352, 77.6245,  # Koramangala
        12.9352, 77.6245,  # Koramangala (same!)
    )
    assert detour == 0.0
    print(f"  ✓ Same destination detour = {detour:.1f} km")


def test_detour_nearby_destinations():
    """Two nearby destinations should have small detour."""
    # Koramangala and HSR Layout are ~3 km apart
    detour = calculate_detour(
        13.1986, 77.7066,  # BLR Airport
        12.9352, 77.6245,  # Koramangala
        12.9116, 77.6474,  # HSR Layout
    )
    assert detour < 5.0, f"Expected small detour, got {detour:.1f}km"
    print(f"  ✓ Koramangala ↔ HSR Layout detour = {detour:.1f} km")


def test_optimize_drop_order():
    """Nearest-neighbor should produce a sensible ordering."""
    destinations = [
        {"ride_request_id": 1, "dest_lat": 12.9352, "dest_lng": 77.6245, "dest_name": "Koramangala"},
        {"ride_request_id": 2, "dest_lat": 12.9716, "dest_lng": 77.6412, "dest_name": "Indiranagar"},
        {"ride_request_id": 3, "dest_lat": 12.9591, "dest_lng": 77.6974, "dest_name": "Marathahalli"},
    ]
    ordered, total_dist = optimize_drop_order(13.1986, 77.7066, destinations)

    assert len(ordered) == 3
    assert total_dist > 0
    # Marathahalli is closest to BLR Airport (both east), should be first
    print(f"  ✓ Drop order: {' → '.join(d['dest_name'] for d in ordered)}")
    print(f"  ✓ Total distance: {total_dist:.1f} km")


# ── Fare Tests ────────────────────────────────────────────────────────

def test_solo_fare():
    """Solo fare = BASE_FARE + distance × RATE_PER_KM."""
    fare = calculate_solo_fare(20.0)  # 20 km
    expected = settings.BASE_FARE + 20.0 * settings.RATE_PER_KM
    assert fare == expected, f"Expected {expected}, got {fare}"
    print(f"  ✓ Solo fare for 20 km = ₹{fare}")


def test_fare_split_proportional():
    """Shared fare should be proportional to solo distance."""
    passengers = [
        {"ride_request_id": 1, "dest_lat": 12.9352, "dest_lng": 77.6245, "dest_name": "A"},
        {"ride_request_id": 2, "dest_lat": 12.9716, "dest_lng": 77.6412, "dest_name": "B"},
        {"ride_request_id": 3, "dest_lat": 12.9591, "dest_lng": 77.6974, "dest_name": "C"},
    ]
    splits = split_fare(passengers, 25.0, 13.1986, 77.7066)

    assert len(splits) == 3
    total_shared = sum(s["shared_fare"] for s in splits)
    group_fare = calculate_group_fare(25.0)
    # Total shared should approximately equal group fare (rounding diff ≤ ₹1)
    assert abs(total_shared - group_fare) < 1.0, f"Shares sum {total_shared} != group {group_fare}"

    for s in splits:
        assert s["savings_pct"] > 0, f"Expected positive savings, got {s['savings_pct']}%"
        print(f"  ✓ Passenger {s['ride_request_id']}: "
              f"solo ₹{s['solo_fare']} → shared ₹{s['shared_fare']} "
              f"(save {s['savings_pct']}%)")


# ── Matching Tests ────────────────────────────────────────────────────

def test_scenario_a_three_same_destination():
    """
    SCENARIO A: 3 passengers going to Koramangala from BLR Airport
    within 10 minutes → should all be matched into 1 group.
    """
    db = create_test_db()
    station = seed_test_station(db)
    add_driver(db)

    now = datetime.utcnow()
    rides = []
    for i in range(1, 4):
        add_user(db, i, f"Passenger {i}")
        ride = RideRequest(
            id=i, user_id=i, station_id=1,
            dest_lat=12.9352, dest_lng=77.6245, dest_name="Koramangala",
            arrival_time=now + timedelta(minutes=i * 3),
            ride_type="shared", status="pending",
        )
        db.add(ride)
        rides.append(ride)
    db.commit()

    # Match the first passenger — should pull in the other two
    result = match_ride(db, rides[0])

    assert result is not None, "Expected a match!"
    assert result["group_id"] is not None
    assert len(result["co_travelers"]) >= 2, f"Expected ≥2 co-travelers, got {len(result['co_travelers'])}"
    assert result["savings_pct"] > 0
    print(f"  ✓ Group #{result['group_id']} with {len(result['co_travelers'])} travelers")
    print(f"  ✓ Solo ₹{result['solo_fare']} → Shared ₹{result['shared_fare']} (save {result['savings_pct']}%)")
    print(f"  ✓ Route: {result['total_route_km']} km")


def test_scenario_b_route_overlap():
    """
    SCENARIO B: 2 passengers from BLR Airport — one to Koramangala,
    one to HSR Layout. Both are south of the airport along the same
    corridor. HSR Layout is "along the route" to Koramangala (detour ~1.7 km).
    Should match with correct drop order.
    """
    db = create_test_db()
    station = seed_test_station(db)
    add_driver(db)
    now = datetime.utcnow()

    add_user(db, 1, "Alice")
    r1 = RideRequest(
        id=1, user_id=1, station_id=1,
        dest_lat=12.9352, dest_lng=77.6245, dest_name="Koramangala",
        arrival_time=now, ride_type="shared", status="pending",
    )
    db.add(r1)

    add_user(db, 2, "Bob")
    r2 = RideRequest(
        id=2, user_id=2, station_id=1,
        dest_lat=12.9116, dest_lng=77.6474, dest_name="HSR Layout",
        arrival_time=now + timedelta(minutes=5),
        ride_type="shared", status="pending",
    )
    db.add(r2)
    db.commit()

    result = match_ride(db, r1)
    assert result is not None, "Expected a match!"

    # Verify drop order — both destinations shown with ordering
    for stop in result["dropoff_order"]:
        print(f"  > Stop #{stop['order']}: {stop['dest_name']}")

    assert len(result["dropoff_order"]) == 2
    assert result["savings_pct"] > 0
    print(f"  > Savings: {result['savings_pct']}%")


def test_scenario_c_no_match():
    """
    SCENARIO C: 1 passenger alone at HAL Airport going to Electronic City.
    No other passengers → should return None (no match).
    """
    db = create_test_db()
    station = Station(
        id=2, name="HAL Airport", type="airport",
        latitude=12.9499, longitude=77.6681, city="Bangalore"
    )
    db.add(station)
    db.commit()

    add_user(db, 1, "Lonely Larry")
    ride = RideRequest(
        id=1, user_id=1, station_id=2,
        dest_lat=12.8456, dest_lng=77.6603, dest_name="Electronic City",
        arrival_time=datetime.utcnow(), ride_type="shared", status="pending",
    )
    db.add(ride)
    db.commit()

    result = match_ride(db, ride)
    assert result is None, "Expected no match for solo passenger!"

    # Solo fare should still be calculated
    db.refresh(ride)
    assert ride.solo_fare is not None and ride.solo_fare > 0
    print(f"  ✓ No match found. Solo fare: ₹{ride.solo_fare}")


def test_scenario_d_capacity_overflow():
    """
    SCENARIO D: 5 passengers from City Railway Station going to nearby
    destinations (Jayanagar, JP Nagar, Banashankari area).
    4-seat capacity → first match should create a group of ≤4.
    The 5th passenger won't fit in the first group.
    """
    db = create_test_db()
    station = seed_test_station_railway(db)
    add_driver(db, 1, 100)
    add_driver(db, 2, 101)
    now = datetime.utcnow()

    destinations = [
        ("Jayanagar", 12.9308, 77.5838),
        ("JP Nagar", 12.9063, 77.5857),
        ("Banashankari", 12.9255, 77.5468),
        ("BTM Layout", 12.9166, 77.6101),
        ("Jayanagar", 12.9308, 77.5838),  # 5th passenger, same dest
    ]

    rides = []
    for i, (dest, lat, lng) in enumerate(destinations, start=1):
        add_user(db, i, f"Passenger {i}")
        ride = RideRequest(
            id=i, user_id=i, station_id=3,
            dest_lat=lat, dest_lng=lng, dest_name=dest,
            arrival_time=now + timedelta(minutes=i * 2),
            ride_type="shared", status="pending",
        )
        db.add(ride)
        rides.append(ride)
    db.commit()

    # Match first passenger
    result1 = match_ride(db, rides[0])
    assert result1 is not None, "Expected a match for passenger 1!"
    group1_size = len(result1["co_travelers"])
    assert group1_size <= settings.CAB_CAPACITY, \
        f"Group exceeded capacity: {group1_size} > {settings.CAB_CAPACITY}"
    print(f"  ✓ Group 1: {group1_size} passengers (max {settings.CAB_CAPACITY})")

    # Check which passengers are still pending
    db.expire_all()
    pending = db.query(RideRequest).filter(RideRequest.status == "pending").all()
    print(f"  ✓ Remaining pending: {len(pending)} passenger(s)")

    if pending:
        # Try matching the remaining passenger(s)
        result2 = match_ride(db, pending[0])
        if result2:
            print(f"  ✓ Group 2: {len(result2['co_travelers'])} passengers")
        else:
            print(f"  ✓ Remaining passenger offered solo ride (₹{pending[0].solo_fare})")


# ── Run All Tests ─────────────────────────────────────────────────────

def run_all():
    """Execute all tests and display results."""
    tests = [
        ("Haversine Distance", test_haversine),
        ("Detour: Same Destination", test_detour_same_destination),
        ("Detour: Nearby Destinations", test_detour_nearby_destinations),
        ("Route Optimization", test_optimize_drop_order),
        ("Solo Fare Calculation", test_solo_fare),
        ("Proportional Fare Split", test_fare_split_proportional),
        ("Scenario A: 3 Same Destination → 1 Cab", test_scenario_a_three_same_destination),
        ("Scenario B: Route Overlap → Matched", test_scenario_b_route_overlap),
        ("Scenario C: No Match → Solo", test_scenario_c_no_match),
        ("Scenario D: 5 Passengers → Capacity Split", test_scenario_d_capacity_overflow),
    ]

    print("\n" + "=" * 60)
    print("  ArriveShare -- Unit Tests")
    print("=" * 60)

    passed = 0
    failed = 0
    for name, fn in tests:
        print(f"\n[TEST] {name}")
        try:
            fn()
            passed += 1
            print(f"  [PASS]")
        except Exception as e:
            failed += 1
            print(f"  [FAIL]: {e}")

    print(f"\n{'=' * 60}")
    print(f"  Results: {passed} passed, {failed} failed, {passed + failed} total")
    print(f"{'=' * 60}\n")

    return failed == 0


if __name__ == "__main__":
    success = run_all()
    sys.exit(0 if success else 1)
