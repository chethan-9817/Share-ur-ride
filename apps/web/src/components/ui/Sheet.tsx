import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/**
 * Responsive dialog: a bottom sheet on phones (thumb-reachable), a centred modal
 * on laptops. Closes on Escape and backdrop tap unless `persistent`.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  persistent,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  persistent?: boolean;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !persistent && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, persistent, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !persistent && onClose()} />
      <div
        className={cn(
          'relative max-h-[92vh] w-full animate-slide-up overflow-y-auto rounded-t-3xl bg-white p-5 pb-safe shadow-2xl dark:bg-ink-900 sm:max-w-md sm:rounded-3xl sm:pb-5',
          className,
        )}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-white/10 sm:hidden" />
        {(title || !persistent) && (
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="text-lg font-bold">{title}</div>
            {!persistent && (
              <button onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
