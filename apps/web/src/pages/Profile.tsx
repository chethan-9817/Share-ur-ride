import type { UserDto } from '@arriveshare/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Car, LogOut, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, Card, Rating } from '@/components/ui/primitives';
import { useTheme } from '@/hooks/useTheme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/store/auth';

export default function Profile() {
  const { user, setUser, clear } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone?.replace('+91', '') ?? '');
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () => api.patch<UserDto>('/me', { name, phone }),
    onSuccess: (u) => {
      setUser(u);
      toast.success('Profile updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!user) return null;
  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    clear();
    qc.clear();
    nav('/login');
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Card className="flex items-center gap-4 p-5">
        <Avatar name={user.name} size={64} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xl font-extrabold">{user.name}</div>
          <div className="truncate text-sm text-slate-500">{user.email}</div>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone="brand" className="capitalize">{user.role}</Badge>
            <Rating value={user.ratingAvg} count={user.ratingCount} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <label className="label" htmlFor="pname">Name</label>
          <input id="pname" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pphone">Mobile</label>
          <input id="pphone" className="input" inputMode="tel" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} />
        </div>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Save changes
        </Button>
      </Card>

      <Card className="divide-y divide-slate-100 dark:divide-white/5">
        <button onClick={toggle} className="flex w-full items-center gap-3 p-4 text-left text-sm font-semibold">
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        {user.role === 'rider' && (
          <Link to="/driver/onboard" className="flex items-center gap-3 p-4 text-sm font-semibold">
            <Car className="h-5 w-5" /> Become a driver partner
          </Link>
        )}
        <button onClick={logout} className="flex w-full items-center gap-3 p-4 text-left text-sm font-semibold text-red-600">
          <LogOut className="h-5 w-5" /> Sign out
        </button>
      </Card>
    </div>
  );
}
