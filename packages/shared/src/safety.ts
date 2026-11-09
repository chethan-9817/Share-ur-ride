import { NIGHT_END_HOUR, NIGHT_START_HOUR } from './constants';
import { distanceToPolylineKm, haversineKm, type LatLng } from './geo';

/**
 * Pure safety heuristics evaluated on every driver location ping during a trip.
 * They are deliberately conservative: an alert asks the rider to check in, and only
 * escalates to the trusted contacts / ops team if the rider doesn't respond.
 */

export interface SafetyThresholds {
  /** Off-route distance that counts as a deviation. */
  deviationKm: number;
  /** Consecutive off-route pings needed before alerting (filters GPS noise). */
  deviationPings: number;
  /** Stationary time (away from any planned stop) that triggers an alert. */
  stopMinutes: number;
  /** Radius treated as "stationary". */
  stopRadiusKm: number;
  /** Radius around a planned stop where stopping is expected. */
  stopZoneKm: number;
  /** Sustained speed considered dangerous. */
  speedingKmh: number;
}

export const DEFAULT_SAFETY_THRESHOLDS: SafetyThresholds = {
  deviationKm: 1.5,
  deviationPings: 3,
  stopMinutes: 5,
  stopRadiusKm: 0.08,
  stopZoneKm: 0.35,
  speedingKmh: 110,
};

export interface Ping extends LatLng {
  at: number; // epoch ms
  speedKmh?: number | null;
}

export type SafetySignal =
  | { type: 'route_deviation'; offRouteKm: number }
  | { type: 'unexpected_stop'; minutes: number }
  | { type: 'speeding'; speedKmh: number };

export function isNightTime(date: Date, utcOffsetMin = 330): boolean {
  const local = new Date(date.getTime() + utcOffsetMin * 60_000);
  const h = local.getUTCHours();
  return NIGHT_START_HOUR > NIGHT_END_HOUR
    ? h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR
    : h >= NIGHT_START_HOUR && h < NIGHT_END_HOUR;
}

/**
 * Evaluates recent pings (oldest → newest) against the planned route and stops.
 * Returns every signal that currently holds; callers de-duplicate over time.
 */
export function evaluatePings(
  pings: Ping[],
  route: LatLng[],
  plannedStops: LatLng[],
  t: SafetyThresholds = DEFAULT_SAFETY_THRESHOLDS,
): SafetySignal[] {
  const signals: SafetySignal[] = [];
  if (pings.length === 0) return signals;
  const latest = pings[pings.length - 1]!;

  // 1. Route deviation — the last N pings are all off the planned polyline.
  if (route.length >= 2 && pings.length >= t.deviationPings) {
    const tail = pings.slice(-t.deviationPings);
    const offs = tail.map((p) => distanceToPolylineKm(p, route));
    if (offs.every((d) => d > t.deviationKm)) {
      signals.push({ type: 'route_deviation', offRouteKm: Math.round(offs.at(-1)! * 100) / 100 });
    }
  }

  // 2. Unexpected stop — stationary for too long, and not near a planned stop.
  const nearStop = plannedStops.some((s) => haversineKm(s, latest) <= t.stopZoneKm);
  if (!nearStop) {
    let since = latest.at;
    for (let i = pings.length - 1; i >= 0; i--) {
      if (haversineKm(pings[i]!, latest) > t.stopRadiusKm) break;
      since = pings[i]!.at;
    }
    const minutes = (latest.at - since) / 60_000;
    if (minutes >= t.stopMinutes) {
      signals.push({ type: 'unexpected_stop', minutes: Math.round(minutes) });
    }
  }

  // 3. Speeding — the last 2 pings both report excessive speed.
  const lastTwo = pings.slice(-2);
  if (lastTwo.length === 2 && lastTwo.every((p) => (p.speedKmh ?? 0) > t.speedingKmh)) {
    signals.push({ type: 'speeding', speedKmh: Math.round(latest.speedKmh ?? 0) });
  }

  return signals;
}
