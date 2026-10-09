/**
 * API Service — centralized HTTP client for the FastAPI backend.
 * All endpoints return JSON. Auth token is auto-attached from localStorage.
 */

const API_BASE = '/api';

async function request(endpoint, options = {}) {
  const token = localStorage.getItem('arriveshare_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

// ── Auth ────────────────────────────────────
export const auth = {
  register: (data) => request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  sendOtp: (email) => request('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyOtp: (email, otp) => request('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, otp }) }),
  me: () => request('/auth/me'),
};

// ── Stations ────────────────────────────────
export const stations = {
  list: () => request('/stations'),
  get: (id) => request(`/stations/${id}`),
};

// ── Rides ───────────────────────────────────
export const rides = {
  create: (data) => request('/rides', { method: 'POST', body: JSON.stringify(data) }),
  my: () => request('/rides/my'),
  get: (id) => request(`/rides/${id}`),
  confirm: (id) => request(`/rides/${id}/confirm`, { method: 'POST' }),
  updateStatus: (id, status) => request(`/rides/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  shareTrip: (id, data) => request(`/rides/${id}/share-trip`, { method: 'POST', body: JSON.stringify(data) }),
};

// ── Matching ────────────────────────────────
export const matches = {
  find: (rideId) => request(`/matches/find/${rideId}`, { method: 'POST' }),
  decline: (rideId) => request(`/matches/decline/${rideId}`, { method: 'POST' }),
};

// ── Groups ──────────────────────────────────
export const groups = {
  get: (id) => request(`/groups/${id}`),
  route: (id) => request(`/groups/${id}/route`),
};

// ── Driver ──────────────────────────────────
export const driver = {
  profile: () => request('/driver/profile'),
  assignments: () => request('/driver/assignments'),
  assignment: (groupId) => request(`/driver/assignments/${groupId}`),
  updateStatus: (groupId, status) => request(`/driver/assignments/${groupId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
};
