# Architecture

```
┌──────────────────────────── apps/web (React 18 + Vite PWA) ───────────────────────────┐
│  Rider app · Driver app · Safety-ops console · Public live-trip page                   │
│  TanStack Query (server cache) · Zustand (session) · Leaflet (maps) · socket.io-client │
└───────────────▲───────────────────────────────────────────────▲───────────────────────┘
          REST /api (JWT)                                 WebSocket /socket.io
┌───────────────┴───────────────── apps/api (Fastify 5 + TypeScript) ───────────────────┐
│  modules/*.routes.ts   → zod-validated HTTP endpoints, OpenAPI at /docs                │
│  services/matching     → pooling, late joiners, accept windows, price guarantee        │
│  services/dispatch     → sequential driver offers, female-driver priority              │
│  services/trips        → PIN pickup, no-show, drops, earnings, GPS ingest              │
│  services/safety       → SOS, live share links, route-watch, check-ins, escalation     │
│  services/scheduler    → idempotent background tick                                    │
│  realtime/gateway      → authenticated Socket.IO rooms                                 │
└───────────────┬────────────────────────────────────────────────┬──────────────────────┘
          Drizzle ORM                                        OSRM / Nominatim (cached,
┌───────────────┴─────────────────┐                          timeout + circuit breaker)
│ PostgreSQL 16 (prod)            │
│ PGlite embedded Postgres (dev)  │
└─────────────────────────────────┘

packages/shared — pure TypeScript used by both sides:
  geo (haversine, polylines) · fare engine · exact drop-order solver · pooling algorithm
  · safety detectors · zod request schemas · response DTO types · socket event names
```

## Why this stack

| Concern | Choice | Reason |
| --- | --- | --- |
| Language | TypeScript end to end | One type system from DB row to React prop; shared algorithms run on server *and* client (fare previews). |
| HTTP | Fastify 5 | Mature, fast, first-class schema validation, great plugin ecosystem (helmet, rate-limit, jwt, swagger). |
| Validation | Zod via `fastify-type-provider-zod` | Same schemas validate requests server-side and forms client-side; OpenAPI generated from them. |
| Database | PostgreSQL + Drizzle ORM | Real transactions, enums, JSONB; Drizzle is typed SQL with plain SQL migrations. |
| Zero-setup dev | PGlite | Real Postgres compiled to WASM — no Docker needed to run or test; identical SQL semantics. |
| Realtime | Socket.IO | Rooms, acks, auto-reconnect with backoff, long-polling fallback for flaky mobile networks. |
| Frontend | React 18 + Vite + Tailwind | Stable, fast builds, utility CSS that makes responsive phone/laptop layouts straightforward. |
| Server state | TanStack Query | Caching + socket-driven invalidation instead of hand-rolled polling. |
| Maps | Leaflet + CARTO tiles | Free, light, works offline-ish with the PWA tile cache. |
| Install | vite-plugin-pwa | Add to home screen on phones; app shell + tiles cached. |

## Ride lifecycle

```
Ride:   pending ──match──▶ matched ──accept──▶ confirmed ──PIN──▶ picked_up ──drop──▶ completed
           ▲                  │ decline/timeout     │ cancel                 
           └──────────────────┘                     ▼                         
                                                cancelled / no_show / expired

Group:  accepting ──all accepted──▶ dispatching ──driver accepts──▶ assigned ──▶ arrived ──▶ on_trip ──▶ completed
```

Every transition is a single `UPDATE … WHERE status = <expected>` (and a `version`
counter on hot rows). If two workers race, one update matches zero rows and backs off —
no rider can ever be placed in two cabs, and no group can get two drivers.

## Matching

1. **Late joiners first** — pending riders are tried against groups still in `accepting`
   with free seats (never a group the rider previously declined).
2. **New groups** — remaining riders at each hub are seeded by earliest arrival and
   greedily extended with the most direction-aligned candidates.
3. A candidate joins only if *all* hold: arrival windows overlap, seats & luggage fit,
   women-only preferences hold for everyone, and an exact (k! permutations, k ≤ 4)
   drop order exists keeping every rider within `min(30 % of solo, 6 km)` of detour.
4. Route geometry and distances come from OSRM (cached), falling back to a calibrated
   haversine estimate if OSRM is slow or down.

## Fares

```
solo(i)  = max(minFare, base + perKm × soloKm(i))
group    = max(minFare, base + perKm × routeKm)          ← base charged once per cab
share(i) = group × soloKm(i) / Σ soloKm
final(i) = min(share(i), solo(i), accepted(i))           ← price guarantee
subsidy  = Σ (share(i) − final(i))                        ← absorbed by the platform
driver   = group − commission + (full cab ? bonus : 0)
```

## Scaling notes

* All scheduler steps are idempotent, so the API can run as several instances.
* Socket.IO fan-out across instances needs the Redis adapter (a drop-in addition to
  `realtime/gateway.ts`); the `realtime` façade means no service code changes.
* Location pings are append-only and indexed by `(group_id, created_at)`; they can be
  moved to a time-series table or partitioned by day without touching the services.
