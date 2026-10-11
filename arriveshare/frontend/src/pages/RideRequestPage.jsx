import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { stations as stationsApi, rides as ridesApi } from '../services/api';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
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

// Bangalore neighborhoods for quick destination selection
const POPULAR_DESTINATIONS = [
  { name: 'Koramangala', lat: 12.9352, lng: 77.6245 },
  { name: 'Indiranagar', lat: 12.9716, lng: 77.6412 },
  { name: 'Whitefield', lat: 12.9698, lng: 77.7500 },
  { name: 'Electronic City', lat: 12.8456, lng: 77.6603 },
  { name: 'MG Road', lat: 12.9756, lng: 77.6066 },
  { name: 'HSR Layout', lat: 12.9116, lng: 77.6474 },
  { name: 'Jayanagar', lat: 12.9308, lng: 77.5838 },
  { name: 'BTM Layout', lat: 12.9166, lng: 77.6101 },
  { name: 'Marathahalli', lat: 12.9591, lng: 77.6974 },
  { name: 'Hebbal', lat: 13.0358, lng: 77.5970 },
  { name: 'Malleshwaram', lat: 12.9965, lng: 77.5713 },
  { name: 'Banashankari', lat: 12.9255, lng: 77.5468 },
];

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click: (e) => onMapClick(e.latlng),
  });
  return null;
}

export default function RideRequestPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [stationList, setStationList] = useState([]);
  const [selectedStation, setSelectedStation] = useState(null);
  const [destLat, setDestLat] = useState(null);
  const [destLng, setDestLng] = useState(null);
  const [destName, setDestName] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [flightTrain, setFlightTrain] = useState('');
  const [rideType, setRideType] = useState('shared');
  const [matchWindowMinutes, setMatchWindowMinutes] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    stationsApi.list().then((s) => {
      setStationList(s);
      const stationId = searchParams.get('station');
      if (stationId) {
        const found = s.find((st) => st.id === parseInt(stationId));
        if (found) setSelectedStation(found);
      }
    });

    // Default arrival time to now + 30 min (in local timezone)
    const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + 30 * 60000);
    setArrivalTime(localNow.toISOString().slice(0, 16));
  }, []);

  const handleMapClick = (latlng) => {
    setDestLat(latlng.lat);
    setDestLng(latlng.lng);
    // Find nearest popular destination
    let nearest = POPULAR_DESTINATIONS[0];
    let minDist = Infinity;
    for (const d of POPULAR_DESTINATIONS) {
      const dist = Math.hypot(d.lat - latlng.lat, d.lng - latlng.lng);
      if (dist < minDist) { minDist = dist; nearest = d; }
    }
    if (minDist < 0.02) {
      setDestName(nearest.name);
    } else {
      setDestName(`${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`);
    }
  };

  const selectDestination = (dest) => {
    setDestLat(dest.lat);
    setDestLng(dest.lng);
    setDestName(dest.name);
    setSearchQuery('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedStation || !destLat || !destName) {
      setError('Please select a station and destination');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const ride = await ridesApi.create({
        station_id: selectedStation.id,
        dest_lat: destLat,
        dest_lng: destLng,
        dest_name: destName,
        arrival_time: new Date(arrivalTime).toISOString(),
        flight_train_number: flightTrain || null,
        ride_type: rideType,
        match_window_minutes: matchWindowMinutes,
      });
      if (rideType === 'shared') {
        navigate(`/ride/${ride.id}/matching`);
      } else {
        navigate(`/ride/${ride.id}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredDests = searchQuery
    ? POPULAR_DESTINATIONS.filter((d) => d.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : POPULAR_DESTINATIONS;

  const mapCenter = selectedStation
    ? [selectedStation.latitude, selectedStation.longitude]
    : [12.97, 77.59];

  return (
    <div className="min-h-screen bg-bg-dark pb-8">
      {/* Header */}
      <header className="glass sticky top-0 z-50 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-text-muted hover:text-text-primary transition-colors text-xl">
            {'\u2190'}
          </button>
          <h1 className="text-lg font-bold">Book a Ride</h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 mt-4">
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-danger/15 text-danger text-sm border border-danger/20">
              {error}
            </div>
          )}

          {/* Station Selection */}
          <div className="animate-fade-in-up">
            <label className="block text-text-secondary text-sm mb-2 font-medium">Arrival Station</label>
            <div className="grid grid-cols-2 gap-2">
              {stationList.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => setSelectedStation(s)}
                  className={`p-3 rounded-xl text-left text-sm transition-all border ${
                    selectedStation?.id === s.id
                      ? 'border-primary bg-primary/10 text-primary-light'
                      : 'border-border bg-bg-surface text-text-secondary hover:border-border'
                  }`}
                >
                  <span className="text-lg mr-1">{s.type === 'airport' ? '\u2708\uFE0F' : '\u{1F689}'}</span>
                  <span className="text-xs">{s.name.split('(')[0].trim()}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Destination Search */}
          <div className="animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
            <label className="block text-text-secondary text-sm mb-2 font-medium">Destination</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search neighbourhood..."
              className="w-full px-4 py-3 rounded-xl bg-bg-surface border border-border text-text-primary focus:border-primary focus:outline-none transition-colors mb-2"
            />
            <div className="flex flex-wrap gap-2 mb-3">
              {filteredDests.slice(0, 8).map((d) => (
                <button
                  type="button"
                  key={d.name}
                  onClick={() => selectDestination(d)}
                  className={`px-3 py-1.5 rounded-full text-xs transition-all border ${
                    destName === d.name
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-border bg-bg-surface text-text-secondary hover:border-primary/50'
                  }`}
                >
                  {d.name}
                </button>
              ))}
            </div>
            {destName && (
              <p className="text-accent text-sm">
                {'\u{1F4CD}'} {destName}
              </p>
            )}
          </div>

          {/* Map */}
          <div className="animate-fade-in-up rounded-2xl overflow-hidden border border-border" style={{ animationDelay: '0.1s', height: '250px' }}>
            <MapContainer center={mapCenter} zoom={11} style={{ height: '100%', width: '100%' }} zoomControl={false}>
              <TileLayer
                attribution='&copy; OpenStreetMap'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              />
              <MapClickHandler onMapClick={handleMapClick} />
              {selectedStation && (
                <Marker position={[selectedStation.latitude, selectedStation.longitude]}>
                  <Popup>{selectedStation.name}</Popup>
                </Marker>
              )}
              {destLat && destLng && (
                <Marker position={[destLat, destLng]} icon={destIcon}>
                  <Popup>{destName}</Popup>
                </Marker>
              )}
            </MapContainer>
          </div>

          {/* Arrival Time + Flight */}
          <div className="grid grid-cols-2 gap-3 animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
            <div>
              <label className="block text-text-secondary text-sm mb-2 font-medium">Arrival Time</label>
              <input
                type="datetime-local"
                value={arrivalTime}
                onChange={(e) => setArrivalTime(e.target.value)}
                className="w-full px-3 py-3 rounded-xl bg-bg-surface border border-border text-text-primary focus:border-primary focus:outline-none transition-colors text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-text-secondary text-sm mb-2 font-medium">Flight/Train #</label>
              <input
                type="text"
                value={flightTrain}
                onChange={(e) => setFlightTrain(e.target.value)}
                placeholder="e.g. 6E-2451"
                className="w-full px-3 py-3 rounded-xl bg-bg-surface border border-border text-text-primary focus:border-primary focus:outline-none transition-colors text-sm"
              />
            </div>
          </div>

          {/* Ride Type */}
          <div className="animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            <label className="block text-text-secondary text-sm mb-2 font-medium">Ride Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRideType('shared')}
                className={`p-4 rounded-2xl border text-center transition-all ${
                  rideType === 'shared'
                    ? 'border-success bg-success/10'
                    : 'border-border bg-bg-surface hover:border-border'
                }`}
              >
                <div className="text-2xl mb-1">{'\u{1F91D}'}</div>
                <p className={`font-semibold text-sm ${rideType === 'shared' ? 'text-success' : 'text-text-primary'}`}>
                  Share & Save
                </p>
                <p className="text-text-muted text-xs mt-1">Split fare with co-travelers</p>
              </button>
              <button
                type="button"
                onClick={() => setRideType('solo')}
                className={`p-4 rounded-2xl border text-center transition-all ${
                  rideType === 'solo'
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-bg-surface hover:border-border'
                }`}
              >
                <div className="text-2xl mb-1">{'\u{1F697}'}</div>
                <p className={`font-semibold text-sm ${rideType === 'solo' ? 'text-primary-light' : 'text-text-primary'}`}>
                  Book Solo
                </p>
                <p className="text-text-muted text-xs mt-1">Private ride, full fare</p>
              </button>
            </div>
          </div>

          {/* Flexible Match Wait Window */}
          {rideType === 'shared' && (
            <div className="animate-fade-in-up" style={{ animationDelay: '0.22s' }}>
              <div className="flex items-center justify-between mb-2">
                <label className="text-text-secondary text-sm font-medium">
                  Wait Window for Co-Travelers
                </label>
                <span className="text-xs text-text-muted">±{matchWindowMinutes} mins</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[10, 15, 20].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setMatchWindowMinutes(mins)}
                    className={`py-2.5 px-2 rounded-xl text-xs font-semibold border transition-all ${
                      matchWindowMinutes === mins
                        ? 'border-accent bg-accent/15 text-accent shadow-sm shadow-accent/20'
                        : 'border-border bg-bg-surface text-text-secondary hover:border-border'
                    }`}
                  >
                    Up to {mins} min
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Instant Fare Estimate Preview */}
          {selectedStation && destLat && destLng && (
            <div className="glass rounded-2xl p-4 animate-fade-in-up border border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-text-secondary text-xs uppercase tracking-wider font-semibold">Route Estimate</span>
                <span className="text-accent text-xs font-medium">~{((Math.hypot((selectedStation.latitude - destLat) * 111, (selectedStation.longitude - destLng) * 111 * Math.cos(destLat * Math.PI / 180)))).toFixed(1)} km</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-text-muted text-xs">Solo Fare</p>
                  <p className="text-text-secondary font-bold text-base">
                    {'\u20B9'}{(50 + Math.hypot((selectedStation.latitude - destLat) * 111, (selectedStation.longitude - destLng) * 111 * Math.cos(destLat * Math.PI / 180)) * 12).toFixed(0)}
                  </p>
                </div>
                {rideType === 'shared' && (
                  <div className="text-right">
                    <p className="text-success text-xs font-semibold">Estimated Shared</p>
                    <p className="text-success font-extrabold text-xl">
                      ~{'\u20B9'}{((50 + Math.hypot((selectedStation.latitude - destLat) * 111, (selectedStation.longitude - destLng) * 111 * Math.cos(destLat * Math.PI / 180)) * 12) * 0.45).toFixed(0)}
                    </p>
                    <span className="text-[10px] text-success/80">Save up to 55%+</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !selectedStation || !destName}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-primary to-primary-dark text-white font-semibold text-lg hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-[0.98] disabled:opacity-40 animate-fade-in-up"
            style={{ animationDelay: '0.25s' }}
          >
            {loading ? 'Creating...' : rideType === 'shared' ? 'Find Co-Travelers' : 'Book Solo Ride'}
          </button>
        </form>
      </div>
    </div>
  );
}
