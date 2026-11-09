# API reference

Interactive OpenAPI docs are served at **`/docs`** when the API is running. All endpoints
are under `/api`. Errors always look like:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Some fields are invalid", "details": [...] } }
```

Auth: `Authorization: Bearer <accessToken>` (15-minute JWT). The refresh token is an
httpOnly cookie scoped to `/api/auth`, rotated on every refresh with reuse detection.

## Auth
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/otp/request` | `{ email }` → emails a 6-digit code (rate-limited). Demo mode without SMTP returns `devCode`. |
| POST | `/auth/otp/verify` | `{ email, code }` → `{ accessToken, user }` + refresh cookie. Creates the account on first login. |
| POST | `/auth/refresh` | Rotates the refresh cookie, returns a new access token. |
| POST | `/auth/logout` | Revokes the refresh token. |
| POST | `/auth/demo` | `{ as: rider \| rider2 \| driver \| admin }` — demo mode only. |
| GET | `/auth/config` | Public client config (demo flag, timers). |

## Me & safety settings
| Method | Path | Notes |
| --- | --- | --- |
| GET / PATCH | `/me` | Profile, gender, safety preferences. |
| GET / POST | `/me/contacts` | Trusted contacts (max 5). |
| DELETE | `/me/contacts/:id` | |
| GET | `/me/notifications` · POST `/me/notifications/read` | In-app notifications. |

## Places
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/stations` | Active hubs. |
| GET | `/places?q=&stationId=` | Place search biased to the hub (Nominatim, cached, offline fallback). |
| GET | `/places/reverse?lat=&lng=` | Reverse geocode a dropped pin. |

## Rides (rider)
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/rides/quote` | Solo fare, estimated shared fare, ETA, CO₂. |
| POST | `/rides` | Book; matching runs immediately. |
| GET | `/rides?scope=active\|history\|all` | |
| GET / PATCH | `/rides/:id` | Edit arrival/tolerance while pending. |
| POST | `/rides/:id/accept` · `/decline` · `/solo` · `/cancel` | |
| GET | `/rides/:id/group` | Group view with privacy rules applied. |
| POST / DELETE | `/rides/:id/share` | Create (optionally email contacts) / revoke a live link. |
| GET | `/rides/:id/safety` | Safety timeline for the ride. |

## Driver
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/driver/onboard` | Register vehicle + licence. |
| GET | `/driver/me` | |
| POST | `/driver/status` | `{ online }` |
| POST | `/driver/location` | GPS ping (also available over the socket). |
| GET | `/driver/offer` · POST `/driver/offers/:id/accept\|reject` | |
| GET | `/driver/trip` | Current trip with stops. |
| POST | `/driver/trip/arrive` · `/verify-pin` · `/no-show` · `/start` · `/drop` | |
| GET | `/driver/earnings` | Today / week / lifetime + 14-day series. |

## Safety
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/safety/sos` | Silent SOS. |
| GET | `/safety/sos` | My incidents. |
| POST | `/safety/check-in` | `{ rideId, safe }` |
| GET | `/share/:token` | **Public** live-trip view. |
| POST | `/ratings` | `{ rideId, score, tags, comment }` |

## Admin (role `admin`)
`GET /admin/overview` · `GET /admin/sos?open=true` · `PATCH /admin/sos/:id` ·
`GET /admin/safety-events` · `GET /admin/drivers` · `PATCH /admin/drivers/:id` ·
`GET /admin/users?q=` · `PATCH /admin/users/:id` · `GET /admin/live`

## Socket.IO events
| Event | Direction | Room |
| --- | --- | --- |
| `ride:updated`, `group:updated` | server → client | `user:<id>`, `group:<id>` |
| `offer:received`, `offer:cancelled` | server → driver | `user:<id>` |
| `driver:location` | server → client | `group:<id>`, `share:<token>` |
| `safety:check_in` | server → rider | `user:<id>` |
| `safety:alert`, `sos:raised`, `sos:updated` | server → ops | `admins` (and share viewers for alerts) |
| `notification` | server → client | `user:<id>` |
| `group:join`, `share:join` | client → server | membership / token checked |
| `driver:location:push` | driver → server | — |
