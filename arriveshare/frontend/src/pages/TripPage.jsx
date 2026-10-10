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
import { rides as ridesApi, groups as groupsApi, matches as matchApi } from '../services/api';
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
  const [showSosModal, setShowSosModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [shareContact, setShareContact] = useState({ name: '', phone: '' });
  const [shareSuccess, setShareSuccess] = useState(false);
  const [sosSent, setSosSent] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadRide();
    // Live polling to synchronize with driver or co-passenger actions
    const interval = setInterval(loadRide, 4000);
    return () => clearInterval(interval);
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

  const handleAcceptMatch = async () => {
    setActionLoading(true);
    try {
      await ridesApi.confirm(rideId);
      await loadRide();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeclineMatch = async () => {
    setActionLoading(true);
    try {
      await matchApi.decline(rideId);
      navigate(`/ride/${rideId}/matching`);
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelRide = async () => {
    setActionLoading(true);
    try {
      await ridesApi.cancel(rideId);
      await loadRide();
      setShowCancelModal(false);
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
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

  const handleSendSos = () => {
    setSosSent(true);
    setTimeout(() => {
      setSosSent(false);
      setShowSosModal(false);
    }, 2500);
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSosModal(true)}
              className="px-2.5 py-1.5 rounded-xl bg-danger/15 text-danger border border-danger/30 text-xs font-semibold hover:bg-danger/25 transition-all flex items-center gap-1"
            >
              🚨 SOS
            </button>
            <button
              onClick={() => setShowShareModal(true)}
              className="px-3 py-1.5 rounded-xl bg-bg-surface border border-border text-text-secondary text-xs hover:border-accent hover:text-accent transition-all"
            >
              🔒 Share
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 mt-4 space-y-4">
        {/* Matched status action banner */}
        {ride.status === 'matched' && (
          <div className="glass rounded-3xl p-5 border border-primary/40 animate-fade-in-up">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">🎉</span>
              <h3 className="text-base font-bold text-success">Match Found!</h3>
            </div>
            <p className="text-text-secondary text-xs mb-4">
              Co-travelers found heading your way. Confirm your seat to ride together.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleAcceptMatch}
                disabled={actionLoading}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-success to-emerald-600 text-white font-semibold text-xs hover:shadow-lg transition-all disabled:opacity-50"
              >
                {actionLoading ? 'Confirming...' : '✓ Accept Match'}
              </button>
              <button
                onClick={handleDeclineMatch}
                disabled={actionLoading}
                className="flex-1 py-3 rounded-xl border border-border text-text-secondary font-medium text-xs hover:border-warning hover:text-warning transition-all disabled:opacity-50"
              >
                Decline Match
              </button>
            </div>
          </div>
        )}

        {/* Pending status helper */}
        {ride.status === 'pending' && (
          <div className="glass rounded-3xl p-5 text-center animate-fade-in-up border border-warning/30">
            <div className="text-3xl mb-1.5">⏳</div>
            <h3 className="text-sm font-semibold mb-1 text-warning">Looking for Co-Travelers</h3>
            <p className="text-text-muted text-xs mb-3">
              We are actively matching you with passengers landing around your arrival window.
            </p>
            <button
              onClick={() => navigate(`/ride/${ride.id}/matching`)}
              className="px-5 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary-dark transition-all"
            >
              Open Radar Matching View
            </button>
          </div>
        )}

        {/* Cancelled status banner */}
        {ride.status === 'cancelled' && (
          <div className="glass rounded-3xl p-6 text-center animate-fade-in-up border border-danger/30">
            <div className="text-4xl mb-2">❌</div>
            <h3 className="text-base font-bold text-danger mb-1">Ride Cancelled</h3>
            <p className="text-text-secondary text-xs mb-4">This ride request has been cancelled.</p>
            <button
              onClick={() => navigate('/ride/new')}
              className="px-6 py-2.5 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary-dark transition-all"
            >
              Book a New Ride
            </button>
          </div>
        )}

        {/* Status Progress */}
        {ride.status !== 'cancelled' && (
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
            {ride.status !== 'completed' && ride.status !== 'pending' && ride.status !== 'matched' && (
              <button
                onClick={simulateProgress}
                disabled={simulating}
                className="w-full mt-2 py-2 rounded-xl bg-bg-surface border border-border text-text-muted text-xs hover:border-primary hover:text-primary-light transition-all disabled:opacity-50"
              >
                {simulating ? 'Updating...' : `⏩ Simulate Next Step`}
              </button>
            )}
          </div>
        )}

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
              {/* Real Road Route Polyline from OSRM, or waypoint connecting fallback */}
              {routeData?.geometry && routeData.geometry.length > 0 ? (
                <Polyline
                  positions={routeData.geometry}
                  color="#6C5CE7"
                  weight={4}
                  opacity={0.85}
                />
              ) : routeData?.stops ? (
                <Polyline
                  positions={routeData.stops.map(s => [s.lat, s.lng])}
                  color="#6C5CE7"
                  weight={3}
                  opacity={0.7}
                  dashArray="8 4"
                />
              ) : null}
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

        {/* Cancel Ride Button */}
        {ride.status !== 'completed' && ride.status !== 'cancelled' && (
          <div className="pt-2">
            <button
              onClick={() => setShowCancelModal(true)}
              disabled={actionLoading}
              className="w-full py-3 rounded-2xl border border-danger/30 text-danger text-sm font-medium hover:bg-danger/10 transition-all active:scale-[0.99] disabled:opacity-50"
            >
              Cancel Ride Request
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

      {/* SOS Emergency Modal */}
      {showSosModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="glass rounded-3xl p-6 w-full max-w-md border border-danger/40 animate-fade-in-up">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🚨</span>
                <h3 className="text-lg font-bold text-danger">Emergency Assistance</h3>
              </div>
              <button
                onClick={() => setShowSosModal(false)}
                className="text-text-muted hover:text-text-primary text-xl"
              >
                ×
              </button>
            </div>

            {sosSent ? (
              <div className="text-center py-6">
                <div className="text-4xl mb-2">📡</div>
                <p className="text-danger font-bold text-lg mb-1">SOS Alert Broadcasted!</p>
                <p className="text-text-secondary text-xs">
                  Your coordinates, vehicle details ({groupData?.driver?.vehicle_number || 'KA01AB1234'}), and trip route have been logged.
                </p>
              </div>
            ) : (
              <div>
                <p className="text-text-secondary text-sm mb-4">
                  Need immediate help? Trigger an emergency broadcast or call direct hotlines below:
                </p>
                <div className="space-y-2 mb-5">
                  <a
                    href="tel:112"
                    className="flex items-center justify-between p-3 rounded-xl bg-danger/10 border border-danger/25 text-danger hover:bg-danger/20 transition-all font-semibold text-sm"
                  >
                    <span>📞 National Emergency Service</span>
                    <span className="font-mono text-base">112</span>
                  </a>
                  <a
                    href="tel:1091"
                    className="flex items-center justify-between p-3 rounded-xl bg-bg-surface border border-border text-text-primary hover:border-danger/40 transition-all text-sm"
                  >
                    <span>🛡️ Women's Helpline</span>
                    <span className="font-mono text-base text-accent">1091</span>
                  </a>
                  <a
                    href="tel:182"
                    className="flex items-center justify-between p-3 rounded-xl bg-bg-surface border border-border text-text-primary hover:border-danger/40 transition-all text-sm"
                  >
                    <span>🚆 Railway Security / Transit Police</span>
                    <span className="font-mono text-base text-accent">182</span>
                  </a>
                </div>
                <button
                  onClick={handleSendSos}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-danger to-red-700 text-white font-bold text-sm hover:shadow-lg hover:shadow-danger/30 transition-all active:scale-[0.98]"
                >
                  Broadcast Instant SOS Alert
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="glass rounded-3xl p-6 w-full max-w-sm border border-border animate-fade-in-up text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h3 className="text-lg font-bold mb-2">Cancel This Ride?</h3>
            <p className="text-text-secondary text-xs mb-6">
              Are you sure you want to cancel? If you are in a shared group, your seat will be released and fares will be recalculated for remaining co-travelers.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-3 rounded-xl border border-border text-text-secondary text-sm font-medium hover:border-text-primary transition-all"
              >
                Keep Ride
              </button>
              <button
                onClick={handleCancelRide}
                disabled={actionLoading}
                className="flex-1 py-3 rounded-xl bg-danger text-white text-sm font-semibold hover:bg-red-600 transition-all disabled:opacity-50"
              >
                {actionLoading ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
