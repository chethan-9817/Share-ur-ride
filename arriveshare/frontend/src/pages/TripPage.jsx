/**
 * TripPage — Live trip status view with map, co-travelers, and safety features.
 *
 * Shows the full trip lifecycle:
 *   Pending → Matched → Confirmed → Cab Arriving → On Trip → Completed
 *
 * Features:
 *   - Interactive map with station + destination markers
 *   - Group details (if shared ride)
 *   - Fare breakdown with savings
 *   - Share trip with trusted contact (safety)
 *   - Simulated status progression for demo
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { rides as ridesApi, groups as groupsApi } from '../services/api';
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

const destIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const greenIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const STATUS_STEPS = [
  { key: 'pending',   label: 'Waiting for Match', icon: '⏳', color: 'text-warning' },
  { key: 'matched',   label: 'Matched',           icon: '🤝', color: 'text-primary-light' },
  { key: 'confirmed', label: 'Confirmed',         icon: '✅', color: 'text-success' },
  { key: 'on_trip',   label: 'On Trip',           icon: '🚗', color: 'text-accent' },
  { key: 'completed', label: 'Completed',         icon: '🏁', color: 'text-success' },
];

export default function TripPage() {
  const { rideId } = useParams();
  const navigate = useNavigate();
  const [ride, setRide] = useState(null);
  const [groupData, setGroupData] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareContact, setShareContact] = useState({ name: '', phone: '' });
  const [shareSuccess, setShareSuccess] = useState(false);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    loadRide();
  }, [rideId]);

  const loadRide = async () => {
    try {
      const r = await ridesApi.get(rideId);
      setRide(r);

      if (r.group_id) {
        const [group, route] = await Promise.all([
          groupsApi.get(r.group_id),
          groupsApi.route(r.group_id),
        ]);
        setGroupData(group);
        setRouteData(route);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Simulate trip progression for demo purposes
  const simulateProgress = async () => {
    const statusFlow = ['confirmed', 'on_trip', 'completed'];
    const currentIdx = statusFlow.indexOf(ride.status);
    const nextIdx = currentIdx + 1;

    if (nextIdx < statusFlow.length) {
      setSimulating(true);
      try {
        await ridesApi.updateStatus(rideId, statusFlow[nextIdx]);
        await loadRide();
      } catch (err) {
        console.error(err);
      } finally {
        setSimulating(false);
      }
    }
  };

  const handleShareTrip = async (e) => {
    e.preventDefault();
    try {
      await ridesApi.shareTrip(rideId, {
        contact_name: shareContact.name,
        contact_phone: shareContact.phone,
      });
      setShareSuccess(true);
      setTimeout(() => {
        setShowShareModal(false);
        setShareSuccess(false);
      }, 2000);
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-dark">
        <div className="w-10 h-10 rounded-full border-3 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!ride) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-dark">
        <div className="text-center">
          <p className="text-text-secondary mb-4">Ride not found</p>
          <button onClick={() => navigate('/')} className="px-6 py-2 rounded-xl bg-bg-surface border border-border text-text-primary">
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const currentStatusIdx = STATUS_STEPS.findIndex(s => s.key === ride.status);
  const stationInfo = ride.station || (routeData?.stops?.[0]);

  // Build map bounds
  const mapPoints = [];
  if (stationInfo) mapPoints.push([stationInfo.latitude || stationInfo.lat, stationInfo.longitude || stationInfo.lng]);
  mapPoints.push([ride.dest_lat, ride.dest_lng]);
  if (routeData?.stops) {
    routeData.stops.forEach(s => mapPoints.push([s.lat, s.lng]));
  }
  const mapCenter = mapPoints.length > 0
    ? [mapPoints.reduce((a, b) => a + b[0], 0) / mapPoints.length, mapPoints.reduce((a, b) => a + b[1], 0) / mapPoints.length]
    : [12.97, 77.59];

  return (
    <div className="min-h-screen bg-bg-dark pb-8">
      <header className="glass sticky top-0 z-50 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-text-muted hover:text-text-primary transition-colors text-xl">
              ←
            </button>
            <h1 className="text-lg font-bold">Trip Details</h1>
          </div>
          <button
            onClick={() => setShowShareModal(true)}
            className="px-3 py-1.5 rounded-lg bg-bg-surface border border-border text-text-secondary text-xs hover:border-accent hover:text-accent transition-all"
          >
            🔒 Share Trip
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 mt-4 space-y-4">
        {/* Status Progress */}
        <div className="glass rounded-3xl p-6 animate-fade-in-up">
          <div className="flex items-center justify-between mb-4">
            {STATUS_STEPS.map((step, i) => {
              const isActive = i <= currentStatusIdx;
              const isCurrent = step.key === ride.status;
              return (
                <div key={step.key} className="flex flex-col items-center flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm mb-1 transition-all ${
                    isCurrent ? 'bg-primary/20 ring-2 ring-primary scale-110' :
                    isActive ? 'bg-success/15' : 'bg-bg-surface'
                  }`}>
                    {isActive ? step.icon : '○'}
                  </div>
                  <span className={`text-[10px] text-center leading-tight ${
                    isCurrent ? step.color + ' font-semibold' : isActive ? 'text-text-secondary' : 'text-text-muted'
                  }`}>
                    {step.label}
                  </span>
                  {i < STATUS_STEPS.length - 1 && (
                    <div className={`absolute h-0.5 ${isActive ? 'bg-primary/40' : 'bg-border'}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Simulate button (demo) */}
          {ride.status !== 'completed' && ride.status !== 'pending' && (
            <button
              onClick={simulateProgress}
              disabled={simulating}
              className="w-full mt-2 py-2 rounded-xl bg-bg-surface border border-border text-text-muted text-xs hover:border-primary hover:text-primary-light transition-all disabled:opacity-50"
            >
              {simulating ? 'Updating...' : `⏩ Simulate Next Step`}
            </button>
          )}
        </div>

        {/* Map */}
        <div className="glass rounded-3xl overflow-hidden animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
          <div style={{ height: '220px' }}>
            <MapContainer
              center={mapCenter}
              zoom={11}
              style={{ height: '100%', width: '100%' }}
              zoomControl={false}
            >
              <TileLayer
                attribution='&copy; OpenStreetMap'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              />
              {/* Station marker */}
              {stationInfo && (
                <Marker position={[stationInfo.latitude || stationInfo.lat, stationInfo.longitude || stationInfo.lng]}>
                  <Popup>{stationInfo.name || 'Pickup Station'}</Popup>
                </Marker>
              )}
              {/* Destination marker */}
              <Marker position={[ride.dest_lat, ride.dest_lng]} icon={destIcon}>
                <Popup>📍 {ride.dest_name}</Popup>
              </Marker>
              {/* Other group stops */}
              {routeData?.stops?.filter(s => s.type === 'dropoff' && s.name !== ride.dest_name).map((s, i) => (
                <Marker key={i} position={[s.lat, s.lng]} icon={greenIcon}>
                  <Popup>{s.passenger}: {s.name}</Popup>
                </Marker>
              ))}
              {/* Route line */}
              {routeData?.stops && (
                <Polyline
                  positions={routeData.stops.map(s => [s.lat, s.lng])}
                  color="#6C5CE7"
                  weight={3}
                  opacity={0.7}
                  dashArray="8 4"
                />
              )}
            </MapContainer>
          </div>
        </div>

        {/* Trip info */}
        <div className="glass rounded-3xl p-6 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-text-muted text-sm">Destination</span>
              <span className="text-text-primary font-medium">📍 {ride.dest_name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted text-sm">Ride type</span>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                ride.ride_type === 'shared' ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary-light'
              }`}>
                {ride.ride_type === 'shared' ? '🤝 Shared' : '🚗 Solo'}
              </span>
            </div>
            {ride.flight_train_number && (
              <div className="flex items-center justify-between">
                <span className="text-text-muted text-sm">Flight/Train</span>
                <span className="text-text-primary font-medium">{ride.flight_train_number}</span>
              </div>
            )}
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between">
              <span className="text-text-muted text-sm">Solo fare</span>
              <span className={`font-medium ${ride.shared_fare ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                ₹{ride.solo_fare?.toFixed(0)}
              </span>
            </div>
            {ride.shared_fare && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted text-sm">Your fare</span>
                  <span className="text-success font-bold text-lg">₹{ride.shared_fare.toFixed(0)}</span>
                </div>
                <div className="flex justify-end">
                  <span className="px-3 py-1 rounded-full bg-success/15 text-success text-xs font-semibold">
                    💰 Saving {ride.savings_pct}%
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Group info (if shared) */}
        {groupData && groupData.ride_requests && (
          <div className="glass rounded-3xl p-6 animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
            <h3 className="text-text-muted text-xs uppercase tracking-wider font-semibold mb-4">Your Group</h3>
            <div className="space-y-3">
              {groupData.ride_requests
                .sort((a, b) => (a.drop_order || 99) - (b.drop_order || 99))
                .map((req, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-bg-surface">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-sm font-bold">
                    {req.user?.name?.[0] || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-text-primary truncate">
                        {req.user?.name?.split(' ')[0] || 'Passenger'}
                      </span>
                      {req.user?.verified && (
                        <span className="px-1.5 py-0.5 rounded bg-success/15 text-success text-[9px] font-bold shrink-0">✓</span>
                      )}
                    </div>
                    <p className="text-text-muted text-xs truncate">📍 {req.dest_name}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-text-secondary text-xs">Drop #{req.drop_order}</p>
                    <p className="text-success text-xs font-medium">₹{req.shared_fare?.toFixed(0)}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Driver info */}
            {groupData.driver && (
              <div className="mt-4 p-4 rounded-xl bg-accent/5 border border-accent/20">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-lg">
                    🚕
                  </div>
                  <div>
                    <p className="text-text-primary font-medium text-sm">
                      {groupData.driver.user?.name?.split(' ')[0] || 'Driver'}
                    </p>
                    <p className="text-text-muted text-xs">
                      {groupData.driver.vehicle_model} · {groupData.driver.vehicle_number}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Completed banner */}
        {ride.status === 'completed' && (
          <div className="glass rounded-3xl p-6 text-center animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            <div className="text-5xl mb-3">🎉</div>
            <h3 className="text-xl font-bold text-success mb-1">Trip Completed!</h3>
            <p className="text-text-secondary text-sm mb-4">Thank you for sharing the ride.</p>
            <button
              onClick={() => navigate('/')}
              className="px-8 py-3 rounded-2xl bg-gradient-to-r from-primary to-primary-dark text-white font-semibold hover:shadow-lg hover:shadow-primary/25 transition-all"
            >
              Book Another Ride
            </button>
          </div>
        )}
      </div>

      {/* Share Trip Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-4">
          <div className="glass rounded-3xl p-6 w-full max-w-md animate-fade-in-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">🔒 Share Trip Details</h3>
              <button
                onClick={() => setShowShareModal(false)}
                className="text-text-muted hover:text-text-primary text-xl"
              >
                ×
              </button>
            </div>

            {shareSuccess ? (
              <div className="text-center py-6">
                <div className="text-4xl mb-2">✅</div>
                <p className="text-success font-medium">Trip details shared!</p>
              </div>
            ) : (
              <form onSubmit={handleShareTrip}>
                <p className="text-text-secondary text-sm mb-4">
                  Share your trip details with a trusted contact for safety.
                </p>
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="block text-text-secondary text-sm mb-1">Contact Name</label>
                    <input
                      type="text"
                      value={shareContact.name}
                      onChange={(e) => setShareContact(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-bg-surface border border-border text-text-primary focus:border-primary focus:outline-none transition-colors"
                      placeholder="Mom, Friend..."
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-text-secondary text-sm mb-1">Contact Phone</label>
                    <input
                      type="tel"
                      value={shareContact.phone}
                      onChange={(e) => setShareContact(prev => ({ ...prev, phone: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl bg-bg-surface border border-border text-text-primary focus:border-primary focus:outline-none transition-colors"
                      placeholder="+91 98765 43210"
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-primary-dark text-white font-semibold hover:shadow-lg hover:shadow-primary/25 transition-all active:scale-[0.98]"
                >
                  Share Trip
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
