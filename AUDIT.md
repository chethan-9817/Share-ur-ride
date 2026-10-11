# ArriveShare Codebase Audit Report (Phase 0)

**Date**: 2026-10-11  
**Auditor**: Principal Full-Stack Engineer  
**System**: ArriveShare MVP  
**Stack**: FastAPI + SQLite (SQLAlchemy) | React (Vite) + Leaflet (Tailwind CSS)

---

## 1. Complete File Map

```
c:\prject 3 main\
├── .git/
├── README.md                                 # Root comprehensive project README
├── AUDIT.md                                  # Phase 0 System Audit (This Document)
├── IMPLEMENTATION_PLAN.md                    # Phase 0 Implementation Roadmap
└── arriveshare/
    ├── README.md                             # Subfolder README mirror
    ├── backend/
    │   ├── .env                              # Environment variables (DB, Fare, Matching, SMTP)
    │   ├── arriveshare.db                    # Active SQLite development database
    │   ├── requirements.txt                  # Python dependencies
    │   ├── app/
    │   │   ├── __init__.py                   # Package initialization
    │   │   ├── auth.py                       # JWT token handling & auth endpoints
    │   │   ├── config.py                     # Pydantic Settings configuration (.env loader)
    │   │   ├── database.py                   # SQLAlchemy engine, SessionLocal, get_db
    │   │   ├── main.py                       # FastAPI application setup, CORS, lifespan, routes
    │   │   ├── models.py                     # SQLAlchemy ORM models (User, Station, Driver, etc.)
    │   │   ├── schemas.py                    # Pydantic schemas for requests and responses
    │   │   ├── seed.py                       # Database seeder (stations, 30 users, 5 drivers, rides)
    │   │   ├── routes/
    │   │   │   ├── __init__.py               # Routes package init
    │   │   │   ├── auth.py                   # Auth router re-export
    │   │   │   ├── driver.py                 # Driver profile, assignments, status, toggle
    │   │   │   ├── groups.py                 # Group details & route geometry endpoints
    │   │   │   ├── matches.py                # Find match & decline match endpoints
    │   │   │   ├── rides.py                  # CRUD for rides, confirm, cancel, share-trip
    │   │   │   └── stations.py               # List & retrieve hubs
    │   │   └── services/
    │   │       ├── __init__.py               # Services package init
    │   │       ├── email.py                  # SMTP & mock OTP email service
    │   │       ├── fare.py                   # Solo/group fare and proportional split logic
    │   │       ├── matching.py               # Core matching algorithm & group lifecycle
    │   │       └── routing.py                # Haversine, detour calculation, OSRM client
    │   └── tests/
    │       ├── __init__.py                   # Tests package init
    │       ├── test_api_endpoints.py         # End-to-end API integration tests (TestClient)
    │       └── test_matching.py              # Unit tests for matching, detour, and fare split
    └── frontend/
        ├── index.html                        # HTML template
        ├── package.json                      # Frontend scripts and dependencies
        ├── vite.config.js                    # Vite configuration (port 5173, API proxy to 8000)
        └── src/
            ├── App.jsx                       # React router, route protection, loading state
            ├── index.css                     # Global design tokens, animations, custom utilities
            ├── main.jsx                      # React entrypoint
            ├── context/
            │   └── AuthContext.jsx           # User state, JWT storage, login, demo logins
            ├── services/
            │   └── api.js                    # Centralized fetch API client with Bearer token
            └── pages/
                ├── DriverDashboard.jsx       # Driver view: assignments, stops, status update
                ├── HomePage.jsx              # Landing dashboard: stations, user rides, stats
                ├── LoginPage.jsx             # Auth view: OTP input, registration, quick demo buttons
                ├── MatchingPage.jsx          # Co-traveler discovery radar & match preview
                ├── RideRequestPage.jsx       # Booking form: hub selection, map click destination
                └── TripPage.jsx              # Active trip view: live map, stops, fares, SOS, share
```

---

## 2. Database Schema (SQLAlchemy Models)

The SQLite database (`arriveshare.db`) contains 6 core tables:

### 1. `users`
*Represents passengers and drivers.*
- `id` (Integer, PK, indexed)
- `name` (String, NOT NULL)
- `email` (String, UNIQUE, indexed, NOT NULL)
- `phone` (String, UNIQUE, indexed, NOT NULL)
- `role` (String, default "passenger") — `'passenger'` or `'driver'`
- `verified` (Boolean, default False)
- `otp_code` (String, nullable) — Dev mock OTP or 6-digit generated code
- `created_at` (DateTime, default UTC now)
- Relationships: `ride_requests` (1:N), `driver_profile` (1:1)

### 2. `stations`
*Hub pickup locations (airports and railway stations).*
- `id` (Integer, PK, indexed)
- `name` (String, NOT NULL)
- `type` (String, NOT NULL) — `'airport'` or `'railway'`
- `latitude` (Float, NOT NULL)
- `longitude` (Float, NOT NULL)
- `city` (String, NOT NULL, default "Bangalore")
- Relationships: `ride_requests` (1:N), `ride_groups` (1:N)

### 3. `drivers`
*Cab driver profiles and vehicle metadata.*
- `id` (Integer, PK, indexed)
- `user_id` (Integer, FK -> `users.id`, NOT NULL)
- `vehicle_number` (String, NOT NULL)
- `vehicle_model` (String, NOT NULL)
- `seats` (Integer, default 4)
- `available` (Boolean, default True)
- `current_lat` (Float, nullable)
- `current_lng` (Float, nullable)
- Relationships: `user` (N:1), `assigned_groups` (1:N)

### 4. `ride_groups`
*A pooled group of passengers sharing one vehicle.*
- `id` (Integer, PK, indexed)
- `station_id` (Integer, FK -> `stations.id`, NOT NULL)
- `driver_id` (Integer, FK -> `drivers.id`, nullable)
- `status` (String, default "forming") — `'forming'`, `'confirmed'`, `'on_trip'`, `'completed'`
- `total_distance_km` (Float, nullable)
- `total_fare` (Float, nullable)
- `capacity` (Integer, default 4)
- `created_at` (DateTime, default UTC now)
- Relationships: `station` (N:1), `driver` (N:1), `ride_requests` (1:N)

### 5. `ride_requests`
*Individual passenger ride booking.*
- `id` (Integer, PK, indexed)
- `user_id` (Integer, FK -> `users.id`, NOT NULL)
- `station_id` (Integer, FK -> `stations.id`, NOT NULL)
- `dest_lat` (Float, NOT NULL)
- `dest_lng` (Float, NOT NULL)
- `dest_name` (String, NOT NULL)
- `arrival_time` (DateTime, NOT NULL)
- `flight_train_number` (String, nullable)
- `ride_type` (String, default "shared") — `'solo'` or `'shared'`
- `status` (String, default "pending") — `'pending'`, `'matched'`, `'confirmed'`, `'on_trip'`, `'completed'`, `'cancelled'`
- `group_id` (Integer, FK -> `ride_groups.id`, nullable)
- `solo_fare` (Float, nullable)
- `shared_fare` (Float, nullable)
- `savings_pct` (Float, nullable)
- `drop_order` (Integer, nullable) — 1-based drop sequence
- `created_at` (DateTime, default UTC now)
- Relationships: `user` (N:1), `station` (N:1), `group` (N:1), `trip_shares` (1:N)

### 6. `trip_shares`
*Safety emergency/trusted contact notifications.*
- `id` (Integer, PK, indexed)
- `ride_request_id` (Integer, FK -> `ride_requests.id`, NOT NULL)
- `contact_name` (String, NOT NULL)
- `contact_phone` (String, NOT NULL)
- `shared_at` (DateTime, default UTC now)
- Relationships: `ride_request` (N:1)

---

## 3. Existing API Endpoints

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/` | Application root metadata and version | No |
| `GET` | `/api/health` | Health-check endpoint (`{"status": "ok"}`) | No |
| `POST` | `/api/auth/register` | Register passenger/driver | No |
| `POST` | `/api/auth/send-otp` | Generate or mock OTP for email | No |
| `POST` | `/api/auth/verify-otp` | Verify OTP and issue JWT access token | No |
| `GET` | `/api/auth/me` | Fetch authenticated user profile | Yes (Bearer) |
| `GET` | `/api/stations` | List all 4 airport and railway hubs | No |
| `GET` | `/api/stations/{id}` | Get details of a single hub | No |
| `POST` | `/api/rides` | Create a new ride request | Yes (Bearer) |
| `GET` | `/api/rides/my` | List current user's rides | Yes (Bearer) |
| `GET` | `/api/rides/{id}` | Get ride details | Yes (Bearer) |
| `PATCH` | `/api/rides/{id}/status` | Update ride status (simulation) | Yes (Bearer) |
| `POST` | `/api/rides/{id}/confirm` | Confirm a matched ride | Yes (Bearer) |
| `POST` | `/api/rides/{id}/share-trip`| Create trusted contact trip share | Yes (Bearer) |
| `POST` | `/api/rides/{id}/cancel` | Cancel ride request & rebalance group | Yes (Bearer) |
| `POST` | `/api/matches/find/{id}` | Run matching engine for ride request | Yes (Bearer) |
| `POST` | `/api/matches/decline/{id}`| Decline match and re-pool passenger | Yes (Bearer) |
| `GET` | `/api/groups/{id}` | Fetch group metadata & passengers | Yes (Bearer) |
| `GET` | `/api/groups/{id}/route` | Get ordered stops & OSRM road polyline | Yes (Bearer) |
| `GET` | `/api/driver/profile` | Fetch driver vehicle and status profile | Yes (Bearer) |
| `GET` | `/api/driver/assignments` | List groups assigned to current driver | Yes (Bearer) |
| `GET` | `/api/driver/assignments/{id}` | Detailed assignment stops, geometry, earnings | Yes (Bearer) |
| `PATCH` | `/api/driver/assignments/{id}/status` | Progress trip status (`forming`->`completed`)| Yes (Bearer) |
| `POST` | `/api/driver/toggle-availability` | Toggle driver `available` flag | Yes (Bearer) |

---

## 4. State Machine Architecture (Current State vs Target)

### Current Status Values:
- **RideRequest**: `pending` → `matched` → `confirmed` → `on_trip` → `completed` (or `cancelled`)
- **RideGroup**: `forming` → `confirmed` → `on_trip` → `completed`
- **Driver**: `available` (True / False)

### Inconsistencies & Current Gaps:
1. **No centralized state machine**: Status updates are written ad-hoc across `rides.py`, `driver.py`, and `matching.py`.
2. **Missing status transitions validation**: `PATCH /api/rides/{id}/status` permits setting any status without checking legal transitions or synchronizing parent `RideGroup` state.
3. **No Offer / Acceptance State**: When a group forms, it assigns a driver directly without an offer state (`offered`, `accepted`, `rejected`, `expired`).
4. **No Rider Acceptance Window State**: Groups immediately enter `matched` and riders remain `matched` until manual confirmation, without an accept timeout (`accepting`, `timed_out`).
5. **No Payment State**: There is currently no payment state (`unpaid`, `authorized`, `captured`, `refunded`).

---

## 5. Polling Locations Across the Application

Currently, real-time synchronization is simulated using client-side JavaScript polling:

1. **`frontend/src/pages/HomePage.jsx`**
   - Line 28: `setInterval(fetchRides, 5000)` (every 5.0 seconds).
   - Polls `GET /api/rides/my` to update ride cards and savings statistics.
2. **`frontend/src/pages/TripPage.jsx`**
   - Line 69: `setInterval(loadRide, 4000)` (every 4.0 seconds).
   - Polls `GET /api/rides/{rideId}`, `GET /api/groups/{groupId}`, and `GET /api/groups/{groupId}/route` to track driver arrival, co-passenger confirmations, and trip completion.
3. **`frontend/src/pages/DriverDashboard.jsx`**
   - Line 48: `setInterval(() => { loadData(false); }, 4000)` (every 4.0 seconds).
   - Polls `GET /api/driver/assignments` and `GET /api/driver/assignments/{selectedGroup}` to detect new assignments and status changes.

---

## 6. Detailed Bugs, Flaws, and Inconsistencies Discovered

1. **Race Conditions & Lack of DB Transactions**:
   - In `matching.py`, `match_ride` checks `len(members) >= group.capacity` and appends candidates across multiple queries without atomic locking or status re-checking.
   - If two requests are submitted simultaneously, both can read the same forming group with 3 members and both can join, leading to 5 members in a 4-seat cab.
2. **SQLite Concurrency & WAL Mode**:
   - `database.py` does not configure WAL mode (`PRAGMA journal_mode=WAL`). SQLite defaults to rollback journal mode, leading to `database is locked` errors during concurrent polling and writes.
3. **Fare Model Inconsistency**:
   - Solo quote in `rides.py` uses direct Haversine distance (`haversine(...)`), while group route calculation in `_finalize_group` uses Haversine greedy distance, and route polylines use OSRM road distance.
   - There is no single fare engine function used by quotes and group finalization.
4. **Lack of Price Guarantee & Platform Subsidy**:
   - When a passenger cancels via `/api/rides/{ride_id}/cancel`, `_finalize_group` re-runs `split_fare` for the remaining riders. This directly increases the remaining passengers' fares, violating the fixed price guarantee.
5. **Greedy Nearest-Neighbor Drop Order**:
   - Greedy TSP in `optimize_drop_order` can create sub-optimal drop routes (e.g. crossing paths). Because $N \le 4$, full permutation evaluation ($4! = 24$ routes) is deterministic, optimal, and runs in microseconds.
6. **Detour Filter Limitations**:
   - Currently uses a static `DETOUR_THRESHOLD_KM = 3.0 km` and `MAX_DETOUR_KM = 5.0 km`. It does not calculate percentage-based detours (`MAX_DETOUR_PCT = 30%`), which causes short trips to accept disproportionate detours and long trips to reject efficient matches.
7. **Driver Auto-Assignment Bypass**:
   - `_finalize_group` auto-assigns the first available driver and marks `driver.available = False` without driver consent or notification.
8. **Auth & DEMO_MODE Vulnerabilities**:
   - `LoginPage.jsx` exposes demo buttons unconditionally.
   - Anyone can login as any seeded user or driver with hardcoded OTP `1234`.
   - Endpoint authorization does not verify whether `current_user.id == ride.user_id` on all ride operations or enforce strict role-based access control (RBAC).
9. **Simulation Buttons in Production UI**:
   - `TripPage.jsx` contains simulation buttons (`Simulate Driver Arrived`, `Simulate Picked Up`, etc.) directly calling `PATCH /api/rides/{id}/status` from the passenger view.

---

## 7. Audit Conclusion & Readiness

The MVP architecture provides a clean baseline: clear route segregation, clean SQLAlchemy ORM models, and modular React pages. However, the system requires transitioning from demo simulations to production-grade, transaction-safe, event-driven architecture across the 8 defined milestones.
