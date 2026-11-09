# Women-safety design

Airport and station arrivals often happen late at night, and pooling means sharing a car
with strangers. Safety is designed into every step instead of bolted on as a panic button.

## Before the ride

| Feature | How it works |
| --- | --- |
| **Women-only pools** | Riders who identify as women can require women-only co-riders. The matcher rejects any group where a women-only rider would share with someone who isn't a woman — enforced server-side, in the pure `genderCompatible` check. |
| **Female drivers first** | Women-only groups (or riders preferring a female driver) are offered to verified female drivers first. If none accepts within `FEMALE_DRIVER_PRIORITY_SEC`, the offer widens only to verified drivers rated ≥ 4.5. |
| **Privacy by default** | Co-riders see first names, verification badge, rating and drop order — never phone numbers, emails or exact addresses. Driver and rider phone numbers are masked. |
| **Verified drivers** | Drivers can't go online until ops approves their documents. |

## At pickup

| Feature | How it works |
| --- | --- |
| **4-digit PIN** | The driver must enter each rider's PIN to start the trip — proving the right rider is in the right cab. Five wrong PINs lock the ride. |
| **Plate first** | The rider app shows the plate number in a large yellow plate graphic and tells riders to check it before sharing their PIN. |

## During the ride

| Feature | How it works |
| --- | --- |
| **Live trip sharing** | A tokenised public link (no app or login needed) shows the cab's live position, vehicle and the rider's first name. Auto-emailed to trusted contacts when the trip starts if the rider opts in. Revocable; expires automatically. |
| **Silent SOS** | Press-and-hold (prevents pocket dials). Alerts the ops console in real time and emails trusted contacts a live link and map pin. **The driver is never notified**, to avoid escalating a dangerous situation. Repeated presses update the location instead of spamming. |
| **Route watch** | Every GPS ping is checked against the planned polyline. Sustained deviation (> 1.5 km for 3 pings), a long unexpected stop (≥ 5 min away from planned stops), or speeding (> 110 km/h) triggers a check-in. |
| **"Are you okay?" check-ins** | The rider gets a full-screen prompt with a countdown. "I need help" raises an SOS; no answer within `CHECK_IN_TIMEOUT_SEC` escalates to trusted contacts and ops. |
| **Night-ride check-ins** | Between 10 PM and 6 AM IST, opted-in riders get a gentle check-in every ~15 minutes. |
| **Fake call** | A realistic incoming-call screen rings after 5 s — a discreet way out of an uncomfortable conversation. |
| **Helplines** | One-tap 112 and 1091 (Women Helpline) everywhere safety UI appears. |

## After the ride

* Two-way ratings. Low scores tagged *unsafe* or *rash driving* open a safety review
  in the ops console automatically.
* Ops can suspend users and revoke driver verification.

## Principles

1. **Never accuse, always ask.** Anomalies ask the rider first; humans are alerted only on "help" or silence.
2. **Never tip off.** Nothing safety-related is sent to the driver's device.
3. **Least data.** Share links and co-rider views expose only what's needed.
4. **Server-enforced.** Every rule lives on the API; the UI only reflects it.
