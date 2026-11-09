import { formatINR, type LatLng } from '@arriveshare/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { LiveMap, type MapStop } from '@/components/map/LiveMap';
import { SafetyToolkit } from '@/components/safety/SafetyToolkit';
import { SosButton } from '@/components/safety/SosButton';
import { Button } from '@/components/ui/Button';
import { Card, PageLoader } from '@/components/ui/primitives';
import { groupStatusLabel, RideStatusBadge } from '@/components/ui/StatusBadge';
import { useGroup, useRide } from '@/hooks/queries';
import { useRoom, useSocketEvent } from '@/hooks/useSocket';
import { api, errorMessage } from '@/lib/api';
import { fmtDateTime } from '@/lib/utils';
import { DriverCard } from './components/DriverCard';
import { MatchingRadar } from './components/MatchingRadar';
import { CoRiders, MatchOffer } from './components/MatchOffer';
import { RateRide } from './components/RateRide';

type DriverPos = LatLng & { heading: number | null; at: string };

export default function RideDetail() {
  const { id } = useParams();
  const { data: ride, isLoading } = useRide(id);
  const inGroup = !!ride?.groupId;
  const { data: group } = useGroup(id, inGroup);
  const [pos, setPos] = useState<DriverPos | null>(null);
  const [toolkit, setToolkit] = useState(false);
  const qc = useQueryClient();

  useRoom('group', group?.id);
  useSocketEvent<DriverPos & { groupId: string }>('driver:location', (p) => {
    if (p.groupId === group?.id) setPos(p);
  });
  useEffect(() => setPos(null), [group?.id]);

  const driverPos = pos ?? (group?.driver?.location ? { ...group.driver.location, at: group.driver.location.updatedAt } : null);

  const stops: MapStop[] = useMemo(
    () =>
      (group?.members ?? [])
        .filter((m) => m.destination)
        .map((m) => ({ ...m.destination!, index: m.dropIndex ?? 0, mine: m.isMe, label: m.isMe ? 'Your drop' : undefined, done: m.status === 'completed' })),
    [group],
  );

  const cancel = useMutation({
    mutationFn: () => api.post(`/rides/${id}/cancel`, { reason: 'Rider cancelled' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ride', id] });
      toast('Ride cancelled');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading || !ride) return <PageLoader />;

  const gs = group?.status;
  const showMatch = ride.status === 'matched' || (ride.status === 'confirmed' && gs === 'accepting');
  const tracking = gs === 'assigned' || gs === 'arrived' || gs === 'on_trip';
  const onTrip = ride.status === 'picked_up';
  const finished = ['completed', 'cancelled', 'no_show', 'expired'].includes(ride.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/rides" className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-extrabold sm:text-xl">
            {ride.station.code} → {ride.destinationLabel.split(',')[0]}
          </h1>
          <div className="text-xs text-slate-500">
            {fmtDateTime(ride.arrivalAt)} {ride.flightOrTrain && `· ${ride.flightOrTrain}`}
          </div>
        </div>
        <RideStatusBadge status={ride.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          {(tracking || showMatch || finished) && group && (
            <div className="relative lg:sticky lg:top-20">
              <LiveMap
                hub={ride.station}
                hubType={ride.station.type}
                hubLabel={ride.station.name}
                route={group.route}
                stops={stops}
                driver={tracking ? driverPos : null}
                follow={onTrip}
                className="h-[48vh] sm:h-[460px] lg:h-[calc(100vh-11rem)]"
              />
              {tracking && (
                <div className="absolute left-3 top-3 z-[500] rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold shadow dark:bg-ink-900/95">
                  {gs && groupStatusLabel(gs)}
                </div>
              )}
            </div>
          )}
          {ride.status === 'pending' && (
            <LiveMap hub={ride.station} hubType={ride.station.type} hubLabel={ride.station.name} destination={ride.destination} className="h-56 sm:h-72" />
          )}
          {ride.status === 'pending' && <MatchingRadar ride={ride} />}
          {showMatch && group && <MatchOffer ride={ride} group={group} />}
          {ride.status === 'confirmed' && gs === 'dispatching' && (
            <Card className="flex items-center gap-4 p-5">
              <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
              <div>
                <div className="font-bold">Everyone accepted — assigning a verified driver</div>
                <div className="text-sm text-slate-500">
                  {group?.womenOnly || ride.preferFemaleDriver ? 'Offering to female drivers first. ' : ''}Your fare of {formatINR(ride.acceptedFare)} is locked.
                </div>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {tracking && group?.driver && <DriverCard driver={group.driver} pin={ride.status === 'confirmed' ? ride.pickupPin : null} />}

          {(tracking || onTrip) && (
            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <ShieldCheck className="h-4 w-4 text-safe-600" /> Safety
                </div>
                <button onClick={() => setToolkit(true)} className="text-sm font-semibold text-brand-600">
                  Toolkit
                </button>
              </div>
              <SosButton rideId={ride.id} />
              {group?.shareToken && <p className="text-xs text-emerald-600">● Live trip is being shared with your trusted contacts</p>}
            </Card>
          )}

          {group && (tracking || finished) && group.members.length > 1 && (
            <Card className="p-4">
              <div className="mb-3 text-sm font-bold">Co-riders</div>
              <CoRiders group={group} />
            </Card>
          )}

          {ride.status === 'completed' && (
            <>
              <Card className="p-5 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
                <div className="mt-2 text-lg font-extrabold">You’ve arrived</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                    <div className="text-xs text-slate-500">Paid</div>
                    <div className="text-xl font-extrabold">{formatINR(ride.finalFare)}</div>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
                    <div className="text-xs text-emerald-700 dark:text-emerald-300">Saved</div>
                    <div className="text-xl font-extrabold text-emerald-700 dark:text-emerald-300">{formatINR(ride.savings)}</div>
                  </div>
                </div>
              </Card>
              {!ride.rated && <RateRide rideId={ride.id} who={group?.driver?.name.split(' ')[0]} />}
            </>
          )}

          {['cancelled', 'no_show', 'expired'].includes(ride.status) && (
            <Card className="p-5 text-center">
              <XCircle className="mx-auto h-10 w-10 text-slate-400" />
              <div className="mt-2 font-bold">
                {ride.status === 'cancelled' ? 'Ride cancelled' : ride.status === 'no_show' ? 'Marked as no-show' : 'Request expired'}
              </div>
              <Link to="/book">
                <Button className="mt-4">Book again</Button>
              </Link>
            </Card>
          )}

          {['pending', 'matched', 'confirmed'].includes(ride.status) && !tracking && ride.status !== 'pending' && (
            <Button variant="ghost" block loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel ride
            </Button>
          )}
          {ride.status === 'confirmed' && tracking && gs !== 'on_trip' && (
            <Button variant="ghost" block loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel ride
            </Button>
          )}
        </div>
      </div>
      <SafetyToolkit rideId={ride.id} open={toolkit} onClose={() => setToolkit(false)} />
    </div>
  );
}
