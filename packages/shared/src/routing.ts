/**
 * Exact multi-drop route optimiser.
 *
 * Every group starts at the same hub (index 0) and drops k ≤ 4 riders, so we can afford
 * to evaluate all k! drop orders (24 at most) and pick the shortest one that respects
 * every rider's individual detour budget:
 *
 *   detour(i) = cumulativeKmToDrop(i) − soloKm(i)
 *   allowed   ⇔ detour(i) ≤ min(soloKm(i) × maxDetourPct, maxDetourKm)
 */

export interface DetourLimits {
  maxDetourPct: number;
  maxDetourKm: number;
}

export const DEFAULT_DETOUR_LIMITS: DetourLimits = { maxDetourPct: 0.3, maxDetourKm: 6 };

/** matrix[a][b] = road km from node a to node b; node 0 is the hub. */
export type DistanceMatrix = number[][];

export interface DropPlan {
  /** Destination indices (1-based into the matrix) in drop order. */
  order: number[];
  totalKm: number;
  /** Cumulative km at which each destination (by matrix index) is reached. */
  cumulativeKm: Record<number, number>;
  /** Detour km for each destination (by matrix index). */
  detourKm: Record<number, number>;
}

export function detourBudgetKm(soloKm: number, limits: DetourLimits = DEFAULT_DETOUR_LIMITS) {
  return Math.min(soloKm * limits.maxDetourPct, limits.maxDetourKm);
}

/** Heap's algorithm — yields every permutation of `items`. */
export function* permutations<T>(items: readonly T[]): Generator<T[]> {
  const a = items.slice();
  const n = a.length;
  const c = new Array<number>(n).fill(0);
  yield a.slice();
  let i = 0;
  while (i < n) {
    if (c[i]! < i) {
      const j = i % 2 === 0 ? 0 : c[i]!;
      [a[j], a[i]] = [a[i]!, a[j]!];
      yield a.slice();
      c[i]! += 1;
      i = 0;
    } else {
      c[i] = 0;
      i += 1;
    }
  }
}

export function evaluateOrder(order: number[], m: DistanceMatrix): DropPlan {
  let prev = 0;
  let acc = 0;
  const cumulativeKm: Record<number, number> = {};
  const detourKm: Record<number, number> = {};
  for (const node of order) {
    acc += m[prev]![node]!;
    cumulativeKm[node] = acc;
    detourKm[node] = acc - m[0]![node]!;
    prev = node;
  }
  return { order, totalKm: acc, cumulativeKm, detourKm };
}

/**
 * Finds the shortest drop order where nobody exceeds their detour budget.
 * Returns null when no feasible order exists.
 */
export function solveDropOrder(
  m: DistanceMatrix,
  limits: DetourLimits = DEFAULT_DETOUR_LIMITS,
): DropPlan | null {
  const k = m.length - 1;
  if (k <= 0) return { order: [], totalKm: 0, cumulativeKm: {}, detourKm: {} };
  if (k > 6) throw new Error('solveDropOrder supports at most 6 drops');
  const nodes = Array.from({ length: k }, (_, i) => i + 1);
  let best: DropPlan | null = null;
  for (const order of permutations(nodes)) {
    const plan = evaluateOrder(order, m);
    if (best && plan.totalKm >= best.totalKm) continue;
    const feasible = order.every(
      (n) => plan.detourKm[n]! <= detourBudgetKm(m[0]![n]!, limits) + 1e-9,
    );
    if (feasible) best = plan;
  }
  return best;
}

/** Builds a symmetric distance matrix from points using the given metric. */
export function buildMatrix<P>(points: P[], dist: (a: P, b: P) => number): DistanceMatrix {
  return points.map((a, i) => points.map((b, j) => (i === j ? 0 : dist(a, b))));
}
