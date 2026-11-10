import { haversineKm } from '@arriveshare/shared';
import { env } from '../config/env';

/**
 * Place search proxied through the API so we can cache results, apply a polite
 * User-Agent (required by OSM's usage policy) and bias results to the hub's city.
 */

export interface Place {
  label: string;
  short: string;
  lat: number;
  lng: number;
}

const cache = new Map<string, { at: number; places: Place[] }>();
const TTL = 60 * 60 * 1000;

/** Offline fallback — popular places around our hubs (Bengaluru, Mangaluru, Mysuru and the highway towns between). */
export const POPULAR_PLACES: Place[] = [
  { short: 'Indiranagar', label: 'Indiranagar, Bengaluru', lat: 12.9719, lng: 77.6412 },
  { short: 'Koramangala', label: 'Koramangala, Bengaluru', lat: 12.9352, lng: 77.6245 },
  { short: 'HSR Layout', label: 'HSR Layout, Bengaluru', lat: 12.9116, lng: 77.6474 },
  { short: 'Whitefield', label: 'Whitefield, Bengaluru', lat: 12.9698, lng: 77.75 },
  { short: 'Hebbal', label: 'Hebbal, Bengaluru', lat: 13.0358, lng: 77.597 },
  { short: 'Malleshwaram', label: 'Malleshwaram, Bengaluru', lat: 13.0035, lng: 77.5709 },
  { short: 'Jayanagar', label: 'Jayanagar, Bengaluru', lat: 12.925, lng: 77.5938 },
  { short: 'Electronic City', label: 'Electronic City, Bengaluru', lat: 12.8452, lng: 77.6602 },
  { short: 'MG Road', label: 'MG Road, Bengaluru', lat: 12.9756, lng: 77.6066 },
  { short: 'Yelahanka', label: 'Yelahanka, Bengaluru', lat: 13.1007, lng: 77.5963 },
  { short: 'Marathahalli', label: 'Marathahalli, Bengaluru', lat: 12.9591, lng: 77.6974 },
  { short: 'BTM Layout', label: 'BTM Layout, Bengaluru', lat: 12.9166, lng: 77.6101 },
  { short: 'Rajajinagar', label: 'Rajajinagar, Bengaluru', lat: 12.9915, lng: 77.5543 },
  { short: 'Manyata Tech Park', label: 'Manyata Tech Park, Nagavara, Bengaluru', lat: 13.0475, lng: 77.6205 },
  // Mangaluru & coast
  { short: 'Hampankatta', label: 'Hampankatta, Mangaluru', lat: 12.8698, lng: 74.8431 },
  { short: 'Kadri', label: 'Kadri, Mangaluru', lat: 12.8964, lng: 74.8528 },
  { short: 'Surathkal', label: 'Surathkal, Mangaluru', lat: 13.0, lng: 74.7939 },
  { short: 'Bejai', label: 'Bejai, Mangaluru', lat: 12.8878, lng: 74.8369 },
  { short: 'Kankanady', label: 'Kankanady, Mangaluru', lat: 12.8671, lng: 74.8689 },
  { short: 'Udupi', label: 'Udupi, Karnataka', lat: 13.3409, lng: 74.7421 },
  { short: 'Manipal', label: 'Manipal, Udupi, Karnataka', lat: 13.3475, lng: 74.7869 },
  // Mysuru & highway towns
  { short: 'Mysuru', label: 'Mysuru, Karnataka', lat: 12.2958, lng: 76.6394 },
  { short: 'Mandya', label: 'Mandya, Karnataka', lat: 12.5218, lng: 76.8951 },
  { short: 'Hassan', label: 'Hassan, Karnataka', lat: 13.0068, lng: 76.1004 },
  { short: 'Tumakuru', label: 'Tumakuru, Karnataka', lat: 13.3379, lng: 77.1173 },
  { short: 'Kunigal', label: 'Kunigal, Tumakuru, Karnataka', lat: 13.0231, lng: 77.0259 },
  { short: 'Chikkamagaluru', label: 'Chikkamagaluru, Karnataka', lat: 13.3153, lng: 75.7754 },
];

type Near = { lat: number; lng: number };

/** Closest first, so a rider at a Mangaluru hub sees Mangaluru places before Bengaluru ones. */
const byDistance = (list: Place[], near?: Near) =>
  near ? [...list].sort((a, b) => haversineKm(near, a) - haversineKm(near, b)) : list;

function localSearch(q: string, near?: Near): Place[] {
  const needle = q.toLowerCase();
  return byDistance(POPULAR_PLACES.filter((p) => p.label.toLowerCase().includes(needle)), near).slice(0, 8);
}

export async function searchPlaces(q: string, near?: Near): Promise<Place[]> {
  const query = q.trim();
  if (query.length < 2) return byDistance(POPULAR_PLACES, near).slice(0, 8);
  const k = `${query.toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : ''}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.places;

  try {
    const fetchRows = async (biased: boolean): Promise<Place[]> => {
      const params = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '0', limit: '8', countrycodes: 'in' });
      if (biased && near) {
        const d = 0.6; // ~65 km box around the hub — a preference, not a limit
        params.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
      }
      const res = await fetch(`${env.NOMINATIM_BASE_URL}/search?${params}`, {
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': 'ArriveShare/2.0 (ride-pooling demo)', 'Accept-Language': 'en' },
      });
      if (!res.ok) throw new Error(`nominatim ${res.status}`);
      const rows = (await res.json()) as { display_name: string; name?: string; lat: string; lon: string }[];
      return rows.map((r) => ({
        label: r.display_name,
        short: r.name || r.display_name.split(',')[0]!,
        lat: Number(r.lat),
        lng: Number(r.lon),
      }));
    };

    // Two views of the same query: one nudged towards the hub, one nationwide. This lets
    // "Indiranagar" resolve locally while "Mangalore" still finds Mangaluru from a Bengaluru hub.
    const [local, nationwide] = await Promise.all([fetchRows(true), near ? fetchRows(false) : Promise.resolve([] as Place[])]);
    const seen = new Set<string>();
    const merged = [...local, ...nationwide].filter((p) => {
      const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });
    // Names that actually start like what was typed come first; otherwise keep local-first order.
    const needle = query.toLowerCase();
    const commonPrefix = (name: string) => {
      const n = name.toLowerCase();
      let i = 0;
      while (i < n.length && i < needle.length && n[i] === needle[i]) i++;
      return i;
    };
    const wanted = Math.min(4, needle.length);
    const ranked = merged
      .map((p, i) => ({ p, i, hit: commonPrefix(p.short) >= wanted ? 0 : 1 }))
      .sort((a, b) => a.hit - b.hit || a.i - b.i)
      .map((x) => x.p)
      .slice(0, 8);
    const places = ranked.length ? ranked : localSearch(query, near);
    cache.set(k, { at: Date.now(), places });
    return places;
  } catch {
    return localSearch(query, near);
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'jsonv2', zoom: '16' });
    const res = await fetch(`${env.NOMINATIM_BASE_URL}/reverse?${params}`, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'ArriveShare/2.0 (ride-pooling demo)', 'Accept-Language': 'en' },
    });
    if (!res.ok) throw new Error();
    const body = (await res.json()) as { display_name?: string };
    return body.display_name?.split(',').slice(0, 3).join(',') ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}
