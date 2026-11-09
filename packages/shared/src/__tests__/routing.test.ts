import { describe, expect, it } from 'vitest';
import { detourBudgetKm, evaluateOrder, permutations, solveDropOrder } from '../routing';

describe('permutations', () => {
  it('yields n! unique orders', () => {
    const all = [...permutations([1, 2, 3, 4])].map((p) => p.join(''));
    expect(all).toHaveLength(24);
    expect(new Set(all).size).toBe(24);
  });
});

describe('solveDropOrder', () => {
  // Hub 0, A at 10 km, B at 12 km just beyond A, C off in another direction.
  const m = [
    [0, 10, 12, 10],
    [10, 0, 2, 18],
    [12, 2, 0, 19],
    [10, 18, 19, 0],
  ];

  it('picks the shortest feasible order for a corridor', () => {
    const sub = [
      [0, 10, 12],
      [10, 0, 2],
      [12, 2, 0],
    ];
    const plan = solveDropOrder(sub, { maxDetourPct: 0.3, maxDetourKm: 6 })!;
    expect(plan.order).toEqual([1, 2]);
    expect(plan.totalKm).toBe(12);
    expect(plan.detourKm[2]).toBe(0);
  });

  it('rejects groups where any rider would exceed their detour budget', () => {
    expect(solveDropOrder(m, { maxDetourPct: 0.3, maxDetourKm: 6 })).toBeNull();
  });

  it('enforces the absolute km cap even when the percentage would allow it', () => {
    expect(detourBudgetKm(100, { maxDetourPct: 0.3, maxDetourKm: 6 })).toBe(6);
    expect(detourBudgetKm(10, { maxDetourPct: 0.3, maxDetourKm: 6 })).toBe(3);
  });

  it('evaluates cumulative distance and detour per drop', () => {
    const plan = evaluateOrder([2, 1], m);
    expect(plan.totalKm).toBe(14);
    expect(plan.detourKm[1]).toBe(4);
  });

  it('handles an empty group', () => {
    expect(solveDropOrder([[0]])!.order).toEqual([]);
  });
});
