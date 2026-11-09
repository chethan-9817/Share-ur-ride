import { describe, expect, it } from 'vitest';
import {
  bearingDeg,
  bearingDelta,
  distanceToPolylineKm,
  haversineKm,
  interpolatePolyline,
  isValidLatLng,
} from '../geo';

const BLR_AIRPORT = { lat: 13.1986, lng: 77.7066 };
const MG_ROAD = { lat: 12.9756, lng: 77.6066 };

describe('geo', () => {
  it('computes great-circle distance between BLR airport and MG Road (~27 km)', () => {
    const d = haversineKm(BLR_AIRPORT, MG_ROAD);
    expect(d).toBeGreaterThan(26);
    expect(d).toBeLessThan(28);
  });

  it('is symmetric and zero for identical points', () => {
    expect(haversineKm(MG_ROAD, MG_ROAD)).toBe(0);
    expect(haversineKm(BLR_AIRPORT, MG_ROAD)).toBeCloseTo(haversineKm(MG_ROAD, BLR_AIRPORT), 9);
  });

  it('computes bearings (south ≈ 180°)', () => {
    const b = bearingDeg({ lat: 13, lng: 77.6 }, { lat: 12.9, lng: 77.6 });
    expect(b).toBeCloseTo(180, 0);
    expect(bearingDelta(350, 10)).toBe(20);
    expect(bearingDelta(90, 270)).toBe(180);
  });

  it('measures distance to a polyline', () => {
    const line = [
      { lat: 12.9, lng: 77.5 },
      { lat: 12.9, lng: 77.6 },
    ];
    expect(distanceToPolylineKm({ lat: 12.9, lng: 77.55 }, line)).toBeLessThan(0.01);
    const off = distanceToPolylineKm({ lat: 12.91, lng: 77.55 }, line);
    expect(off).toBeGreaterThan(1.0);
    expect(off).toBeLessThan(1.2);
  });

  it('interpolates along a polyline', () => {
    const line = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
    ];
    expect(interpolatePolyline(line, 0.5).lng).toBeCloseTo(0.5, 5);
    expect(interpolatePolyline(line, 2)).toEqual(line[1]);
  });

  it('validates coordinates', () => {
    expect(isValidLatLng({ lat: 12, lng: 77 })).toBe(true);
    expect(isValidLatLng({ lat: 120, lng: 77 })).toBe(false);
    expect(isValidLatLng(null)).toBe(false);
  });
});
