import type { LatLng } from '@arriveshare/shared';
import { useEffect, useRef, useState } from 'react';

export interface GeoFix extends LatLng {
  heading: number | null;
  speedKmh: number | null;
  accuracyM: number | null;
  at: number;
}

/**
 * Continuous GPS via watchPosition. Used by the driver app to stream the cab's
 * position. Works on phones (HTTPS or localhost) and laptops.
 */
export function useWatchPosition(enabled: boolean, onFix?: (f: GeoFix) => void) {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cb = useRef(onFix);
  cb.current = onFix;

  useEffect(() => {
    if (!enabled) return;
    if (!('geolocation' in navigator)) {
      setError('Location is not available on this device');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const f: GeoFix = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null,
          speedKmh: p.coords.speed != null ? Math.round(p.coords.speed * 3.6) : null,
          accuracyM: Math.round(p.coords.accuracy),
          at: p.timestamp,
        };
        setFix(f);
        setError(null);
        cb.current?.(f);
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? 'Location permission denied' : 'Unable to get location'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { fix, error };
}

/** One-shot position (for SOS). Resolves null if unavailable within 5 s. */
export function currentPosition(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 15000 },
    );
  });
}
