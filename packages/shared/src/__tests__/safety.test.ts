import { describe, expect, it } from 'vitest';
import { evaluatePings, isNightTime, type Ping } from '../safety';
import { maskPhone, nameFromEmail, firstName } from '../format';

const route = [
  { lat: 12.9, lng: 77.5 },
  { lat: 12.9, lng: 77.7 },
];
const stops = [{ lat: 12.9, lng: 77.7 }];
const t0 = Date.parse('2026-11-09T20:00:00Z');

describe('evaluatePings', () => {
  it('stays quiet while the cab is on route and moving', () => {
    const pings: Ping[] = [0, 1, 2, 3].map((i) => ({ lat: 12.9, lng: 77.5 + i * 0.02, at: t0 + i * 30_000, speedKmh: 40 }));
    expect(evaluatePings(pings, route, stops)).toEqual([]);
  });

  it('flags a sustained route deviation', () => {
    const pings: Ping[] = [0, 1, 2].map((i) => ({ lat: 12.95, lng: 77.55 + i * 0.01, at: t0 + i * 30_000 }));
    const s = evaluatePings(pings, route, stops);
    expect(s.map((x) => x.type)).toContain('route_deviation');
  });

  it('flags a long unexpected stop away from planned stops', () => {
    const pings: Ping[] = [0, 2, 4, 6].map((m) => ({ lat: 12.9, lng: 77.6, at: t0 + m * 60_000, speedKmh: 0 }));
    const s = evaluatePings(pings, route, stops);
    expect(s).toContainEqual({ type: 'unexpected_stop', minutes: 6 });
  });

  it('ignores stopping at a planned drop', () => {
    const pings: Ping[] = [0, 3, 6].map((m) => ({ lat: 12.9, lng: 77.7, at: t0 + m * 60_000 }));
    expect(evaluatePings(pings, route, stops)).toEqual([]);
  });

  it('flags speeding over two consecutive pings', () => {
    const pings: Ping[] = [0, 1].map((i) => ({ lat: 12.9, lng: 77.5 + i * 0.03, at: t0 + i * 10_000, speedKmh: 130 }));
    expect(evaluatePings(pings, route, stops).map((x) => x.type)).toContain('speeding');
  });
});

describe('isNightTime', () => {
  it('uses IST by default', () => {
    expect(isNightTime(new Date('2026-11-09T18:00:00Z'))).toBe(true); // 23:30 IST
    expect(isNightTime(new Date('2026-11-09T06:00:00Z'))).toBe(false); // 11:30 IST
  });
});

describe('format helpers', () => {
  it('masks phones and derives names', () => {
    expect(maskPhone('+919876543210')).toBe('+91 ••••• •3210');
    expect(nameFromEmail('priya.sharma92@gmail.com')).toBe('Priya Sharma');
    expect(firstName('ananya rao')).toBe('Ananya');
  });
});
