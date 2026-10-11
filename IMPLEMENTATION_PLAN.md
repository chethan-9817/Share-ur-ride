# ArriveShare Upgrade: Master Implementation Plan

**Author**: Principal Full-Stack Engineer  
**Status**: AWAITING USER APPROVAL (Phase 0 Complete)  
**Execution Strategy**: 8 Independent, Verified Milestones  
**Target Environment**: FastAPI + SQLite (WAL mode, Postgres-ready) | React (Vite) + Leaflet  

---

## Architecture Foundation & Global Rules

1. **Configuration**: All tunable parameters are extracted to `app/config.py` loaded via `.env` (Pydantic `BaseSettings`). Zero hardcoded magic numbers.
2. **Central State Machine**: All entity status transitions (`RideRequest`, `RideGroup`, `Driver`, `DriverOffer`, `Payment`) are governed by a single `app/services/state_machine.py` engine with transition matrices. Illegal state jumps raise HTTP 400 with machine-readable error codes.
3. **Database Concurrency & Integrity**:
   - SQLite WAL mode enabled on connection initialization (`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;`).
   - Group joins, seat allocation, and driver offers execute inside database transactions with optimistic version checks or row status re-checks.
   - Schema defined cleanly with SQLAlchemy models and migration scripts.
4. **DEMO_MODE Flag**:
   - `DEMO_MODE=true` in `.env` activates quick-demo login buttons, mock fast-forward timers, and mock OTPs (`123456`).
   - `DEMO_MODE=false` disables simulation endpoints (returns 403 Forbidden) and hides demo UI widgets.
5. **Continuous Verification**:
   - Pytest test suite executed after each milestone.
   - Clean, minimal 5-line summary after each milestone before proceeding.

---

## Milestone Breakdown

### Milestone 1: Correctness and Matching Core
*Goal: Deterministic, fair, transaction-safe auto-matching with exact routing, guaranteed fares, and acceptance windows.*

- **1.1. Background & Reactive Auto-Matching**:
  - Automatically invoke matching on ride creation (`POST /api/rides`) and on ride modifications (arrival time or destination adjustments).
  - Add an asynchronous background polling task (every 15–30 seconds) using FastAPI background tasks or an async loop worker to match forming batches and late joiners into available seats.
  - Keep the matching radar visual interface, but wire it to live backend group status rather than static client timeouts.
- **1.2. Detour Filtering (Percentage & Kilometer Threshold)**:
  - Replace flat 3 km detour check with dual constraint:
    $$\Delta \text{dist} \le \min(\text{solo\_distance} \times \text{MAX\_DETOUR\_PCT}, \text{MAX\_DETOUR\_KM})$$
    where defaults are `MAX_DETOUR_PCT = 0.30` (30%) and `MAX_DETOUR_KM = 6.0` km.
  - Implement a two-tier filter:
    1. Fast Haversine bounding-box pre-filtering ($O(1)$ per candidate).
    2. Cached OSRM road distance check with an in-memory/table TTL cache and Haversine fallback on network failure or timeout (3.0s).
- **1.3. Exact Permutation Drop-Order Routing**:
  - Since cab capacity $N \le 4$, replace greedy TSP with brute-force evaluation of all permutations ($N! \le 24$).
  - Find the permutation that minimizes total route distance while strictly ensuring no rider exceeds their individual maximum detour.
  - Implement as a pure, side-effect-free function with dedicated unit tests.
- **1.4. Unified Fare Engine & Price Breakdown**:
  - Implement a single canonical fare calculator in `app/services/fare.py`:
    $$\text{Fare} = \text{BASE\_FARE} + (\text{RATE\_PER\_KM} \times \text{distance\_km})$$
  - Proportional split based on each passenger's solo road distance:
    $$\text{Rider Share} = \text{Group Fare} \times \left(\frac{\text{solo\_distance}_i}{\sum \text{solo\_distance}}\right)$$
  - Enforce constraint: $\text{Rider Share} \le \text{Solo Fare}$ (no rider ever pays more than solo).
  - Return detailed breakdown object: `{ solo_fare, shared_fare, savings_inr, savings_pct, distance_share_pct }`.
- **1.5. Price Guarantee & Platform Subsidy**:
  - Add `accepted_fare` and `platform_subsidy` columns to `RideRequest`.
  - When a co-passenger cancels mid-trip or declines, the remaining riders keep their accepted fare. If re-split fare exceeds `accepted_fare`, the difference is written to `platform_subsidy`. Alternatively, riders can cancel free of charge.
- **1.6. Accept/Decline Window with Concurrency Safety**:
  - When a group forms, transition to `accepting` status with an `ACCEPT_WINDOW_SECONDS` (default 120s / 2 min) countdown.
  - All riders must confirm acceptance.
  - On decline or expiration, remove that rider, transition them to `pending`, recalculate for the remaining riders in a DB transaction, and notify the remaining group members.
- **1.7. Flexible Arrival Updates**:
  - Allow riders to adjust arrival time, flight/train numbers, and custom tolerance window (10, 15, 20 mins) via `PATCH /api/rides/{id}`. Re-trigger matching immediately.
- **1.8. Automated Tests**:
  - 5 riders for a 4-seat cab (splitting cleanly into 2 groups).
  - Mid-group cancellation (verifying price guarantee and platform subsidy).
  - Late joiner seat filling.
  - Simultaneous concurrent acceptance.
  - OSRM service down fallback.
  - Detour boundary limits (boundary acceptance and rejection).

---

### Milestone 2: Driver Side
*Goal: Interactive driver offer queue, PIN verification, no-show management, turn-by-turn navigation, and earnings history.*

- **2.1. Sequential Driver Offer Dispatch**:
  - Create `driver_offers` table (`id`, `group_id`, `driver_id`, `status`: pending/accepted/rejected/expired, `created_at`, `expires_at`).
  - Replace instantaneous auto-assignment with a distance-ranked dispatch queue. When a group is confirmed, offer the trip to the closest online driver with `OFFER_TIMEOUT_SECONDS` (default 30s).
  - If rejected or timed out, automatically escalate to the next closest available driver.
- **2.2. Secure 4-Digit Pickup PIN**:
  - Generate a random 4-digit PIN for each confirmed passenger (`pickup_pin` in `RideRequest`).
  - Display the PIN on the passenger's `TripPage`.
  - The driver must enter each rider's PIN to mark them picked up in `DriverDashboard`.
- **2.3. No-Show Management & Timers**:
  - When the driver arrives at the hub, trigger a `NO_SHOW_WAIT_MINUTES` timer (default 5 mins).
  - Once expired, enable a "Mark No-Show" button in the driver app.
  - On trigger: remove no-show rider, recompute route and fares under the price guarantee, and allow the remaining trip to proceed.
- **2.4. Google Maps Deep Linking**:
  - Add direct navigation links (`https://www.google.com/maps/dir/?api=1&destination=LAT,LNG`) for every stop on the driver checklist.
- **2.5. Earnings Analytics & Full-Cab Bonus**:
  - Create driver earnings history with daily/weekly trip counts, passenger tallies, and configurable full-cab bonus (`FULL_CAB_BONUS_PCT = 0.10`, +10% when carrying 4 passengers).
- **2.6. Post-Trip Ratings (Drivers & Riders)**:
  - Add `ratings` table (`id`, `trip_id`, `rater_id`, `ratee_id`, `score`, `tags`, `comment`).
  - Render 1–5 star rating dialogues with tags upon trip completion; display rolling averages on profiles and match cards.
- **2.7. Automated Tests**:
  - Driver offer sequential timeout and re-offer.
  - PIN validation correctness (rejection on wrong PIN).
  - No-show passenger drop and route recalculation.
  - Earnings calculation including 4-passenger bonus.

---

### Milestone 3: Real-Time & Authentication
*Goal: Production-ready push updates via Server-Sent Events (SSE) and resilient Phone OTP JWT authentication with RBAC.*

- **3.1. Server-Sent Events (SSE) Event Stream**:
  - Implement `/api/events/stream` for real-time reactive events: `ride_matched`, `offer_received`, `pin_verified`, `trip_progress`, `driver_location`.
  - Maintain an event hub in backend memory with channel subscriptions per user/group.
  - Frontend auto-reconnects with exponential backoff and transparently falls back to 5s polling if SSE is disconnected.
- **3.2. Secure Phone + OTP JWT Auth & Role-Based Access Control**:
  - Update user authentication to phone number + OTP (support mock OTP `123456` strictly when `DEMO_MODE=true`).
  - Enforce roles: `passenger`, `driver`, `admin`.
  - Implement ownership and permission dependencies: passengers can only access/modify their own rides; drivers can only see assigned groups; admins access system analytics.
- **3.3. Input Validation & Rate Limiting**:
  - Standardize error responses: `{"error_code": "...", "message": "...", "details": {...}}`.
  - Add rate limiting on sensitive write endpoints (e.g. OTP requests, matching triggers).
- **3.4. Automated Tests**:
  - Phone OTP verification, token expiration, and role rejection.
  - Ownership protection (user B cannot cancel user A's ride).
  - SSE event broadcast delivery and client reconnection handling.

---

### Milestone 4: Safety & Privacy
*Goal: Emergency SOS workflows, ephemeral live tracking links, route deviation detection, women-only pooling, and strict privacy masking.*

- **4.1. SOS Emergency Trigger**:
  - Add an SOS button on `TripPage` with a 5-second cancel countdown.
  - On trigger: dispatch alerts to emergency contacts (mock SMS logging vehicle number, driver details, live link), record the incident in the `sos_events` table, and flag the incident on the Admin Dashboard.
- **4.2. Ephemeral Public Live-Share Token**:
  - Generate a secure, expiring token (`/live/{token}`) allowing trusted family members to view live vehicle location, route progress, and ETA without requiring an account.
- **4.3. Route Deviation & Stationary Inactivity Monitor**:
  - Detect when vehicle deviates $> \text{ROUTE\_DEVIATION\_KM}$ (e.g. 1.5 km) from the planned OSRM path or remains stationary for $> \text{MAX\_STATIONARY\_MINS}$ (e.g. 7 mins).
  - Trigger an interactive "Are you OK?" prompt; if unanswered within 60s, escalate to emergency SOS.
- **4.4. Women-Only Pooling**:
  - Allow riders and drivers to opt into a women-only pool (`women_only = true`).
  - Isolate matching so women-only requests pair strictly with other women-only passengers and drivers.
- **4.5. Real Criteria Verified Badge**:
  - Upgrade verification badge: requires Phone OTP verified + Mock ID Gov Check passed. Show transparent verification criteria in a tooltip.
- **4.6. Co-Rider Privacy Masking**:
  - Filter API serialization: co-riders receive only first name, rating, verified badge, and destination neighborhood. Exact street addresses, phone numbers, and emails are strictly withheld.
- **4.7. Automated Tests**:
  - SOS dispatch and cancellation grace period.
  - Public live-share token generation, access, and expiration upon trip completion.
  - Women-only pool strict isolation.
  - Privacy data leakage verification (assert no PII in co-rider payloads).

---

### Milestone 5: Payments & Money
*Goal: Razorpay integration in test/mock mode, wallet credits, promo codes, cancellation fees, and late-drop discounts.*

- **5.1. Payment Engine (Razorpay Test Mode / Mock Interface)**:
  - Abstract `PaymentProvider` interface with a `MockPaymentProvider` (offline/test) and `RazorpayProvider`.
  - Idempotent payment processing with idempotency keys and webhook signature validation.
  - State machine check: cab cannot depart until all riders are authorized/paid or opted for cash.
- **5.2. Digital Wallet & Promo Engine**:
  - Tables: `wallets`, `wallet_transactions`, `promo_codes`.
  - Support flat and percentage discount codes with expiration, first-ride constraints, and usage limits.
  - Apply discounts after the price guarantee check.
- **5.3. Configurable Cancellation Policies**:
  - Free cancellation before match and during the accept window.
  - Structured cancellation fee if cancelled after driver dispatch/en route.
- **5.4. Late-Drop Incentive Discount**:
  - Riders dropped last on extended multi-stop journeys automatically receive a configurable late-drop discount (`LATE_DROP_DISCOUNT_PCT`), compensating for the extra in-cab travel time.
- **5.5. Automated Tests**:
  - Payment idempotency and webhook replay prevention.
  - Cancellation fee calculations and refunds.
  - Promo code validation and discount stacking.

---

### Milestone 6: Smart Features & Experience
*Goal: Real-time flight/train delay tracking, predictive match wait times, 48-hour pre-booking, luggage constraints, and i18n support.*

- **6.1. Flight & Train Tracker Integration**:
  - Abstract `TransitStatusProvider` interface (mock simulator with randomized delays for testing + real transit API adapter).
  - When a flight or train schedule changes, automatically shift `arrival_time`, update the matching window, and alert pooled co-travelers.
- **6.2. Predictive Wait-Time & Demand Estimator**:
  - Calculate match probability and expected wait time (e.g. "Likely match in ~6 mins" vs "Low demand, solo recommended") based on active hub density and recent hourly volume.
- **6.3. 48-Hour Advance Pre-Booking**:
  - Support scheduling rides up to 48 hours in advance. Scheduled rides automatically enter the active matching pool as their arrival window nears.
- **6.4. Cab Luggage Capacity Validation**:
  - Add luggage count and size constraints (small bags vs large suitcases). Reject groups whose combined luggage exceeds vehicle trunk capacity.
- **6.5. Multilingual Interface (i18n)**:
  - Integrate localization with English, Kannada, and Hindi translations.
- **6.6. Automated Tests**:
  - Transit delay reschedule and group re-matching.
  - Luggage limit overflow blocking.
  - Advance booking lifecycle progression.

---

### Milestone 7: Admin Dashboard & Impact Metrics
*Goal: Executive control center, environmental/economic impact metrics, and realistic data generator.*

- **7.1. Admin Control Tower**:
  - Admin-only view (`/admin`): live map of ongoing trips, active fleet status, match success rates, average wait times, SOS alerts, cancellations, and platform subsidy expenditure.
- **7.2. Environmental & Economic Impact Counters**:
  - Compute cumulative ₹ saved, vehicles eliminated from traffic, and carbon offset ($CO_2$ saved in kg based on mileage and fuel emission benchmarks).
  - State mathematical formulas and assumptions in UI tooltips.
- **7.3. Comprehensive Demonstration Seed Script**:
  - Enhanced seeder creating 40 diverse passengers, 8 drivers, 4 Bangalore hubs, and 14 days of realistic trip history to populate charts immediately.
- **7.4. Automated Tests**:
  - Admin RBAC access controls.
  - Accuracy of $CO_2$ and economic savings formulas.

---

### Milestone 8: Hardening, Performance & Delivery
*Goal: Distributed request tracing, high-concurrency load testing, Playwright E2E verification, and delivery documentation.*

- **8.1. Structured Logging & Health Diagnostics**:
  - Inject UUID `X-Request-ID` into every request/response.
  - JSON-formatted structured logging and deep health-check endpoint (`/api/health/deep` verifying DB and OSRM).
- **8.2. High-Concurrency Matching Engine Load Test**:
  - Load test the matching engine with 500 simultaneous pending requests. Verify matching execution completes in $< 2.0$ seconds without deadlocks or capacity overfills.
- **8.3. Playwright End-to-End Test Suite**:
  - Complete automated browser test: Passenger booking $\rightarrow$ Auto-match $\rightarrow$ Accept $\rightarrow$ Driver offer accept $\rightarrow$ PIN pickup $\rightarrow$ Trip completion $\rightarrow$ Rating.
- **8.4. Complete Documentation**:
  - Update `README.md` with system architecture diagrams, environment configurations, and algorithmic models.
  - Deliver `REPORT.md` detailing all implemented features, test coverage metrics, mock interfaces, and future production roadmap.

---

## Milestone Execution Protocol

Following Phase 0 approval, each milestone will be executed iteratively with the following protocol:
1. **Implementation**: Modify and create necessary backend and frontend components.
2. **Testing**: Run automated test suite (`python -m pytest`).
3. **Execution Verification**: Verify frontend build and local server functionality.
4. **Output Report**: Present a concise 5-line summary including:
   - What changed (bulleted file list)
   - Tests added and their pass/fail results
   - Exact steps to observe the new functionality
   - Clarifications or default decisions made
5. **Approval**: Wait for user confirmation before advancing to the next milestone.
