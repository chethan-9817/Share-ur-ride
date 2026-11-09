/** Domain enums shared by the API and the web client. */

export const ROLES = ['rider', 'driver', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const GENDERS = ['female', 'male', 'non_binary', 'undisclosed'] as const;
export type Gender = (typeof GENDERS)[number];

export const HUB_TYPES = ['airport', 'railway', 'bus'] as const;
export type HubType = (typeof HUB_TYPES)[number];

/**
 * Ride request lifecycle.
 *  pending   → waiting in the pool for co-riders
 *  matched   → placed in a group, waiting for this rider to accept
 *  confirmed → rider accepted; fare is price-guaranteed
 *  picked_up → driver verified the rider's PIN
 *  completed → dropped at destination
 */
export const RIDE_STATUSES = [
  'pending',
  'matched',
  'confirmed',
  'picked_up',
  'completed',
  'cancelled',
  'no_show',
  'expired',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

/**
 * Group (shared cab) lifecycle.
 *  accepting  → members have ACCEPT_WINDOW seconds to accept
 *  dispatching→ all accepted, offering the trip to drivers
 *  assigned   → a driver accepted, en route to hub
 *  arrived    → driver at the hub pickup point
 *  on_trip    → in motion, dropping riders
 */
export const GROUP_STATUSES = [
  'accepting',
  'dispatching',
  'assigned',
  'arrived',
  'on_trip',
  'completed',
  'cancelled',
] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

export const OFFER_STATUSES = ['pending', 'accepted', 'rejected', 'expired'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const DRIVER_STATUSES = ['offline', 'online', 'busy'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const SOS_STATUSES = ['open', 'acknowledged', 'resolved', 'false_alarm'] as const;
export type SosStatus = (typeof SOS_STATUSES)[number];

export const SAFETY_EVENT_TYPES = [
  'sos',
  'route_deviation',
  'unexpected_stop',
  'speeding',
  'check_in_missed',
  'check_in_ok',
  'trip_shared',
] as const;
export type SafetyEventType = (typeof SAFETY_EVENT_TYPES)[number];

export const VEHICLE_TYPES = ['hatchback', 'sedan', 'suv'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const TOLERANCE_OPTIONS = [10, 15, 20, 30] as const;

/** Night window in which extra safety checks are enabled (local hours, 24h). */
export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 6;

export const RATING_TAGS = [
  'safe_driving',
  'punctual',
  'clean_vehicle',
  'friendly',
  'helpful_with_luggage',
  'rash_driving',
  'late',
  'rude',
  'unsafe',
] as const;
export type RatingTag = (typeof RATING_TAGS)[number];

/** Socket.IO event names — one source of truth for client and server. */
export const SOCKET_EVENTS = {
  rideUpdated: 'ride:updated',
  groupUpdated: 'group:updated',
  offerReceived: 'offer:received',
  offerCancelled: 'offer:cancelled',
  driverLocation: 'driver:location',
  driverLocationPush: 'driver:location:push',
  sosRaised: 'sos:raised',
  sosUpdated: 'sos:updated',
  safetyAlert: 'safety:alert',
  safetyCheckIn: 'safety:check_in',
  notification: 'notification',
  joinShare: 'share:join',
  leaveShare: 'share:leave',
  joinGroup: 'group:join',
  leaveGroup: 'group:leave',
} as const;
