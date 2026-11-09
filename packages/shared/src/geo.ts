/** Geodesy helpers. All distances are kilometres unless stated otherwise. */

export interface LatLng {
  lat: number;
  lng: number;
}

export const EARTH_RADIUS_KM = 6371.0088;

/**
 * Typical ratio of road distance to great-circle distance in Indian metros.
 * Used to estimate road km without a routing call.
 */
export const ROAD_FACTOR = 1.32;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance via the haversine formula. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated road distance (haversine × road factor). */
export function roadEstimateKm(a: LatLng, b: LatLng, factor = ROAD_FACTOR): number {
  return haversineKm(a, b) * factor;
}

/** Initial compass bearing from a to b, 0–360°. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two bearings, 0–180°. */
export function bearingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Shortest distance (km) from point p to the segment a→b.
 * Uses a local equirectangular projection — accurate to well under 1% at city scale.
 */
export function pointToSegmentKm(p: LatLng, a: LatLng, b: LatLng): number {
  const latRef = toRad((a.lat + b.lat + p.lat) / 3);
  const project = (q: LatLng) => ({
    x: toRad(q.lng) * Math.cos(latRef) * EARTH_RADIUS_KM,
    y: toRad(q.lat) * EARTH_RADIUS_KM,
  });
  const P = project(p);
  const A = project(a);
  const B = project(b);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = A.x + t * dx;
  const cy = A.y + t * dy;
  return Math.hypot(P.x - cx, P.y - cy);
}

/** Shortest distance (km) from a point to any segment of a polyline. */
export function distanceToPolylineKm(p: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineKm(p, line[0]!);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    best = Math.min(best, pointToSegmentKm(p, line[i]!, line[i + 1]!));
  }
  return best;
}

/** Total length of a polyline in km. */
export function polylineLengthKm(line: LatLng[]): number {
  let sum = 0;
  for (let i = 0; i < line.length - 1; i++) sum += haversineKm(line[i]!, line[i + 1]!);
  return sum;
}

/** Linear interpolation along a polyline at fraction t ∈ [0,1] — used by the trip simulator. */
export function interpolatePolyline(line: LatLng[], t: number): LatLng {
  if (line.length === 0) throw new Error('empty polyline');
  if (line.length === 1 || t <= 0) return line[0]!;
  if (t >= 1) return line[line.length - 1]!;
  const total = polylineLengthKm(line);
  let target = total * t;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const seg = haversineKm(a, b);
    if (target <= seg) {
      const f = seg === 0 ? 0 : target / seg;
      return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
    }
    target -= seg;
  }
  return line[line.length - 1]!;
}

/** Validates a coordinate pair. */
export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}
