import { formatINR, type GroupDto, type RideDto } from '@arriveshare/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Check, Lock, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, Card, Rating } from '@/components/ui/primitives';
import { mmss, useCountdown } from '@/hooks/useCountdown';
import { api, errorMessage } from '@/lib/api';
import { vibrate } from '@/lib/utils';
import { useEffect } from 'react';

export function CoRiders({ group }: { group: GroupDto }) {
  return (
    <ul className="space-y-2">
      {group.members.map((m) => (
        <li key={m.rideId} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-white/5">
          <Avatar name={m.isMe ? 'You' : m.firstName} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              {m.firstName}
              {m.verified && <BadgeCheck className="h-4 w-4 text-sky-500" aria-label="Verified" />}
            </div>
            <div className="text-xs text-slate-500">
              {m.dropIndex != null ? `Drop #${m.dropIndex + 1}` : ''} {!m.isMe && <Rating value={m.ratingAvg} />}
            </div>
          </div>
          {m.accepted ? <Badge tone="green"><Check className="h-3 w-3" /> Accepted</Badge> : <Badge tone="amber">Deciding</Badge>}
        </li>
      ))}
    </ul>
  );
}

/** The match decision screen: who you're riding with, what you'll pay, and a countdown. */
export function MatchOffer({ ride, group }: { ride: RideDto; group: GroupDto }) {
  const qc = useQueryClient();
  const left = useCountdown(group.acceptExpiresAt);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ride', ride.id] });
    qc.invalidateQueries({ queryKey: ['group', ride.id] });
  };
  useEffect(() => vibrate([120, 60, 120]), []);

  const accept = useMutation({
    mutationFn: () => api.post(`/rides/${ride.id}/accept`),
    onSuccess: () => {
      refresh();
      toast.success('Fare locked 🔒');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const decline = useMutation({
    mutationFn: () => api.post(`/rides/${ride.id}/decline`),
    onSuccess: () => {
      refresh();
      toast('Back in the pool — we’ll find you another group');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const fare = ride.acceptedFare ?? ride.quotedFare ?? ride.soloFare;
  const saving = ride.soloFare - fare;
  const accepted = ride.status === 'confirmed';
  const others = group.members.filter((m) => !m.isMe).length;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Match found</div>
            <h2 className="mt-1 text-xl font-extrabold">
              Sharing with {others} co-rider{others === 1 ? '' : 's'}
            </h2>
            {group.womenOnly && (
              <Badge tone="pink" className="mt-2">
                <ShieldCheck className="h-3 w-3" /> Women-only cab
              </Badge>
            )}
          </div>
          {!accepted && group.acceptExpiresAt && (
            <div className="text-right">
              <div className="text-xs text-slate-500">Expires in</div>
              <div className={`text-2xl font-extrabold tabular-nums ${left < 30 ? 'text-red-600' : ''}`}>{mmss(left)}</div>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
            <div className="text-xs text-slate-500">Solo</div>
            <div className="font-bold text-slate-400 line-through">{formatINR(ride.soloFare)}</div>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
            <div className="text-xs text-emerald-700 dark:text-emerald-300">You pay</div>
            <div className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300">{formatINR(fare)}</div>
          </div>
          <div className="rounded-xl bg-brand-50 p-3 dark:bg-brand-500/10">
            <div className="text-xs text-brand-700 dark:text-brand-300">You save</div>
            <div className="font-bold text-brand-700 dark:text-brand-300">{formatINR(saving)}</div>
          </div>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Price guarantee: once you accept, your fare can only go down — even if someone drops out.
        </p>
      </Card>

      <Card className="p-5">
        <div className="mb-3 text-sm font-bold">Your cab</div>
        <CoRiders group={group} />
        <p className="mt-3 text-xs text-slate-500">
          Route {group.routeKm.toFixed(1)} km · co-riders see only your first name and drop order.
        </p>
      </Card>

      {accepted ? (
        <Card className="p-4 text-center text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          ✅ You accepted. Waiting for {group.members.filter((m) => !m.accepted).length} co-rider(s)…
        </Card>
      ) : (
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Button size="lg" variant="secondary" icon={<X className="h-5 w-5" />} loading={decline.isPending} onClick={() => decline.mutate()}>
            Decline
          </Button>
          <Button size="lg" variant="success" icon={<Check className="h-5 w-5" />} loading={accept.isPending} onClick={() => accept.mutate()}>
            Accept · {formatINR(fare)}
          </Button>
        </div>
      )}
    </div>
  );
}
