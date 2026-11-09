import { formatINR } from '@arriveshare/shared';
import { Gift, Users, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Card, EmptyState, PageLoader, SectionTitle, Stat } from '@/components/ui/primitives';
import { useEarnings } from '@/hooks/queries';
import { fmtDate, fmtDateTime } from '@/lib/utils';

/** Single-series bar chart: one brand hue, thin rounded bars, per-bar hover tooltip, table fallback below. */
function DailyBars({ data }: { data: { date: string; net: number; trips: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.net));
  const h = 160;
  return (
    <div className="relative">
      <div className="flex h-[180px] items-end gap-[2px] border-b border-slate-200 dark:border-white/10" role="img" aria-label="Net earnings per day, last 14 days">
        {data.map((d, i) => (
          <div
            key={d.date}
            className="relative flex h-full flex-1 cursor-default items-end justify-center"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onTouchStart={() => setHover(i)}
          >
            <div
              className="w-full max-w-6 rounded-t bg-brand-600 transition-opacity dark:bg-brand-400"
              style={{ height: d.net > 0 ? Math.max(4, (d.net / max) * h) : 0, opacity: hover == null || hover === i ? 1 : 0.45 }}
            />
            {hover === i && (
              <div className="absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-white dark:text-slate-900">
                <div className="font-semibold">{fmtDate(d.date)}</div>
                {formatINR(d.net)} · {d.trips} trip{d.trips === 1 ? '' : 's'}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
        <span>{fmtDate(data[0]!.date)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

export default function Earnings() {
  const { data, isLoading } = useEarnings();
  if (isLoading || !data) return <PageLoader />;
  const s = data.summary;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold">Earnings</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today" value={formatINR(s.today.net)} hint={`${s.today.trips} trips`} icon={<Wallet className="h-4 w-4 text-emerald-600" />} />
        <Stat label="7 days" value={formatINR(s.week.net)} hint={`${s.week.trips} trips`} />
        <Stat label="Riders carried" value={s.lifetime.passengers} icon={<Users className="h-4 w-4 text-brand-600" />} hint="lifetime" />
        <Stat label="Full-cab bonus" value={formatINR(s.lifetime.bonus)} icon={<Gift className="h-4 w-4 text-safe-600" />} hint="lifetime" />
      </div>

      <Card className="p-5">
        <div className="mb-4">
          <div className="font-bold">Net earnings per day</div>
          <div className="text-xs text-slate-500">Last 14 days, after commission</div>
        </div>
        <DailyBars data={s.daily} />
      </Card>

      <section>
        <SectionTitle>Recent trips</SectionTitle>
        {data.trips.length === 0 ? (
          <EmptyState icon={<Wallet />} title="No completed trips yet" body="Go online near a hub to start receiving pooled trips." />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-4 font-semibold">When</th>
                  <th className="p-4 font-semibold">From</th>
                  <th className="p-4 text-right font-semibold">Distance</th>
                  <th className="p-4 text-right font-semibold">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {data.trips.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap p-4">{fmtDateTime(t.completedAt)}</td>
                    <td className="p-4">{t.station}</td>
                    <td className="p-4 text-right tabular-nums">{t.routeKm.toFixed(1)} km</td>
                    <td className="p-4 text-right font-semibold tabular-nums">
                      {formatINR(t.net)}
                      {t.bonus ? <span className="ml-1 text-xs text-safe-600">+bonus</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
