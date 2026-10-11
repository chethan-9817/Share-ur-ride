/**
 * DriverDashboard — The driver's view of assigned ride groups.
 *
 * Shows:
 *   - Driver profile & vehicle info
 *   - List of assigned groups with passengers
 *   - Ordered stops for each group
 *   - Total earnings per trip
 *   - Status controls to simulate trip progression
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { driver as driverApi } from '../services/api';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const pickupIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const dropoffIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

export default function DriverDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupDetail, setGroupDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);

  useEffect(() => {
    loadData(true);
    const interval = setInterval(() => {
      loadData(false);
    }, 4000);
    return () => clearInterval(interval);
  }, [selectedGroup]);

  const loadData = async (initial = false) => {
    try {
      const [prof, groups] = await Promise.all([
        driverApi.profile(),
        driverApi.assignments(),
      ]);
      setProfile(prof);
      setAssignments(groups);
      if (groups.length > 0 && !selectedGroup) {
        loadGroupDetail(groups[0].id);
      } else if (selectedGroup) {
        const detail = await driverApi.assignment(selectedGroup);
        setGroupDetail(detail);
      }
    } catch (err) {
      if (initial) setError(err.message);
    } finally {
      if (initial) setLoading(false);
    }
  };

  const loadGroupDetail = async (groupId) => {
    setSelectedGroup(groupId);
    try {
      const detail = await driverApi.assignment(groupId);
      setGroupDetail(detail);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleAvailability = async () => {
    setToggleLoading(true);
    try {
      const updated = await driverApi.toggleAvailability();
      setProfile(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setToggleLoading(false);
    }
  };

  const handleStatusUpdate = async (status) => {
    if (!selectedGroup) return;
    setActionLoading(true);
    try {
      await driverApi.updateStatus(selectedGroup, status);
      await loadData();
      await loadGroupDetail(selectedGroup);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const statusActions = {
    accepting: { next: 'confirmed', label: '✓ Accept Ride Group',  color: 'from-accent to-cyan-600' },
    forming:   { next: 'confirmed', label: '✓ Confirm Pickup',  color: 'from-success to-emerald-600' },
    confirmed: { next: 'on_trip',   label: '🚗 Start Trip',      color: 'from-accent to-cyan-600' },
    on_trip:   { next: 'completed', label: '🏁 Complete Trip',   color: 'from-primary to-primary-dark' },
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-dark">
        <div className="w-10 h-10 rounded-full border-3 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  const totalEarnings = assignments
    .filter(a => a.total_fare)
    .reduce((sum, a) => sum + a.total_fare, 0);

  // Map data for selected group
  const mapStops = groupDetail?.stops || [];
  const mapCenter = mapStops.length > 0
    ? [mapStops.reduce((a, b) => a + b.lat, 0) / mapStops.length, mapStops.reduce((a, b) => a + b.lng, 0) / mapStops.length]
    : [12.97, 77.59];

  return (
    <div className="min-h-screen bg-bg-dark pb-8">
      {/* Header */}
      <header className="glass sticky top-0 z-50 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-cyan-600 flex items-center justify-center text-sm font-bold">
              🚕
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary">Driver Dashboard</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-text-secondary text-sm">{user?.name?.split(' ')[0]}</span>
            <button onClick={logout} className="text-text-muted text-xs hover:text-danger transition-colors">
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 mt-4 space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-danger/15 text-danger text-sm border border-danger/20">
            {error}
          </div>
        )}

        {/* Driver stats */}
        <div className="grid grid-cols-3 gap-3 animate-fade-in-up">
          <div className="glass rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-accent">{assignments.length}</p>
            <p className="text-text-muted text-xs mt-1">Trips</p>
          </div>
          <div className="glass rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-success">₹{totalEarnings.toFixed(0)}</p>
            <p className="text-text-muted text-xs mt-1">Earnings</p>
          </div>
          <div className="glass rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-primary-light">
              {assignments.reduce((sum, a) => sum + (a.ride_requests?.length || 0), 0)}
            </p>
            <p className="text-text-muted text-xs mt-1">Passengers</p>
          </div>
        </div>

        {/* Vehicle info */}
        {profile && (
          <div className="glass rounded-3xl p-5 animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-text-muted text-xs uppercase tracking-wider font-semibold">Your Vehicle</h3>
              <button
                onClick={handleToggleAvailability}
                disabled={toggleLoading}
                className={`px-3 py-1 rounded-xl text-xs font-semibold border transition-all ${
                  profile.available
                    ? 'bg-success/15 border-success/30 text-success hover:bg-success/25'
                    : 'bg-warning/15 border-warning/30 text-warning hover:bg-warning/25'
                } disabled:opacity-50`}
                title="Click to toggle availability"
              >
                {toggleLoading ? 'Updating...' : profile.available ? '🟢 Online (Available)' : '⏸️ Offline (Paused)'}
              </button>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-2xl">
                🚗
              </div>
              <div className="flex-1">
                <p className="text-text-primary font-semibold">{profile.vehicle_model}</p>
                <p className="text-text-secondary text-sm">{profile.vehicle_number}</p>
                <p className="text-text-muted text-xs mt-0.5">{profile.seats} seats · {profile.available ? 'Ready for ride assignments' : 'Currently off-duty'}</p>
              </div>
            </div>
          </div>
        )}

        {/* Assignment list */}
        <div className="animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <h3 className="text-text-muted text-xs uppercase tracking-wider font-semibold mb-3">Assignments</h3>

          {assignments.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center">
              <div className="text-4xl mb-3">📭</div>
              <p className="text-text-secondary text-sm">No assignments yet</p>
              <p className="text-text-muted text-xs mt-1">Rides will appear here when passengers are matched</p>
            </div>
          ) : (
            <div className="space-y-2">
              {assignments.map((group) => (
                <button
                  key={group.id}
                  onClick={() => loadGroupDetail(group.id)}
                  className={`w-full p-4 rounded-2xl text-left transition-all border ${
                    selectedGroup === group.id
                      ? 'border-accent bg-accent/5 glass'
                      : 'border-border bg-bg-surface hover:border-accent/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-text-primary font-medium text-sm">
                      Group #{group.id}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                      group.status === 'completed' ? 'status-completed' :
                      group.status === 'on_trip' ? 'status-on_trip' :
                      group.status === 'confirmed' ? 'status-confirmed' :
                      'status-pending'
                    }`}>
                      {group.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">
                      {group.ride_requests?.length || '?'} passengers · {group.total_distance_km?.toFixed(1) || '?'} km
                    </span>
                    <span className="text-success font-medium">₹{group.total_fare?.toFixed(0) || '—'}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected group detail */}
        {groupDetail && (
          <>
            {/* Map */}
            <div className="glass rounded-3xl overflow-hidden animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
              <div style={{ height: '200px' }}>
                <MapContainer
                  key={selectedGroup}
                  center={mapCenter}
                  zoom={11}
                  style={{ height: '100%', width: '100%' }}
                  zoomControl={false}
                >
                  <TileLayer
                    attribution='&copy; OpenStreetMap'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  />
                  {mapStops.map((stop, i) => (
                    <Marker
                      key={`stop-${stop.type}-${i}-${stop.lat}-${stop.lng}`}
                      position={[stop.lat, stop.lng]}
                      icon={stop.type === 'pickup' ? pickupIcon : dropoffIcon}
                    >
                      <Popup>
                        {stop.type === 'pickup' ? '📍 Pickup: ' : `Drop #${stop.order}: `}
                        {stop.name}
                        {stop.passenger_name && ` (${stop.passenger_name})`}
                      </Popup>
                    </Marker>
                  ))}
                  {groupDetail?.geometry && groupDetail.geometry.length > 1 ? (
                    <Polyline
                      positions={groupDetail.geometry}
                      color="#00D2D3"
                      weight={4}
                      opacity={0.85}
                    />
                  ) : mapStops.length > 1 && (
                    <Polyline
                      positions={mapStops.map(s => [s.lat, s.lng])}
                      color="#00D2D3"
                      weight={3}
                      opacity={0.7}
                      dashArray="8 4"
                    />
                  )}
                </MapContainer>
              </div>
            </div>

            {/* Stops list */}
            <div className="glass rounded-3xl p-6 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
              <h3 className="text-text-muted text-xs uppercase tracking-wider font-semibold mb-4">
                Route — {groupDetail.passenger_count} passengers · {groupDetail.total_distance_km?.toFixed(1)} km
              </h3>
              <div className="relative pl-6 space-y-3">
                {groupDetail.stops.map((stop, i) => (
                  <div key={i} className="relative">
                    {i < groupDetail.stops.length - 1 && (
                      <div className="absolute left-[-18px] top-[20px] w-0.5 h-[calc(100%+4px)] bg-border" />
                    )}
                    <div className={`absolute left-[-22px] top-[6px] w-2.5 h-2.5 rounded-full border-2 ${
                      stop.type === 'pickup' ? 'bg-accent border-accent' : 'bg-primary border-primary'
                    }`} />
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-text-primary font-medium text-sm">
                          {stop.type === 'pickup' ? '📍' : `#${stop.order}`} {stop.name}
                        </p>
                        {stop.passenger_name && (
                          <p className="text-text-muted text-xs flex items-center gap-1">
                            {stop.passenger_name}
                            {stop.passenger_verified && <span className="text-success text-[9px]">✓</span>}
                          </p>
                        )}
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        stop.type === 'pickup' ? 'bg-accent/15 text-accent' : 'bg-primary/15 text-primary-light'
                      }`}>
                        {stop.type}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Earnings */}
              <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                <span className="text-text-muted text-sm">Total Earnings</span>
                <span className="text-success font-bold text-xl">₹{groupDetail.total_earnings?.toFixed(0)}</span>
              </div>
            </div>

            {/* Status action button */}
            {statusActions[groupDetail.status] && (
              <button
                onClick={() => handleStatusUpdate(statusActions[groupDetail.status].next)}
                disabled={actionLoading}
                className={`w-full py-4 rounded-2xl bg-gradient-to-r ${statusActions[groupDetail.status].color} text-white font-semibold text-lg hover:shadow-xl transition-all active:scale-[0.98] disabled:opacity-50 animate-fade-in-up`}
                style={{ animationDelay: '0.25s' }}
              >
                {actionLoading ? 'Updating...' : statusActions[groupDetail.status].label}
              </button>
            )}

            {groupDetail.status === 'completed' && (
              <div className="glass rounded-2xl p-4 text-center animate-fade-in-up" style={{ animationDelay: '0.25s' }}>
                <p className="text-success font-semibold">🏁 Trip Completed</p>
                <p className="text-text-muted text-xs mt-1">Earnings: ₹{groupDetail.total_earnings?.toFixed(0)}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
