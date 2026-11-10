import type { UserDto } from '@arriveshare/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, Card, PageHeader, Rating } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/utils';

type AdminUser = UserDto & { suspended: boolean };

export default function AdminUsers() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['admin', 'users', dq], queryFn: () => api.get<AdminUser[]>(`/admin/users?q=${encodeURIComponent(dq)}`) });
  const suspend = useMutation({
    mutationFn: (u: AdminUser) => api.patch(`/admin/users/${u.id}`, { suspended: !u.suspended }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success('User updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-6">
      <PageHeader icon={<Users className="h-6 w-6" />} title="Users" subtitle="Search riders and drivers, suspend accounts if needed." />
      <div className="relative max-w-md">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input className="input pl-12" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card className="divide-y divide-slate-100 dark:divide-white/5">
        {data.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 p-4">
            <Avatar name={u.name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{u.name}</div>
              <div className="truncate text-xs text-slate-500">
                {u.email} · joined {fmtDate(u.createdAt)}
              </div>
            </div>
            <Badge tone="brand" className="capitalize">{u.role}</Badge>
            <Rating value={u.ratingAvg} count={u.ratingCount} />
            {u.suspended && <Badge tone="red">Suspended</Badge>}
            {u.role !== 'admin' && (
              <Button size="sm" variant={u.suspended ? 'secondary' : 'ghost'} onClick={() => suspend.mutate(u)}>
                {u.suspended ? 'Reinstate' : 'Suspend'}
              </Button>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
