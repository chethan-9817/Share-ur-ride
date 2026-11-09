import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Toggle({
  checked,
  onChange,
  label,
  description,
  icon,
  disabled,
  tone = 'brand',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  tone?: 'brand' | 'safe';
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 py-2', disabled && 'cursor-not-allowed opacity-50')}>
      {icon && <div className="mt-0.5 text-slate-500">{icon}</div>}
      <div className="flex-1">
        <div className="text-sm font-semibold">{label}</div>
        {description && <div className="text-xs text-slate-500">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition',
          checked ? (tone === 'safe' ? 'bg-safe-600' : 'bg-brand-600') : 'bg-slate-300 dark:bg-white/15',
        )}
      >
        <span className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-1 rounded-xl bg-slate-100 p-1 dark:bg-ink-800" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'h-10 rounded-lg text-sm font-semibold transition',
            o.value === value ? 'bg-white text-brand-700 shadow-sm dark:bg-ink-700 dark:text-white' : 'text-slate-500',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <button type="button" className="h-9 w-9 rounded-full bg-slate-100 text-lg font-bold disabled:opacity-40 dark:bg-white/10" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Fewer ${label}`}>
          −
        </button>
        <span className="w-4 text-center font-bold tabular-nums">{value}</span>
        <button type="button" className="h-9 w-9 rounded-full bg-slate-100 text-lg font-bold disabled:opacity-40 dark:bg-white/10" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`More ${label}`}>
          +
        </button>
      </div>
    </div>
  );
}
