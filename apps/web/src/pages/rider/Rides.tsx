import { formatINR } from '@arriveshare/shared';
import { History } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, PageLoader } from '@/components/ui/primitives';
import { RideStatusBadge } from '@/components/ui/StatusBadge';
import { Segmented } from '@/components/ui/Toggle';
import { useRides } from '@/hooks/queries';
import { fmtDateTime } from '@/lib/utils';

export default function Rides() {
  const [scope, setScope] = useState<'active' | 'history'>('history');
  const { data = [], isLoading } = useRides(scope);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Your rides</h1>
      <div className="max-w-xs">
        <Segmented value={scope} onChange={setScope} options={[{ value: 'active', label: 'Active' }, { value: 'history', label: 'Past' }]} />
      </div>
      {isLoading ? (
        <PageLoader />
      ) : data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={scope === 'active' ? 'No active rides' : 'No past rides yet'}
          action={
            <Link to="/book">
              <Button>Book a ride</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((r) => (
            <Link key={r.id} to={`/rides/${r.id}`}>
              <Card className="h-full p-4 transition hover:border-brand-300">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-bold">{r.destinationLabel.split(',')[0]}</div>
                    <div className="text-xs text-slate-500">
                      from {r.station.name} · {fmtDateTime(r.arrivalAt)}
                    </div>
                  </div>
                  <RideStatusBadge status={r.status} />
                </div>
                <div className="mt-3 flex items-center gap-2 text-sm">
                  <span className="font-extrabold">{formatINR(r.finalFare ?? r.acceptedFare ?? r.quotedFare ?? r.soloFare)}</span>
                  {r.savings != null && r.savings > 0 && <Badge tone="green">saved {formatINR(r.savings)}</Badge>}
                  {r.womenOnly && <Badge tone="pink">Women-only</Badge>}
                  {r.status === 'completed' && !r.rated && <Badge tone="amber">Rate ride</Badge>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
