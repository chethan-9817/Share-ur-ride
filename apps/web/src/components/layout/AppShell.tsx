import type { Role } from '@arriveshare/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  Car,
  History,
  Home,
  LayoutDashboard,
  LogOut,
  Plus,
  ShieldCheck,
  User,
  Users,
  Wallet,
  WifiOff,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CheckInPrompt } from '@/components/safety/CheckInPrompt';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/primitives';
import { useLiveInvalidation } from '@/hooks/queries';
import { useConnectionState } from '@/hooks/useSocket';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const NAV: Record<Role, NavItem[]> = {
  rider: [
    { to: '/', label: 'Home', icon: <Home className="h-5 w-5" />, end: true },
    { to: '/book', label: 'Book', icon: <Plus className="h-5 w-5" /> },
    { to: '/rides', label: 'Rides', icon: <History className="h-5 w-5" /> },
    { to: '/safety', label: 'Safety', icon: <ShieldCheck className="h-5 w-5" /> },
    { to: '/profile', label: 'Profile', icon: <User className="h-5 w-5" /> },
  ],
  driver: [
    { to: '/driver', label: 'Drive', icon: <Car className="h-5 w-5" />, end: true },
    { to: '/driver/earnings', label: 'Earnings', icon: <Wallet className="h-5 w-5" /> },
    { to: '/safety', label: 'Safety', icon: <ShieldCheck className="h-5 w-5" /> },
    { to: '/profile', label: 'Profile', icon: <User className="h-5 w-5" /> },
  ],
  admin: [
    { to: '/admin', label: 'Ops', icon: <LayoutDashboard className="h-5 w-5" />, end: true },
    { to: '/admin/drivers', label: 'Drivers', icon: <Car className="h-5 w-5" /> },
    { to: '/admin/users', label: 'Users', icon: <Users className="h-5 w-5" /> },
    { to: '/profile', label: 'Profile', icon: <User className="h-5 w-5" /> },
  ],
};

export function AppShell() {
  const user = useAuth((s) => s.user)!;
  const clear = useAuth((s) => s.clear);
  const online = useConnectionState();
  const nav = useNavigate();
  const qc = useQueryClient();
  useLiveInvalidation();

  const items = NAV[user.role];
  const loc = useLocation();
  const title =
    [...items].sort((a, b) => b.to.length - a.to.length).find((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to)))?.label ??
    (loc.pathname.startsWith('/rides/') ? 'Ride details' : '');
  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    clear();
    qc.clear();
    nav('/login');
  };

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="glass sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r px-4 py-6 lg:flex">
        <Link to="/" className="mb-8 flex items-center gap-2 px-2 text-lg font-extrabold">
          <img src="/icon.svg" className="h-8 w-8" alt="" /> ArriveShare
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                  isActive ? 'bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-md shadow-brand-600/25' : 'text-slate-600 hover:bg-white/80',
                )
              }
            >
              {i.icon}
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3 rounded-2xl bg-white/80 p-3 ring-1 ring-indigo-100">
          <Avatar name={user.name} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{user.name}</div>
            <div className="text-xs capitalize text-slate-500">{user.role}</div>
          </div>
          <button onClick={logout} className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10" aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="glass pt-safe sticky top-0 z-[600] border-b">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 lg:px-8">
            <Link to="/" className="flex items-center gap-2 font-extrabold lg:hidden">
              <img src="/icon.svg" className="h-7 w-7" alt="" /> ArriveShare
            </Link>
            <div className="hidden text-sm font-semibold text-slate-500 lg:block">{title}</div>
            <div className="flex-1" />
            {!online && (
              <span className="chip bg-amber-100 text-amber-800">
                <WifiOff className="h-3.5 w-3.5" /> Reconnecting
              </span>
            )}
            {user.role === 'rider' && loc.pathname !== '/book' && (
              <Link to="/book" className="hidden sm:block">
                <Button size="sm" icon={<Plus className="h-4 w-4" />} className="bg-gradient-to-r from-brand-600 to-safe-600 hover:opacity-95">
                  Book a ride
                </Button>
              </Link>
            )}
            <NotificationBell />
            <Link to="/profile" aria-label="Profile" className="rounded-full ring-2 ring-white transition hover:ring-brand-200">
              <Avatar name={user.name} size={34} />
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 lg:px-8 lg:pb-10 lg:pt-8">
          <Outlet />
        </main>

        {/* Mobile bottom tabs */}
        <nav className="glass pb-safe fixed inset-x-0 bottom-0 z-[600] border-t shadow-[0_-8px_24px_-16px_rgba(79,70,229,0.35)] lg:hidden">
          <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.end}
                className={({ isActive }) =>
                  cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', isActive ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500')
                }
              >
                {i.icon}
                {i.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
      <CheckInPrompt />
    </div>
  );
}
