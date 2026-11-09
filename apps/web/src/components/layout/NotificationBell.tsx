import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState } from '@/components/ui/primitives';
import { qk, useNotifications } from '@/hooks/queries';
import { useSocketEvent } from '@/hooks/useSocket';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import type { NotificationDto } from '@arriveshare/shared';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data = [] } = useNotifications();
  const qc = useQueryClient();
  const nav = useNavigate();
  const unread = data.filter((n) => !n.read).length;

  // Live toast for each new notification.
  useSocketEvent<NotificationDto>('notification', (n) => {
    toast(n.title, {
      description: n.body,
      action: n.link ? { label: 'Open', onClick: () => nav(n.link!) } : undefined,
    });
  });

  const readAll = useMutation({
    mutationFn: () => api.post('/me/notifications/read'),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          if (unread) readAll.mutate();
        }}
        className="relative rounded-full p-2 hover:bg-slate-100 dark:hover:bg-white/10"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-safe-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Notifications">
        {data.length === 0 ? (
          <EmptyState icon={<Bell />} title="You're all caught up" />
        ) : (
          <ul className="-mx-2 divide-y divide-slate-100 dark:divide-white/5">
            {data.map((n) => (
              <li key={n.id}>
                <button
                  className={cn('w-full rounded-xl px-2 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/5', !n.read && 'bg-brand-50/60 dark:bg-brand-500/5')}
                  onClick={() => {
                    if (n.link) nav(n.link);
                    setOpen(false);
                  }}
                >
                  <div className="flex justify-between gap-2 text-sm font-semibold">
                    {n.title}
                    <span className="shrink-0 text-xs font-normal text-slate-400">{timeAgo(n.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{n.body}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </>
  );
}
