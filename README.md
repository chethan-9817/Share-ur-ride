# 🚖 ArriveShare

> **Safe, fair ride-pooling for airport and railway-station arrivals — built women-safety-first.**

[![CI](https://github.com/chethan-9817/Share-ur-ride/actions/workflows/ci.yml/badge.svg)](https://github.com/chethan-9817/Share-ur-ride/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6)
![Fastify](https://img.shields.io/badge/Fastify-5-000)
![React](https://img.shields.io/badge/React-18-61dafb)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)

Travellers landing at Kempegowda Airport or stepping off a train at KSR Bengaluru usually take
a solo cab for 30–45 km down the same expressway as dozens of others. ArriveShare pools riders
arriving at the **same hub** within the **same time window** heading along the **same
corridor**, splits the fare fairly, and wraps the whole trip in real-time safety tooling.

| | |
| --- | --- |
| 💸 **Up to 60 % cheaper** | Base fare charged once per cab; distance split by how far *you* go. Your fare is locked when you accept and can only go down. |
| 🛡️ **Women-safety first** | Women-only pools, female drivers offered first, PIN-verified pickup, silent SOS, live trip sharing, route-deviation check-ins, fake call. |
| 📡 **Live everything** | Matching, driver offers, cab position, check-ins and SOS are pushed over WebSockets. |
| 📱 **Phone & laptop** | Responsive layouts (bottom tabs on phones, sidebar on laptops), installable PWA, dark mode. |
| 🚗 **Fair to drivers** | Sequential nearest-driver offers, optimal drop order, full-cab bonus, earnings dashboard. |

---

## Contents
- [Features](#features)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Try the demo](#try-the-demo)
- [Project structure](#project-structure)
- [How it works](#how-it-works)
- [Testing](#testing)
- [Deployment](#deployment)
- [Configuration](#configuration)
- Docs: [Architecture](docs/ARCHITECTURE.md) · [Safety design](docs/SAFETY.md) · [API reference](docs/API.md)

---

## Features

### Rider app
- Passwordless email-OTP sign-in, 30-second onboarding with an emergency contact.
- Book from any hub: place search (hub-biased) **or** tap/drag a pin on the map, live fare quote with road distance, ETA and CO₂ saved.
- Choose wait window (10/15/20/30 min), bags and seats.
- Matching radar → match screen with co-riders (first names only), fare breakdown and an acceptance countdown.
- "Don't wait — ride solo" fallback at any time.
- Driver card with a big number-plate graphic and your 4-digit pickup PIN.
- Live map with the cab moving in real time, numbered drop stops and route.
- Trip summary with savings, two-way ratings with safety tags.

### Women safety
- **Women-only pools** and **female-driver priority**, enforced on the server.
- **Silent SOS** (press-and-hold): ops console + trusted contacts alerted with live location; *driver never notified*.
- **Live trip link** for family — no app or login required; auto-shared on trip start.
- **Route watch**: deviations, long unexpected stops and speeding trigger an *"Are you okay?"* prompt; no answer → escalation.
- **Night-ride check-ins**, **fake incoming call**, one-tap **112 / 1091** helplines.
- Masked phone numbers, PII-free co-rider views. See [docs/SAFETY.md](docs/SAFETY.md).

### Driver app
- Partner onboarding (vehicle + licence) with admin verification.
- Online/offline toggle, live GPS streaming over WebSocket (with a route simulator for demos).
- Offer sheet with 30-second countdown, payout preview (commission + full-cab bonus).
- Step-by-step trip panel: arrive → verify each PIN → mark no-show after the wait → start → drop in optimal order, with Google Maps navigation per stop.
- Earnings dashboard: today / 7 days / lifetime, 14-day chart, trip table.

### Safety-ops console (admin)
- Live fleet map with active routes (women-only trips highlighted).
- Real-time SOS feed with sound/vibration, acknowledge → resolve workflow.
- Safety-signal stream (deviations, missed check-ins, post-trip reports).
- Driver document verification, user search & suspension, daily KPIs.

## Tech stack

| Layer | Technology |
| --- | --- |
| Language | **TypeScript** everywhere (strict) — npm workspaces monorepo |
| API | **Fastify 5**, Zod validation, OpenAPI/Swagger at `/docs`, Helmet, CORS, rate limiting |
| Auth | Email OTP (HMAC-hashed), 15-min JWT access token, rotating httpOnly refresh cookie with reuse detection, role guards |
| Database | **PostgreSQL 16** via **Drizzle ORM** + SQL migrations; **PGlite** (embedded Postgres) for zero-setup dev & tests |
| Realtime | **Socket.IO** rooms (user / group / share / admins) with membership checks |
| Routing | OSRM (LRU cache, timeout, circuit breaker) with haversine fallback; Nominatim place search |
| Web | **React 18**, Vite, Tailwind CSS, TanStack Query, Zustand, React Router, Leaflet, Sonner, PWA |
| Shared | `@arriveshare/shared` — fare engine, exact drop-order solver, pooling, safety detectors, schemas, DTOs |
| Quality | Vitest (67 unit + integration tests), ESLint, GitHub Actions CI, Docker |

Why these choices: see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#why-this-stack).

## Quick start

**Prerequisites:** Node.js 20+ (22 recommended). No database install needed.

```bash
git clone https://github.com/chethan-9817/Share-ur-ride.git
cd Share-ur-ride
npm install

# configure the API (embedded Postgres + demo mode by default)
cp apps/api/.env.example apps/api/.env
#   then set JWT_SECRET to a long random string:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm run dev
```

- Web app → **http://localhost:5173**
- API → http://localhost:4000 · Swagger docs → http://localhost:4000/docs

The API migrates and seeds itself on boot (5 Bengaluru hubs, demo accounts, simulated fleet).

**Use it on your phone:** run `npm run dev`, then open `http://<your-laptop-LAN-IP>:5173`
on a phone on the same Wi-Fi. (Browsers only allow GPS on `localhost` or HTTPS — use a
tunnel such as `cloudflared` or `ngrok` to test live driver GPS from a phone.)

## Try the demo

With `DEMO_MODE=true` the login page shows one-tap demo accounts and, with
`SIMULATOR_ENABLED=true`, bot co-riders and bot drivers make the full journey happen by itself:

1. **Priya (rider)** → *Book* → pick BLR airport → choose *Indiranagar* → *Find co-riders*.
   A bot co-rider is pooled with you within seconds.
2. Tap **Accept** → watch a verified driver get assigned, drive to the airport, verify PINs,
   then follow the route live on the map. Try the **Safety toolkit**, **SOS** and **Share live trip**.
3. Open the share link in a private window — that's what family sees.
4. **Safety ops** (in another browser) → see SOS alerts and the live fleet map.
5. **Ravi (driver)** → *Go online*. Ravi waits closest to the airport, so the next pooled
   trip is offered to him: accept it, enter the riders' PINs (shown for bot riders in demo
   mode), *Start trip* and use *Simulate driving the route*.

## Project structure

```
.
├── apps/
│   ├── api/                 Fastify API
│   │   ├── drizzle/         SQL migrations
│   │   ├── src/
│   │   │   ├── config/      zod-validated environment
│   │   │   ├── db/          schema, client (pg | PGlite), migrate, seed
│   │   │   ├── modules/     route modules (auth, me, rides, driver, safety, admin…)
│   │   │   ├── services/    matching, dispatch, trips, safety, routing, scheduler, simulator…
│   │   │   ├── realtime/    Socket.IO gateway + event hub
│   │   │   └── plugins/     auth, error handling
│   │   └── test/            integration tests (in-memory Postgres)
│   └── web/                 React PWA
│       └── src/
│           ├── components/  ui, layout, map, safety
│           ├── pages/       rider, driver, admin, landing, login, safety centre, share
│           ├── hooks/       queries, sockets, geolocation, countdown, theme
│           └── lib/         api client, socket, utils
├── packages/shared/         algorithms, schemas and types shared by api + web
├── docs/                    architecture, safety design, API reference
├── Dockerfile · docker-compose.yml · .github/workflows/ci.yml
```

## How it works

**Matching** — riders at the same hub are clustered by arrival time and direction; a rider
joins a cab only if time windows overlap, seats/luggage fit, women-only preferences hold for
everyone, and an exact drop order exists keeping each rider within
`min(30 % of their solo distance, 6 km)` of detour. Late joiners fill empty seats while a group
is still accepting.

**Fares**

```
solo(i)  = base + perKm × soloKm(i)
group    = base + perKm × routeKm                (base charged once)
share(i) = group × soloKm(i) / Σ soloKm
final(i) = min(share(i), solo(i), accepted(i))   (price guarantee)
```

**Dispatch** — confirmed groups are offered to one driver at a time (nearest first, 30 s),
women-only groups to female drivers first.

**Concurrency** — every state change is a guarded `UPDATE … WHERE status = …` inside a
transaction, so concurrent workers can't double-book riders or drivers.

Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testing

```bash
npm test          # all workspaces
npm run typecheck
npm run lint
```

- `packages/shared` — 34 unit tests: geometry, fare split & price guarantee, permutation solver & detour limits, pooling (capacity, time windows, women-only), safety detectors.
- `apps/api` — 28 integration tests against a real in-memory Postgres: OTP auth & refresh-token reuse detection, the full ride lifecycle (pool → accept → dispatch → PIN → live share → drop → earnings → ratings), decline/solo/cancel, women-only pooling, female-driver priority, silent SOS, route-deviation check-ins and escalation.
- `apps/web` — 5 unit tests for client utilities.

## Deployment

**Docker (PostgreSQL + app on one origin):**

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
# → http://localhost:4000
```

The image builds the API and the web app; in production the API serves the SPA from the same
origin, so cookies and WebSockets need no extra CORS setup. For real deployments set
`DEMO_MODE=false`, `SIMULATOR_ENABLED=false`, SMTP credentials and `PUBLIC_WEB_URL`.

## Configuration

All settings live in [`apps/api/.env.example`](apps/api/.env.example) and are validated at
boot (the server refuses to start with bad values, or with the example JWT secret in production).
Key ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `pglite://.pglite/arriveshare` | `postgres://…` in production |
| `JWT_SECRET` | — | ≥ 32 chars, required |
| `BASE_FARE` / `RATE_PER_KM` / `MIN_FARE` | 50 / 12 / 80 | Pricing (INR) |
| `MAX_DETOUR_PCT` / `MAX_DETOUR_KM` | 0.30 / 6 | Detour budget |
| `ACCEPT_WINDOW_SEC` / `OFFER_TIMEOUT_SEC` | 120 / 30 | Rider accept & driver offer windows |
| `FEMALE_DRIVER_PRIORITY_SEC` | 120 | How long women-only trips wait for female drivers |
| `CHECK_IN_TIMEOUT_SEC` | 120 | Before an unanswered safety check escalates |
| `SMTP_*` | empty | Leave empty to print emails to the console |
| `DEMO_MODE` / `SIMULATOR_ENABLED` | true / true | Demo logins, on-screen OTPs, bot riders & drivers |

### Troubleshooting
- **`Cannot find module @rollup/rollup-win32-x64-msvc`** on Windows — an npm optional-dependency bug; run `npm install --no-save @rollup/rollup-win32-x64-msvc`.
- **Emails not arriving** — set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (for Gmail use an App Password). Without SMTP, codes are printed in the API console and shown on screen in demo mode.

---

<p align="center"><b>ArriveShare</b> · Emergency? Call <b>112</b> · Women Helpline <b>1091</b></p>
