import { polylineLengthKm, roadEstimateKm, round2, type LatLng } from '@arriveshare/shared';
import { env } from '../config/env';

/**
 * Road routing via OSRM with:
 *  • an in-memory LRU cache (hubs are fixed, so hit rates are high)
 *  • a hard timeout
 *  • a circuit breaker — after a failure we use haversine estimates for 60 s
 *    instead of hammering a dead upstream.
 */

export interface RouteResult {
  km: number;
  durationMin: number;
  geometry: LatLng[];
  source: 'osrm' | 'estimate';
}

const CACHE_MAX = 2000;
const cache = new Map<string, RouteResult>();
let breakerOpenUntil = 0;

const key = (pts: LatLng[]) => pts.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');

function remember(k: string, v: RouteResult) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(k, v);
}

/** Average urban cab speed used when estimating durations. */
const AVG_KMH = 28;

function estimate(points: LatLng[]): RouteResult {
  let km = 0;
  for (let i = 0; i < points.length - 1; i++) km += roadEstimateKm(points[i]!, points[i + 1]!);
  return { km: round2(km), durationMin: Math.round((km / AVG_KMH) * 60), geometry: points, source: 'estimate' };
}

async function osrm(points: LatLng[], timeoutMs: number): Promise<RouteResult> {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `${env.OSRM_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'ArriveShare/2.0 (ride-pooling demo)' },
  });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const body = (await res.json()) as {
    code: string;
    routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
  };
  const r = body.routes?.[0];
  if (body.code !== 'Ok' || !r) throw new Error(`OSRM ${body.code}`);
  const geometry = simplify(r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })));
  return {
    km: round2(r.distance / 1000),
    durationMin: Math.round(r.duration / 60),
    geometry,
    source: 'osrm',
  };
}

/** Keeps every Nth vertex so polylines stay small in DB rows and socket payloads. */
function simplify(line: LatLng[], maxPoints = 400): LatLng[] {
  if (line.length <= maxPoints) return line;
  const step = Math.ceil(line.length / maxPoints);
  const out = line.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== line[line.length - 1]) out.push(line[line.length - 1]!);
  return out;
}

export async function routeThrough(points: LatLng[]): Promise<RouteResult> {
  if (points.length < 2) return { km: 0, durationMin: 0, geometry: points, source: 'estimate' };
  const k = key(points);
  const hit = cache.get(k);
  if (hit) return hit;

  if (env.OSRM_ENABLED && Date.now() >= breakerOpenUntil) {
    // The public OSRM demo server is occasionally slow: one retry before giving up.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await osrm(points, attempt === 0 ? env.OSRM_TIMEOUT_MS : env.OSRM_TIMEOUT_MS * 2);
        remember(k, r);
        return r;
      } catch {
        /* retry once */
      }
    }
    breakerOpenUntil = Date.now() + 30_000;
  }
  // Estimates are NOT cached — the next request gets another chance at a real road route.
  return estimate(points);
}

/** True when a stored route is just straight lines between stops (OSRM was unavailable). */
export function isStraightLineRoute(route: LatLng[], stops: number) {
  return route.length > 0 && route.length <= stops + 1;
}

export async function roadKm(a: LatLng, b: LatLng): Promise<number> {
  return (await routeThrough([a, b])).km;
}

export function routeLengthKm(geometry: LatLng[]) {
  return round2(polylineLengthKm(geometry));
}

export function clearRoutingCache() {
  cache.clear();
  breakerOpenUntil = 0;
}
