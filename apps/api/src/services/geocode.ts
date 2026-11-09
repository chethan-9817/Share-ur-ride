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

/** Offline fallback — popular Bengaluru neighbourhoods. */
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
];

function localSearch(q: string): Place[] {
  const needle = q.toLowerCase();
  return POPULAR_PLACES.filter((p) => p.label.toLowerCase().includes(needle)).slice(0, 8);
}

export async function searchPlaces(q: string, near?: { lat: number; lng: number }): Promise<Place[]> {
  const query = q.trim();
  if (query.length < 2) return POPULAR_PLACES.slice(0, 8);
  const k = `${query.toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : ''}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.places;

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '0',
      limit: '8',
      countrycodes: 'in',
    });
    if (near) {
      const d = 0.6; // ~65 km box around the hub
      params.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
      params.set('bounded', '1');
    }
    const res = await fetch(`${env.NOMINATIM_BASE_URL}/search?${params}`, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'ArriveShare/2.0 (ride-pooling demo)', 'Accept-Language': 'en' },
    });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const rows = (await res.json()) as { display_name: string; name?: string; lat: string; lon: string }[];
    const places = rows.map((r) => ({
      label: r.display_name,
      short: r.name || r.display_name.split(',')[0]!,
      lat: Number(r.lat),
      lng: Number(r.lon),
    }));
    const merged = places.length ? places : localSearch(query);
    cache.set(k, { at: Date.now(), places: merged });
    return merged;
  } catch {
    return localSearch(query);
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
