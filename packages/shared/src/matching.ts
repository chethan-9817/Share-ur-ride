import { bearingDeg, bearingDelta, roadEstimateKm, type LatLng } from './geo';
import {
  buildMatrix,
  DEFAULT_DETOUR_LIMITS,
  solveDropOrder,
  type DetourLimits,
  type DropPlan,
} from './routing';
import type { Gender } from './constants';

/**
 * Spatio-temporal pooling.
 *
 * Riders at the same hub are clustered greedily, seeded by earliest arrival.
 * A candidate can join a forming group only if:
 *  1. arrival windows overlap with every member      (time)
 *  2. seats and luggage still fit in the cab          (capacity)
 *  3. women-only preferences are satisfied both ways  (safety)
 *  4. an exact drop order exists that keeps every
 *     rider inside their detour budget                (fairness)
 */

export interface MatchCandidate {
  id: string;
  hub: LatLng;
  hubId: string;
  dest: LatLng;
  arrivalAt: number; // epoch ms
  toleranceMin: number;
  seats: number;
  luggage: number;
  gender: Gender;
  womenOnly: boolean;
}

export interface MatchParams {
  seatCapacity: number;
  luggageCapacity: number;
  minGroupSize: number;
  limits: DetourLimits;
  /** Candidates heading in wildly different directions are skipped early. */
  maxBearingDeltaDeg: number;
  distance: (a: LatLng, b: LatLng) => number;
}

export const DEFAULT_MATCH_PARAMS: MatchParams = {
  seatCapacity: 4,
  luggageCapacity: 4,
  minGroupSize: 2,
  limits: DEFAULT_DETOUR_LIMITS,
  maxBearingDeltaDeg: 75,
  distance: roadEstimateKm,
};

export interface FormedGroup {
  hubId: string;
  memberIds: string[];
  /** Member ids in drop order. */
  dropOrder: string[];
  plan: DropPlan;
  soloKm: Record<string, number>;
  pickupAt: number;
}

export function timeCompatible(a: MatchCandidate, b: MatchCandidate): boolean {
  const window = Math.min(a.toleranceMin, b.toleranceMin) * 60_000;
  return Math.abs(a.arrivalAt - b.arrivalAt) <= window;
}

export function genderCompatible(members: MatchCandidate[], c: MatchCandidate): boolean {
  const all = [...members, c];
  const anyWomenOnly = all.some((m) => m.womenOnly);
  return !anyWomenOnly || all.every((m) => m.gender === 'female');
}

export function capacityFits(members: MatchCandidate[], c: MatchCandidate, p: MatchParams) {
  const seats = members.reduce((s, m) => s + m.seats, 0) + c.seats;
  const bags = members.reduce((s, m) => s + m.luggage, 0) + c.luggage;
  return seats <= p.seatCapacity && bags <= p.luggageCapacity;
}

/** Plans the route for a set of riders sharing a hub; null if any detour budget is broken. */
export function planGroup(members: MatchCandidate[], p: MatchParams = DEFAULT_MATCH_PARAMS) {
  const hub = members[0]!.hub;
  const points = [hub, ...members.map((m) => m.dest)];
  const matrix = buildMatrix(points, p.distance);
  const plan = solveDropOrder(matrix, p.limits);
  if (!plan) return null;
  const soloKm: Record<string, number> = {};
  members.forEach((m, i) => (soloKm[m.id] = matrix[0]![i + 1]!));
  return {
    plan,
    soloKm,
    dropOrder: plan.order.map((idx) => members[idx - 1]!.id),
  };
}

/** Can `c` join the existing `members`? Returns the new plan if so. */
export function tryJoin(
  members: MatchCandidate[],
  c: MatchCandidate,
  p: MatchParams = DEFAULT_MATCH_PARAMS,
) {
  if (members.length === 0) return planGroup([c], p);
  if (members.some((m) => m.hubId !== c.hubId)) return null;
  if (!members.every((m) => timeCompatible(m, c))) return null;
  if (!capacityFits(members, c, p)) return null;
  if (!genderCompatible(members, c)) return null;
  return planGroup([...members, c], p);
}

/** Greedy clustering of a pending pool into feasible groups. */
export function formGroups(
  pool: MatchCandidate[],
  p: MatchParams = DEFAULT_MATCH_PARAMS,
): FormedGroup[] {
  const byHub = new Map<string, MatchCandidate[]>();
  for (const c of pool) {
    const list = byHub.get(c.hubId) ?? [];
    list.push(c);
    byHub.set(c.hubId, list);
  }

  const groups: FormedGroup[] = [];
  for (const [hubId, riders] of byHub) {
    const sorted = [...riders].sort((a, b) => a.arrivalAt - b.arrivalAt);
    const used = new Set<string>();

    for (const seed of sorted) {
      if (used.has(seed.id)) continue;
      const seedBearing = bearingDeg(seed.hub, seed.dest);
      const members: MatchCandidate[] = [seed];

      // Rank remaining riders: most similar direction first, then closest arrival time.
      const ranked = sorted
        .filter((c) => c.id !== seed.id && !used.has(c.id))
        .map((c) => ({
          c,
          dir: bearingDelta(seedBearing, bearingDeg(c.hub, c.dest)),
          dt: Math.abs(c.arrivalAt - seed.arrivalAt),
        }))
        .filter((x) => x.dir <= p.maxBearingDeltaDeg)
        .sort((a, b) => a.dir - b.dir || a.dt - b.dt);

      let planned = planGroup(members, p);
      for (const { c } of ranked) {
        const seatsUsed = members.reduce((s, m) => s + m.seats, 0);
        if (seatsUsed >= p.seatCapacity) break;
        const next = tryJoin(members, c, p);
        if (next) {
          members.push(c);
          planned = next;
        }
      }

      if (members.length >= p.minGroupSize && planned) {
        members.forEach((m) => used.add(m.id));
        groups.push({
          hubId,
          memberIds: members.map((m) => m.id),
          dropOrder: planned.dropOrder,
          plan: planned.plan,
          soloKm: planned.soloKm,
          pickupAt: Math.max(...members.map((m) => m.arrivalAt)),
        });
      }
    }
  }
  return groups;
}
