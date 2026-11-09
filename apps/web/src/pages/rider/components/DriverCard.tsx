import type { DriverPublicDto } from '@arriveshare/shared';
import { BadgeCheck, Phone } from 'lucide-react';
import { Avatar, Badge, Card, Rating } from '@/components/ui/primitives';

/** Big, glanceable plate number: the #1 thing to check before getting in. */
export function DriverCard({ driver, pin }: { driver: DriverPublicDto; pin?: string | null }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <Avatar name={driver.name} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-lg font-bold">
            {driver.name}
            {driver.verified && <BadgeCheck className="h-5 w-5 text-sky-500" aria-label="Verified driver" />}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Rating value={driver.ratingAvg} count={driver.ratingCount} />
            {driver.gender === 'female' && <Badge tone="pink">Female driver</Badge>}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-slate-900 p-4 text-white dark:bg-black">
        <div>
          <div className="text-xs uppercase tracking-wide text-white/60">
            {driver.vehicle.color} {driver.vehicle.model}
          </div>
          <div className="mt-1 rounded-md bg-yellow-300 px-2 py-1 font-mono text-xl font-extrabold tracking-widest text-black">{driver.vehicle.number}</div>
        </div>
        {pin && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-white/60">Your PIN</div>
            <div className="font-mono text-3xl font-extrabold tracking-[0.3em]">{pin}</div>
          </div>
        )}
      </div>
      {pin && <p className="mt-3 text-xs text-slate-500">Check the plate first. Then tell the driver your PIN — never share it on a call or before you see the cab.</p>}
      <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
        <Phone className="h-3 w-3" /> Driver’s number is masked ({driver.phoneMasked}) — your number is never shown to them either.
      </p>
    </Card>
  );
}
