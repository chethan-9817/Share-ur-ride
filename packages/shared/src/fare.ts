/**
 * Canonical fare engine.
 *
 *  solo(i)   = base + perKm × soloKm(i)
 *  group     = base + perKm × routeKm        (base charged ONCE per cab)
 *  share(i)  = group × soloKm(i) / Σ soloKm  (proportional to what you'd have travelled alone)
 *  final(i)  = min(share(i), solo(i), accepted(i))   ← nobody ever pays more than solo,
 *                                                       nor more than what they accepted
 *  subsidy   = Σ (share(i) − final(i))          ← absorbed by the platform
 */

export interface FareParams {
  baseFare: number;
  perKm: number;
  minFare: number;
  /** Multiplier for driver payout when the cab is full. */
  fullCabBonusPct: number;
  /** Platform commission taken from the collected fares, 0–1. */
  commissionPct: number;
}

export const DEFAULT_FARE_PARAMS: FareParams = {
  baseFare: 50,
  perKm: 12,
  minFare: 80,
  fullCabBonusPct: 0.1,
  commissionPct: 0.15,
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function soloFare(soloKm: number, p: FareParams = DEFAULT_FARE_PARAMS): number {
  return round2(Math.max(p.minFare, p.baseFare + p.perKm * Math.max(0, soloKm)));
}

export function groupFare(routeKm: number, p: FareParams = DEFAULT_FARE_PARAMS): number {
  return round2(Math.max(p.minFare, p.baseFare + p.perKm * Math.max(0, routeKm)));
}

export interface RiderFareInput {
  id: string;
  soloKm: number;
  /** Fare already accepted (price guarantee) — undefined if not yet accepted. */
  acceptedFare?: number | null;
}

export interface RiderFareBreakdown {
  id: string;
  soloFare: number;
  rawShare: number;
  finalFare: number;
  savings: number;
  savingsPct: number;
  distanceSharePct: number;
  subsidy: number;
}

export interface GroupFareBreakdown {
  routeKm: number;
  groupFare: number;
  collected: number;
  platformSubsidy: number;
  riders: RiderFareBreakdown[];
}

export function splitFare(
  riders: RiderFareInput[],
  routeKm: number,
  p: FareParams = DEFAULT_FARE_PARAMS,
): GroupFareBreakdown {
  if (riders.length === 0) {
    return { routeKm, groupFare: 0, collected: 0, platformSubsidy: 0, riders: [] };
  }
  const total = groupFare(routeKm, p);
  const sumSolo = riders.reduce((s, r) => s + Math.max(0, r.soloKm), 0);

  const out: RiderFareBreakdown[] = riders.map((r) => {
    const weight = sumSolo > 0 ? Math.max(0, r.soloKm) / sumSolo : 1 / riders.length;
    const solo = soloFare(r.soloKm, p);
    const rawShare = round2(total * weight);
    let finalFare = Math.min(rawShare, solo);
    if (r.acceptedFare != null) finalFare = Math.min(finalFare, r.acceptedFare);
    finalFare = round2(finalFare);
    const savings = round2(solo - finalFare);
    return {
      id: r.id,
      soloFare: solo,
      rawShare,
      finalFare,
      savings,
      savingsPct: solo > 0 ? round2((savings / solo) * 100) : 0,
      distanceSharePct: round2(weight * 100),
      subsidy: round2(Math.max(0, rawShare - finalFare)),
    };
  });

  const collected = round2(out.reduce((s, r) => s + r.finalFare, 0));
  const platformSubsidy = round2(out.reduce((s, r) => s + r.subsidy, 0));
  return { routeKm: round2(routeKm), groupFare: total, collected, platformSubsidy, riders: out };
}

export interface DriverPayout {
  gross: number;
  commission: number;
  bonus: number;
  net: number;
}

/** Driver earns the full group fare minus commission, plus a bonus for a full cab. */
export function driverPayout(
  groupFareAmount: number,
  passengers: number,
  capacity: number,
  p: FareParams = DEFAULT_FARE_PARAMS,
): DriverPayout {
  const commission = round2(groupFareAmount * p.commissionPct);
  const bonus = passengers >= capacity ? round2(groupFareAmount * p.fullCabBonusPct) : 0;
  return {
    gross: round2(groupFareAmount),
    commission,
    bonus,
    net: round2(groupFareAmount - commission + bonus),
  };
}

/** CO₂ saved by pooling, using ~0.12 kg CO₂ per car-km for a petrol sedan. */
export function co2SavedKg(sumSoloKm: number, routeKm: number, kgPerKm = 0.12): number {
  return round2(Math.max(0, sumSoloKm - routeKm) * kgPerKm);
}
