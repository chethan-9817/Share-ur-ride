import type { GroupStatus, RideStatus } from '@arriveshare/shared';
import { Badge } from './primitives';

const ride: Record<RideStatus, { label: string; tone: Parameters<typeof Badge>[0]['tone'] }> = {
  pending: { label: 'Finding co-riders', tone: 'amber' },
  matched: { label: 'Match found', tone: 'brand' },
  confirmed: { label: 'Confirmed', tone: 'blue' },
  picked_up: { label: 'On trip', tone: 'green' },
  completed: { label: 'Completed', tone: 'slate' },
  cancelled: { label: 'Cancelled', tone: 'red' },
  no_show: { label: 'No-show', tone: 'red' },
  expired: { label: 'Expired', tone: 'slate' },
};

const group: Record<GroupStatus, string> = {
  accepting: 'Waiting for co-riders to accept',
  dispatching: 'Assigning a verified driver',
  assigned: 'Driver on the way',
  arrived: 'Driver at pickup',
  on_trip: 'On the way',
  completed: 'Trip completed',
  cancelled: 'Cancelled',
};

export function RideStatusBadge({ status }: { status: RideStatus }) {
  const s = ride[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const groupStatusLabel = (s: GroupStatus) => group[s];
