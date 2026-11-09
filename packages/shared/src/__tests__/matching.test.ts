import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_PARAMS, formGroups, tryJoin, type MatchCandidate } from '../matching';

const HUB = { lat: 13.1986, lng: 77.7066 }; // BLR airport
const T0 = Date.parse('2026-11-09T22:00:00Z');

const rider = (id: string, dest: { lat: number; lng: number }, over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id,
  hub: HUB,
  hubId: 'blr',
  dest,
  arrivalAt: T0,
  toleranceMin: 20,
  seats: 1,
  luggage: 1,
  gender: 'female',
  womenOnly: false,
  ...over,
});

// Neighbourhoods south of the airport along the same corridor.
const HEBBAL = { lat: 13.0358, lng: 77.597 };
const MALLESWARAM = { lat: 13.0035, lng: 77.5709 };
const INDIRANAGAR = { lat: 12.9719, lng: 77.6412 };
const KORAMANGALA = { lat: 12.9352, lng: 77.6245 };
const DEVANAHALLI = { lat: 13.2437, lng: 77.7172 }; // north — opposite direction

describe('formGroups', () => {
  it('pools riders heading along the same corridor', () => {
    const groups = formGroups([rider('a', HEBBAL), rider('b', MALLESWARAM)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.memberIds.sort()).toEqual(['a', 'b']);
    expect(groups[0]!.dropOrder[0]).toBe('a'); // Hebbal comes first
  });

  it('never exceeds seat capacity — 5 riders split into 4 + leftover', () => {
    const pool = [
      rider('a', INDIRANAGAR),
      rider('b', { lat: 12.975, lng: 77.64 }),
      rider('c', { lat: 12.968, lng: 77.645 }),
      rider('d', { lat: 12.97, lng: 77.638 }),
      rider('e', { lat: 12.973, lng: 77.643 }),
    ];
    const groups = formGroups(pool);
    expect(groups[0]!.memberIds).toHaveLength(4);
    const assigned = groups.flatMap((g) => g.memberIds);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('does not pool riders whose arrival windows do not overlap', () => {
    const groups = formGroups([
      rider('a', INDIRANAGAR),
      rider('b', INDIRANAGAR, { arrivalAt: T0 + 45 * 60_000 }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('does not pool riders going in opposite directions', () => {
    expect(formGroups([rider('a', KORAMANGALA), rider('b', DEVANAHALLI)])).toHaveLength(0);
  });

  it('respects women-only preference', () => {
    const groups = formGroups([
      rider('a', INDIRANAGAR, { womenOnly: true }),
      rider('b', INDIRANAGAR, { gender: 'male' }),
    ]);
    expect(groups).toHaveLength(0);
    const ok = formGroups([
      rider('a', INDIRANAGAR, { womenOnly: true }),
      rider('b', INDIRANAGAR, { gender: 'female' }),
    ]);
    expect(ok).toHaveLength(1);
  });

  it('respects luggage capacity', () => {
    const groups = formGroups(
      [rider('a', INDIRANAGAR, { luggage: 3 }), rider('b', INDIRANAGAR, { luggage: 3 })],
      DEFAULT_MATCH_PARAMS,
    );
    expect(groups).toHaveLength(0);
  });
});

describe('tryJoin', () => {
  it('lets a compatible late joiner into an existing group', () => {
    const plan = tryJoin([rider('a', INDIRANAGAR)], rider('b', { lat: 12.975, lng: 77.64 }));
    expect(plan).not.toBeNull();
  });

  it('rejects a joiner from another hub', () => {
    expect(tryJoin([rider('a', INDIRANAGAR)], rider('b', INDIRANAGAR, { hubId: 'sbc' }))).toBeNull();
  });
});
