import type {
  DriverStatus,
  Gender,
  GroupStatus,
  HubType,
  OfferStatus,
  RideStatus,
  Role,
  SafetyEventType,
  SosStatus,
  VehicleType,
} from './constants';
import type { LatLng } from './geo';

/** Response DTOs returned by the API. Dates are ISO strings on the wire. */

export interface SafetyPrefs {
  autoShareTrips: boolean;
  nightCheckIns: boolean;
  womenOnlyDefault: boolean;
  preferFemaleDriver: boolean;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  gender: Gender;
  role: Role;
  avatarUrl: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  safety: SafetyPrefs;
  onboarded: boolean;
  createdAt: string;
}

export interface TrustedContactDto {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  relation: string | null;
}

export interface StationDto {
  id: string;
  code: string;
  name: string;
  type: HubType;
  city: string;
  lat: number;
  lng: number;
}

export interface FareQuoteDto {
  soloKm: number;
  soloFare: number;
  estimatedSharedFare: number;
  estimatedSavingsPct: number;
  etaMin: number;
  co2SavedKg: number;
}

export interface VehicleDto {
  number: string;
  model: string;
  color: string;
  type: VehicleType;
  seats: number;
}

export interface DriverPublicDto {
  id: string;
  name: string;
  gender: Gender;
  /** Masked so riders never see the driver's real number. */
  phoneMasked: string;
  ratingAvg: number | null;
  ratingCount: number;
  verified: boolean;
  vehicle: VehicleDto;
  location: (LatLng & { heading: number | null; updatedAt: string }) | null;
}

export interface CoRiderDto {
  rideId: string;
  firstName: string;
  verified: boolean;
  ratingAvg: number | null;
  dropIndex: number | null;
  status: RideStatus;
  accepted: boolean;
  isMe: boolean;
  /** Only populated for the driver and for the rider themselves. */
  destinationLabel?: string;
  destination?: LatLng;
  pickupPin?: string;
}

export interface GroupDto {
  id: string;
  status: GroupStatus;
  station: StationDto;
  pickupAt: string;
  routeKm: number;
  groupFare: number;
  acceptExpiresAt: string | null;
  womenOnly: boolean;
  route: LatLng[];
  members: CoRiderDto[];
  driver: DriverPublicDto | null;
  shareToken?: string | null;
}

export interface RideDto {
  id: string;
  status: RideStatus;
  station: StationDto;
  destination: LatLng;
  destinationLabel: string;
  arrivalAt: string;
  toleranceMin: number;
  seats: number;
  luggage: number;
  flightOrTrain: string | null;
  womenOnly: boolean;
  preferFemaleDriver: boolean;
  soloKm: number;
  soloFare: number;
  quotedFare: number | null;
  acceptedFare: number | null;
  finalFare: number | null;
  savings: number | null;
  pickupPin: string | null;
  dropIndex: number | null;
  groupId: string | null;
  rated: boolean;
  createdAt: string;
}

export interface DriverProfileDto {
  id: string;
  status: DriverStatus;
  verified: boolean;
  licenseNumber: string;
  vehicle: VehicleDto;
  location: LatLng | null;
  ratingAvg: number | null;
  ratingCount: number;
}

export interface OfferDto {
  id: string;
  groupId: string;
  status: OfferStatus;
  expiresAt: string;
  station: StationDto;
  pickupAt: string;
  passengers: number;
  routeKm: number;
  distanceToHubKm: number;
  payout: { gross: number; commission: number; bonus: number; net: number };
  womenOnly: boolean;
}

export interface EarningsDto {
  today: { trips: number; net: number; passengers: number };
  week: { trips: number; net: number; passengers: number };
  lifetime: { trips: number; net: number; passengers: number; bonus: number };
  daily: { date: string; net: number; trips: number }[];
}

export interface SosDto {
  id: string;
  status: SosStatus;
  user: { id: string; name: string; phone: string | null; gender: Gender };
  rideId: string | null;
  groupId: string | null;
  location: LatLng | null;
  message: string | null;
  driver: { name: string; phone: string | null; vehicleNumber: string } | null;
  createdAt: string;
  resolvedAt: string | null;
  note: string | null;
}

export interface SafetyEventDto {
  id: string;
  type: SafetyEventType;
  groupId: string | null;
  rideId: string | null;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  location: LatLng | null;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface ShareViewDto {
  token: string;
  riderFirstName: string;
  status: GroupStatus;
  station: StationDto;
  destinationLabel: string;
  destination: LatLng;
  route: LatLng[];
  driver: DriverPublicDto | null;
  expiresAt: string;
  lastSafetyEvent: SafetyEventDto | null;
}

export interface AdminOverviewDto {
  users: number;
  drivers: number;
  driversOnline: number;
  ridesToday: number;
  activeGroups: number;
  openSos: number;
  pooledRatePct: number;
  savingsToday: number;
  co2SavedKg: number;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
