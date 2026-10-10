"""
Seed Data
=========
Populates the database with realistic mock data for Bangalore:
  - 4 stations (2 airports, 2 railway stations)
  - 30 passengers with varied destinations and arrival times
  - 5 drivers with vehicle details

Destinations span real Bangalore neighborhoods to produce
meaningful matches during testing.
"""

from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from .models import User, Station, Driver, RideRequest


def seed_stations(db: Session):
    """Seed 4 real Bangalore stations."""
    stations = [
        Station(
            id=1, name="Kempegowda Intl Airport (BLR)", type="airport",
            latitude=13.1986, longitude=77.7066, city="Bangalore"
        ),
        Station(
            id=2, name="HAL Airport", type="airport",
            latitude=12.9499, longitude=77.6681, city="Bangalore"
        ),
        Station(
            id=3, name="Bangalore City Railway Station", type="railway",
            latitude=12.9784, longitude=77.5713, city="Bangalore"
        ),
        Station(
            id=4, name="Yeshwanthpur Railway Station", type="railway",
            latitude=13.0281, longitude=77.5510, city="Bangalore"
        ),
    ]
    for s in stations:
        existing = db.query(Station).filter(Station.id == s.id).first()
        if not existing:
            db.add(s)
    db.commit()


# Bangalore neighborhoods with real coordinates
DESTINATIONS = {
    "Koramangala":      (12.9352, 77.6245),
    "Indiranagar":      (12.9716, 77.6412),
    "Whitefield":       (12.9698, 77.7500),
    "Electronic City":  (12.8456, 77.6603),
    "MG Road":          (12.9756, 77.6066),
    "HSR Layout":       (12.9116, 77.6474),
    "Jayanagar":        (12.9308, 77.5838),
    "BTM Layout":       (12.9166, 77.6101),
    "Marathahalli":     (12.9591, 77.6974),
    "Hebbal":           (13.0358, 77.5970),
    "Yelahanka":        (13.1005, 77.5963),
    "Banashankari":     (12.9255, 77.5468),
    "JP Nagar":         (12.9063, 77.5857),
    "Malleshwaram":     (12.9965, 77.5713),
    "Rajajinagar":      (12.9900, 77.5520),
}


def seed_users_and_drivers(db: Session):
    """Seed 30 passengers and 5 drivers."""
    # Passengers
    passenger_names = [
        "Aarav Sharma", "Priya Patel", "Rohan Mehta", "Ananya Singh",
        "Vikram Reddy", "Neha Gupta", "Arjun Kumar", "Kavya Nair",
        "Siddharth Joshi", "Meera Iyer", "Aditya Rao", "Divya Menon",
        "Karthik Sundaram", "Pooja Verma", "Rahul Desai", "Sneha Kulkarni",
        "Amit Saxena", "Riya Bhat", "Vivek Choudhary", "Ishita Agarwal",
        "Nikhil Hegde", "Tanvi Shetty", "Pranav Mishra", "Anjali Das",
        "Deepak Pillai", "Lakshmi Rajan", "Suresh Gowda", "Manisha Patil",
        "Gaurav Tiwari", "Swati Naidu",
    ]

    for i, name in enumerate(passenger_names, start=1):
        existing = db.query(User).filter(User.id == i).first()
        if not existing:
            user = User(
                id=i,
                name=name,
                email=f"passenger{i}@arriveshare.test",
                phone=f"+9198765{i:05d}",
                role="passenger",
                verified=True,
                otp_code="1234",
            )
            db.add(user)

    # Drivers (IDs 101-105)
    driver_data = [
        ("Rajesh Kumar", "KA01AB1234", "Maruti Suzuki Ertiga", 13.20, 77.71),
        ("Mohammed Hussain", "KA02CD5678", "Toyota Innova", 12.95, 77.67),
        ("Venkatesh Gowda", "KA03EF9012", "Mahindra Xylo", 12.98, 77.57),
        ("Sunil Reddy", "KA04GH3456", "Maruti Suzuki Dzire", 13.03, 77.55),
        ("Prakash Shetty", "KA05IJ7890", "Hyundai Creta", 13.00, 77.60),
    ]

    for i, (name, plate, model, lat, lng) in enumerate(driver_data, start=1):
        user_id = 100 + i
        existing_user = db.query(User).filter(User.id == user_id).first()
        if not existing_user:
            user = User(
                id=user_id,
                name=name,
                email=f"driver{i}@arriveshare.test",
                phone=f"+9199999{i:05d}",
                role="driver",
                verified=True,
                otp_code="1234",
            )
            db.add(user)
            db.flush()

            driver = Driver(
                id=i,
                user_id=user_id,
                vehicle_number=plate,
                vehicle_model=model,
                seats=4,
                available=True,
                current_lat=lat,
                current_lng=lng,
            )
            db.add(driver)

    db.commit()


def seed_ride_requests(db: Session):
    """
    Seed ~30 ride requests designed to produce interesting match scenarios:

    Scenario A (IDs 1-3): 3 passengers from BLR Airport → Koramangala area
        Same destination, same time window → should produce 1 group

    Scenario B (IDs 4-5): 2 passengers from BLR Airport → along same route
        Indiranagar & Marathahalli (both east) → should match with correct drop order

    Scenario C (ID 6): 1 solo passenger from HAL Airport → Electronic City
        No one else going that way → offered solo ride

    Scenario D (IDs 7-11): 5 passengers from City Railway → Jayanagar area
        4-seat capacity → split into 2 groups

    Remaining (IDs 12-30): Varied requests across stations and destinations
    """
    now = datetime.utcnow()
    dest_list = list(DESTINATIONS.items())

    requests_data = [
        # ── Scenario A: 3 passengers, same destination, same window ──
        (1, 1, "Koramangala", 0),     # BLR Airport → Koramangala, now
        (2, 1, "Koramangala", 5),     # BLR Airport → Koramangala, +5 min
        (3, 1, "Koramangala", 10),    # BLR Airport → Koramangala, +10 min

        # ── Scenario B: 2 passengers, route overlap (both eastward) ──
        (4, 1, "Indiranagar", 2),     # BLR Airport → Indiranagar
        (5, 1, "Marathahalli", 8),    # BLR Airport → Marathahalli (along the way)

        # ── Scenario C: 1 solo passenger, no match ──
        (6, 2, "Electronic City", 0), # HAL Airport → Electronic City (alone)

        # ── Scenario D: 5 passengers for 4-seat cab ──
        (7, 3, "Jayanagar", 0),       # City Railway → Jayanagar
        (8, 3, "JP Nagar", 3),        # City Railway → JP Nagar (near Jayanagar)
        (9, 3, "Banashankari", 5),    # City Railway → Banashankari (nearby)
        (10, 3, "BTM Layout", 7),     # City Railway → BTM Layout (nearby)
        (11, 3, "Jayanagar", 12),     # City Railway → Jayanagar (5th person)

        # ── Additional varied requests ──
        (12, 1, "Whitefield", 15),
        (13, 1, "Whitefield", 18),
        (14, 1, "MG Road", 20),
        (15, 2, "Koramangala", 0),
        (16, 2, "HSR Layout", 5),
        (17, 2, "Indiranagar", 10),
        (18, 3, "Hebbal", 0),
        (19, 3, "Yelahanka", 5),
        (20, 3, "Malleshwaram", 2),
        (21, 4, "Rajajinagar", 0),
        (22, 4, "Malleshwaram", 3),
        (23, 4, "Hebbal", 8),
        (24, 1, "HSR Layout", 3),
        (25, 1, "Electronic City", 6),
        (26, 2, "MG Road", 12),
        (27, 2, "Jayanagar", 15),
        (28, 3, "Koramangala", 10),
        (29, 4, "Whitefield", 5),
        (30, 4, "Indiranagar", 10),
    ]

    flight_numbers = [
        "6E-2451", "AI-805", "UK-832", "SG-123", "6E-6789",
        None, "12657 Exp", "12658 Exp", "16525 Exp", "22691 Exp",
        "12027 Exp", "6E-1122", "AI-442", None, "UK-721",
    ]

    for user_id, station_id, dest_name, time_offset in requests_data:
        existing = db.query(RideRequest).filter(
            RideRequest.user_id == user_id,
            RideRequest.dest_name == dest_name,
        ).first()
        if existing:
            continue

        dest_coords = DESTINATIONS[dest_name]
        arrival = now + timedelta(minutes=time_offset)

        ride = RideRequest(
            user_id=user_id,
            station_id=station_id,
            dest_lat=dest_coords[0],
            dest_lng=dest_coords[1],
            dest_name=dest_name,
            arrival_time=arrival,
            flight_train_number=flight_numbers[(user_id - 1) % len(flight_numbers)],
            ride_type="shared",
            status="pending",
        )
        db.add(ride)

    db.commit()


def seed_all(db: Session):
    """Run all seed functions in order."""
    print("[SEED] Seeding stations...")
    seed_stations(db)
    print("[SEED] Seeding users and drivers...")
    seed_users_and_drivers(db)
    print("[SEED] Seeding ride requests...")
    seed_ride_requests(db)
    print("[SEED] Seed data loaded successfully!")
