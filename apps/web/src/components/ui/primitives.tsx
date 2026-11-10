import { initials } from '@arriveshare/shared';
import { Loader2, Star } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card', className)} {...rest} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-brand-600', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

type Tone = 'slate' | 'brand' | 'green' | 'amber' | 'red' | 'pink' | 'blue';
const tones: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-300',
  brand: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  pink: 'bg-safe-100 text-safe-700 dark:bg-safe-500/15 dark:text-safe-400',
  blue: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
};

export function Badge({ tone = 'slate', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cn('chip', tones[tone], className)}>{children}</span>;
}

export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  // Deterministic hue from the name so the same person always gets the same colour.
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <div
      className={cn('flex shrink-0 items-center justify-center rounded-full font-bold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 65% 52%)` }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

export function Rating({ value, count }: { value: number | null; count?: number }) {
  if (value == null) return <span className="text-xs text-slate-500">New</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
      <Star className="h-3.5 w-3.5 fill-current" />
      {value.toFixed(1)}
      {count != null && <span className="font-normal text-slate-500">({count})</span>}
    </span>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="p-4 transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        {icon && <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-safe-50 ring-1 ring-indigo-100">{icon}</div>}
      </div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

/**
 * The one dashboard layout shared by the rider, driver and ops screens:
 *   DashboardHero → StatGrid (4 cards) → two-column main area (MAIN_GRID) with a MapCard on the left.
 */
export const MAIN_GRID = 'grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_400px]';

export function DashboardHero({
  eyebrow,
  title,
  chips = [],
  action,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  chips?: ReactNode[];
  action?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-indigo-500 to-safe-500 p-6 text-white shadow-xl shadow-brand-600/25 sm:p-8">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-sky-300/30 blur-3xl" />
      <div className="relative grid items-center gap-6 md:grid-cols-[1fr_auto]">
        <div>
          {eyebrow && <p className="text-sm font-semibold text-white/80">{eyebrow}</p>}
          <h1 className="mt-1 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{title}</h1>
          {chips.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
              {chips.map((c, i) => (
                <span key={i} className="rounded-full bg-white/15 px-3 py-1 ring-1 ring-white/25 backdrop-blur">
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
        {action}
      </div>
    </section>
  );
}

/** Always four cards across on laptops, two on phones. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/** A map in a card, with an optional legend underneath. Same size everywhere. */
export function MapCard({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <Card className="p-3">
      {children}
      {footer && <div className="flex flex-wrap gap-4 px-2 pt-3 text-xs text-slate-500">{footer}</div>}
    </Card>
  );
}

/** Same height for every dashboard map. */
export const DASH_MAP = 'h-[46vh] sm:h-[480px]';

/** Consistent page header: tinted icon tile, title and subtitle, optional action. */
export function PageHeader({ icon, title, subtitle, action }: { icon?: ReactNode; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-safe-500 text-white shadow-lg shadow-brand-600/25">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10">{icon}</div>
      <div className="text-base font-semibold">{title}</div>
      {body && <p className="max-w-sm text-sm text-slate-500">{body}</p>}
      {action}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{children}</h2>
      {action}
    </div>
  );
}
