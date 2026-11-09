import type {
  AdminOverviewDto,
  DriverProfileDto,
  EarningsDto,
  GroupDto,
  NotificationDto,
  OfferDto,
  RideDto,
  SosDto,
  StationDto,
  TrustedContactDto,
  UserDto,
} from '@arriveshare/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useSocketEvent } from './useSocket';

/** Query keys in one place so socket events can invalidate precisely. */
export const qk = {
  me: ['me'] as const,
  config: ['config'] as const,
  stations: ['stations'] as const,
  rides: (scope: string) => ['rides', scope] as const,
  ride: (id: string) => ['ride', id] as const,
  group: (rideId: string) => ['group', rideId] as const,
  contacts: ['contacts'] as const,
  notifications: ['notifications'] as const,
  mySos: ['sos', 'mine'] as const,
  driverMe: ['driver', 'me'] as const,
  offer: ['driver', 'offer'] as const,
  trip: ['driver', 'trip'] as const,
  earnings: ['driver', 'earnings'] as const,
  admin: (k: string) => ['admin', k] as const,
};

export interface AppConfig {
  demoMode: boolean;
  simulator: boolean;
  acceptWindowSec: number;
  offerTimeoutSec: number;
  noShowWaitMin: number;
}

const authed = () => !!useAuth.getState().token;

export const useConfig = () =>
  useQuery({ queryKey: qk.config, queryFn: () => api.get<AppConfig>('/auth/config'), staleTime: Infinity });

export const useStations = () =>
  useQuery({ queryKey: qk.stations, queryFn: () => api.get<StationDto[]>('/stations'), staleTime: 60 * 60_000 });

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api.get<UserDto>('/me'), enabled: authed() });

export const useRides = (scope: 'active' | 'history' | 'all') =>
  useQuery({ queryKey: qk.rides(scope), queryFn: () => api.get<RideDto[]>(`/rides?scope=${scope}`) });

export const useRide = (id: string | undefined) =>
  useQuery({ queryKey: qk.ride(id ?? ''), queryFn: () => api.get<RideDto>(`/rides/${id}`), enabled: !!id });

export const useGroup = (rideId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: qk.group(rideId ?? ''),
    queryFn: () => api.get<GroupDto | null>(`/rides/${rideId}/group`),
    enabled: !!rideId && enabled,
  });

export const useContacts = () =>
  useQuery({ queryKey: qk.contacts, queryFn: () => api.get<TrustedContactDto[]>('/me/contacts') });

export const useNotifications = () =>
  useQuery({ queryKey: qk.notifications, queryFn: () => api.get<NotificationDto[]>('/me/notifications') });

export const useMySos = () => useQuery({ queryKey: qk.mySos, queryFn: () => api.get<SosDto[]>('/safety/sos') });

export const useDriverMe = () =>
  useQuery({ queryKey: qk.driverMe, queryFn: () => api.get<DriverProfileDto>('/driver/me'), retry: false });

export const useOffer = (enabled: boolean) =>
  useQuery({ queryKey: qk.offer, queryFn: () => api.get<OfferDto | null>('/driver/offer'), enabled, refetchInterval: enabled ? 15_000 : false });

export type DriverTrip = GroupDto & { arrivedAt: string | null; noShowWaitMin: number };
export const useDriverTrip = () =>
  useQuery({ queryKey: qk.trip, queryFn: () => api.get<DriverTrip | null>('/driver/trip') });

export interface EarningsResponse {
  summary: EarningsDto;
  trips: { id: string; completedAt: string; routeKm: number; net: number | null; bonus: number | null; station: string }[];
}
export const useEarnings = () =>
  useQuery({ queryKey: qk.earnings, queryFn: () => api.get<EarningsResponse>('/driver/earnings') });

export const useAdminOverview = () =>
  useQuery({ queryKey: qk.admin('overview'), queryFn: () => api.get<AdminOverviewDto>('/admin/overview'), refetchInterval: 20_000 });

/**
 * Global live-update bridge: server pushes small "something changed" events and
 * we refetch exactly the affected queries. Keeps sockets thin and the cache honest.
 */
export function useLiveInvalidation() {
  const qc = useQueryClient();
  useSocketEvent<{ rideId?: string }>('ride:updated', (p) => {
    qc.invalidateQueries({ queryKey: ['rides'] });
    if (p.rideId) {
      qc.invalidateQueries({ queryKey: qk.ride(p.rideId) });
      qc.invalidateQueries({ queryKey: qk.group(p.rideId) });
    } else {
      qc.invalidateQueries({ queryKey: ['ride'] });
      qc.invalidateQueries({ queryKey: ['group'] });
    }
  });
  useSocketEvent('group:updated', () => {
    qc.invalidateQueries({ queryKey: ['group'] });
    qc.invalidateQueries({ queryKey: ['ride'] });
    qc.invalidateQueries({ queryKey: qk.trip });
  });
  useSocketEvent('notification', () => qc.invalidateQueries({ queryKey: qk.notifications }));
  useSocketEvent('offer:received', () => qc.invalidateQueries({ queryKey: qk.offer }));
  useSocketEvent('offer:cancelled', () => qc.invalidateQueries({ queryKey: qk.offer }));
  useSocketEvent('sos:raised', () => qc.invalidateQueries({ queryKey: ['admin'] }));
  useSocketEvent('sos:updated', () => {
    qc.invalidateQueries({ queryKey: ['admin'] });
    qc.invalidateQueries({ queryKey: qk.mySos });
  });
}
