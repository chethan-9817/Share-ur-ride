"""
Integration Tests for ArriveShare API Endpoints
=================================================
Tests all FastAPI REST endpoints using TestClient:
- Auth (register, send OTP, verify OTP)
- Stations listing
- Ride creation & retrieval
- Matching engine & co-travelers
- Trip sharing (safety notification simulation)
- Route geometry via OSRM/fallback
- Driver operations (toggle availability, assignment detail, status progression)
- Ride cancellation & group dissolution
"""

import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# UTF-8 stdout configuration for Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def login_user(email: str) -> str:
    """Helper to simulate OTP login and obtain JWT access token."""
    client.post("/api/auth/send-otp", json={"email": email})
    resp = client.post("/api/auth/verify-otp", json={"email": email, "otp": "1234"})
    assert resp.status_code == 200, f"Failed to login {email}: {resp.text}"
    return resp.json()["access_token"]


def test_stations_endpoint():
    """Verify stations endpoint returns seeded airport and railway hubs."""
    response = client.get("/api/stations")
    assert response.status_code == 200
    stations = response.json()
    assert len(stations) >= 3
    station_names = [s["name"] for s in stations]
    assert any("Airport" in name for name in station_names)
    print("  ✓ /api/stations returned stations:", [s["name"] for s in stations])


def test_auth_flows():
    """Verify registration and OTP login."""
    # Login existing seeded passenger
    p1_token = login_user("passenger1@arriveshare.test")
    p1_headers = {"Authorization": f"Bearer {p1_token}"}
    me_resp = client.get("/api/auth/me", headers=p1_headers)
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == "passenger1@arriveshare.test"
    print("  ✓ Passenger login & /api/auth/me verified for:", me_resp.json()["name"])

    # Login existing seeded driver
    d1_token = login_user("driver1@arriveshare.test")
    d1_headers = {"Authorization": f"Bearer {d1_token}"}
    driver_resp = client.get("/api/auth/me", headers=d1_headers)
    assert driver_resp.status_code == 200
    assert driver_resp.json()["role"] == "driver"
    print("  ✓ Driver login verified for:", driver_resp.json()["name"])

    # Register real new user — generates 6-digit email OTP while keeping demo users on 1234
    from app.database import SessionLocal
    from app.models import User
    new_email = "newuser_flow_test@example.com"
    # Ensure cleanup if leftover exists
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == new_email).first()
        if existing:
            db.delete(existing)
            db.commit()
    finally:
        db.close()

    reg_resp = client.post("/api/auth/register", json={
        "name": "New Traveler",
        "email": new_email,
        "phone": "+919988776655",
        "role": "passenger",
    })
    assert reg_resp.status_code == 200

    db = SessionLocal()
    try:
        user_in_db = db.query(User).filter(User.email == new_email).first()
        assert user_in_db is not None
        assert len(user_in_db.otp_code) == 6, f"Expected 6-digit OTP, got {user_in_db.otp_code}"
        otp_code = user_in_db.otp_code

        # Attempt with wrong OTP fails
        fail_resp = client.post("/api/auth/verify-otp", json={"email": new_email, "otp": "000000"})
        assert fail_resp.status_code == 400

        # Attempt with generated OTP succeeds
        verify_resp = client.post("/api/auth/verify-otp", json={"email": new_email, "otp": otp_code})
        assert verify_resp.status_code == 200
        assert "access_token" in verify_resp.json()
        print("  ✓ Real user email verification with 6-digit OTP verified successfully")

        # Cleanup test user
        db.delete(user_in_db)
        db.commit()
    finally:
        db.close()


def test_ride_lifecycle_and_matching():
    """Verify end-to-end flow: ride creation, matching, trip sharing, and driver updates."""
    # 1. Login Passenger 1
    p1_token = login_user("passenger1@arriveshare.test")
    p1_headers = {"Authorization": f"Bearer {p1_token}"}

    # 2. Login Passenger 2
    p2_token = login_user("passenger2@arriveshare.test")
    p2_headers = {"Authorization": f"Bearer {p2_token}"}

    # 3. Passenger 1 creates a ride request
    arrival_time = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
    ride1_payload = {
        "station_id": 1,
        "dest_name": "Koramangala 4th Block",
        "dest_lat": 12.9352,
        "dest_lng": 77.6245,
        "flight_train_number": "6E-5432",
        "arrival_time": arrival_time,
        "ride_type": "shared",
        "luggage_count": 1,
    }
    r1_resp = client.post("/api/rides/", json=ride1_payload, headers=p1_headers)
    assert r1_resp.status_code == 200
    ride1 = r1_resp.json()
    assert ride1["status"] in ("pending", "matched")
    print("  ✓ Ride 1 created with ID:", ride1["id"])

    # 4. Passenger 2 creates a ride request nearby
    ride2_payload = {
        "station_id": 1,
        "dest_name": "HSR Layout Sector 1",
        "dest_lat": 12.9121,
        "dest_lng": 77.6446,
        "flight_train_number": "AI-101",
        "arrival_time": arrival_time,
        "ride_type": "shared",
        "luggage_count": 1,
    }
    r2_resp = client.post("/api/rides/", json=ride2_payload, headers=p2_headers)
    assert r2_resp.status_code == 200
    ride2 = r2_resp.json()
    print("  ✓ Ride 2 created with ID:", ride2["id"])

    # 5. Trigger matching for Passenger 2
    match_resp = client.post(f"/api/matches/find/{ride2['id']}", headers=p2_headers)
    assert match_resp.status_code == 200
    match_data = match_resp.json()
    assert match_data["group_id"] is not None
    assert match_data["shared_fare"] < match_data["solo_fare"]
    assert match_data["savings_pct"] > 0
    group_id = match_data["group_id"]
    print(f"  ✓ Matched Group #{group_id}: Solo ₹{match_data['solo_fare']} -> Shared ₹{match_data['shared_fare']} ({match_data['savings_pct']}% savings)")

    # 6. Test share trip safety feature
    share_payload = {
        "contact_name": "Emergency Contact",
        "contact_phone": "+919876500000",
    }
    share_resp = client.post(f"/api/rides/{ride2['id']}/share-trip", json=share_payload, headers=p2_headers)
    assert share_resp.status_code == 200
    assert share_resp.json()["contact_name"] == "Emergency Contact"
    print("  ✓ Safety feature: Trip details shared with trusted emergency contacts")

    # 7. Check group route geometry endpoint
    route_resp = client.get(f"/api/groups/{group_id}/route", headers=p2_headers)
    assert route_resp.status_code == 200
    route_data = route_resp.json()
    assert "stops" in route_data
    assert "geometry" in route_data
    assert len(route_data["geometry"]) >= 2
    print(f"  ✓ Group route returned {len(route_data['stops'])} stops with {len(route_data['geometry'])} road coordinate points")

    # 8. Driver operations
    grp_resp = client.get(f"/api/groups/{group_id}", headers=p2_headers).json()
    assigned_driver_id = grp_resp.get("driver_id") or 1
    driver_token = login_user(f"driver{assigned_driver_id}@arriveshare.test")
    driver_headers = {"Authorization": f"Bearer {driver_token}"}

    # Driver toggle availability
    toggle_resp = client.post("/api/driver/toggle-availability", headers=driver_headers)
    assert toggle_resp.status_code == 200
    print("  ✓ Driver toggled availability:", toggle_resp.json()["available"])
    # Toggle back to ensure active
    client.post("/api/driver/toggle-availability", headers=driver_headers)

    # Driver assignment detail
    assign_resp = client.get(f"/api/driver/assignments/{group_id}", headers=driver_headers)
    assert assign_resp.status_code == 200
    assign_data = assign_resp.json()
    assert assign_data["passenger_count"] >= 2
    assert "geometry" in assign_data
    print(f"  ✓ Driver assignment detail verified for group #{group_id} ({assign_data['passenger_count']} passengers)")

    # Driver status update: on_trip
    status_resp = client.patch(
        f"/api/driver/assignments/{group_id}/status",
        json={"status": "on_trip"},
        headers=driver_headers,
    )
    assert status_resp.status_code == 200
    assert status_resp.json()["status"] == "on_trip"
    print("  ✓ Driver transitioned group status to: on_trip")

    # Driver status update: completed
    complete_resp = client.patch(
        f"/api/driver/assignments/{group_id}/status",
        json={"status": "completed"},
        headers=driver_headers,
    )
    assert complete_resp.status_code == 200
    assert complete_resp.json()["status"] == "completed"
    print("  ✓ Driver transitioned group status to: completed")

    # Cleanup test records
    from app.database import SessionLocal
    from app.models import RideRequest, RideGroup, TripShare
    db = SessionLocal()
    try:
        db.query(TripShare).filter(TripShare.ride_request_id.in_([ride1["id"], ride2["id"]])).delete(synchronize_session=False)
        db.query(RideRequest).filter(RideRequest.id.in_([ride1["id"], ride2["id"]])).delete(synchronize_session=False)
        db.query(RideGroup).filter(RideGroup.id == group_id).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def test_ride_cancellation():
    """Verify ride cancellation updates status properly."""
    p3_token = login_user("passenger3@arriveshare.test")
    p3_headers = {"Authorization": f"Bearer {p3_token}"}

    arrival_time = (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat()
    r_resp = client.post("/api/rides/", json={
        "station_id": 1,
        "dest_name": "Whitefield",
        "dest_lat": 12.9698,
        "dest_lng": 77.7500,
        "flight_train_number": "6E-200",
        "arrival_time": arrival_time,
        "ride_type": "shared",
        "luggage_count": 1,
    }, headers=p3_headers)
    assert r_resp.status_code == 200
    ride_id = r_resp.json()["id"]

    cancel_resp = client.post(f"/api/rides/{ride_id}/cancel", headers=p3_headers)
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "cancelled"
    print(f"  ✓ Ride #{ride_id} successfully cancelled")

    # Cleanup cancellation test ride
    from app.database import SessionLocal
    from app.models import RideRequest
    db = SessionLocal()
    try:
        db.query(RideRequest).filter(RideRequest.id == ride_id).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    print("\n============================================================")
    print("  ArriveShare -- API Integration Tests")
    print("============================================================\n")

    test_stations_endpoint()
    test_auth_flows()
    test_ride_lifecycle_and_matching()
    test_ride_cancellation()

    print("\n============================================================")
    print("  All API Integration Tests Passed Successfully! ✓")
    print("============================================================\n")
