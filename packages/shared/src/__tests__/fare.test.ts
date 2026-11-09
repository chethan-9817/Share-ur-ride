import { describe, expect, it } from 'vitest';
import { co2SavedKg, driverPayout, groupFare, soloFare, splitFare, type FareParams } from '../fare';

const P: FareParams = { baseFare: 50, perKm: 12, minFare: 80, fullCabBonusPct: 0.1, commissionPct: 0.15 };

describe('fare engine', () => {
  it('charges base + per-km for a solo ride, respecting the minimum', () => {
    expect(soloFare(10, P)).toBe(170);
    expect(soloFare(1, P)).toBe(80);
  });

  it('charges the base fare only once for the whole group', () => {
    expect(groupFare(30, P)).toBe(50 + 12 * 30);
  });

  it('splits proportionally to solo distance and never exceeds solo fare', () => {
    const split = splitFare(
      [
        { id: 'a', soloKm: 20 },
        { id: 'b', soloKm: 30 },
      ],
      34,
      P,
    );
    const [a, b] = split.riders;
    expect(a!.distanceSharePct).toBe(40);
    expect(b!.distanceSharePct).toBe(60);
    expect(a!.finalFare).toBeLessThanOrEqual(a!.soloFare);
    expect(b!.finalFare).toBeLessThanOrEqual(b!.soloFare);
    expect(a!.finalFare + b!.finalFare).toBeCloseTo(split.groupFare, 1);
    expect(split.platformSubsidy).toBe(0);
  });

  it('honours the price guarantee and books the difference as subsidy', () => {
    const split = splitFare(
      [
        { id: 'a', soloKm: 20, acceptedFare: 150 },
        { id: 'b', soloKm: 20 },
      ],
      40,
      P,
    );
    const a = split.riders.find((r) => r.id === 'a')!;
    expect(a.finalFare).toBe(150);
    expect(a.subsidy).toBeGreaterThan(0);
    expect(split.platformSubsidy).toBe(a.subsidy);
  });

  it('caps a share at the solo fare when the shared route is long', () => {
    const split = splitFare([{ id: 'a', soloKm: 5 }, { id: 'b', soloKm: 5 }], 60, P);
    for (const r of split.riders) expect(r.finalFare).toBe(r.soloFare);
  });

  it('adds the full-cab bonus to driver payout', () => {
    const full = driverPayout(1000, 4, 4, P);
    expect(full.bonus).toBe(100);
    expect(full.net).toBe(1000 - 150 + 100);
    expect(driverPayout(1000, 3, 4, P).bonus).toBe(0);
  });

  it('estimates CO₂ saved', () => {
    expect(co2SavedKg(60, 35)).toBe(3);
    expect(co2SavedKg(10, 20)).toBe(0);
  });
});
