import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { stations as stationsApi, rides as ridesApi } from '../services/api';

const STATION_ICONS = {
  airport: '\u2708',
  railway: '\u{1F686}',
};

export default function HomePage() {
  const { user, logout } = useAuth();
  const [stationList, setStationList] = useState([]);
  const [myRides, setMyRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([stationsApi.list(), ridesApi.my()])
      .then(([s, r]) => { setStationList(s); setMyRides(r); })
      .finally(() => setLoading(false));
  }, []);

  const statusColors = {
    pending: 'status-pending',
    matched: 'status-matched',
    confirmed: 'status-confirmed',
    on_trip: 'status-on_trip',
    completed: 'status-completed',
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-dark">
        <div className="w-10 h-10 rounded-full border-3 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-dark pb-24">
      {/* Header */}
      <header className="glass sticky top-0 z-50 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-sm font-bold">
              A
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary">ArriveShare</h1>
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

      <div className="max-w-lg mx-auto px-4 mt-6">
        {/* Welcome Card */}
        <div className="glass rounded-3xl p-6 mb-6 animate-fade-in-up">
          <h2 className="text-xl font-semibold mb-1">
            Hello, {user?.name?.split(' ')[0]}!
          </h2>
          <p className="text-text-secondary text-sm mb-4">
            Just arrived? Find co-travelers and split the fare.
          </p>
          <button
            onClick={() => navigate('/ride/new')}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-primary to-primary-dark text-white font-semibold text-lg hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-[0.98]"
          >
            + Book a Ride
          </button>
        </div>

        {/* Select Station */}
        <h3 className="text-text-muted text-xs uppercase tracking-wider font-semibold mb-3">Stations</h3>
        <div className="grid grid-cols-2 gap-3 mb-8 stagger">
          {stationList.map((station) => (
            <button
              key={station.id}
              onClick={() => navigate(`/ride/new?station=${station.id}`)}
              className="glass rounded-2xl p-4 text-left hover:bg-bg-card-hover transition-all animate-fade-in-up group"
            >
              <div className="text-2xl mb-2 group-hover:scale-110 transition-transform">
                {station.type === 'airport' ? '\u2708\uFE0F' : '\u{1F689}'}
              </div>
              <p className="text-text-primary text-sm font-medium leading-tight">{station.name}</p>
              <p className="text-text-muted text-xs mt-1 capitalize">{station.type}</p>
            </button>
          ))}
        </div>

        {/* My Rides */}
        {myRides.length > 0 && (
          <>
            <h3 className="text-text-muted text-xs uppercase tracking-wider font-semibold mb-3">Your Rides</h3>
            <div className="space-y-3 stagger">
              {myRides.map((ride) => (
                <button
                  key={ride.id}
                  onClick={() => navigate(
                    ride.status === 'pending' ? `/ride/${ride.id}/matching` : `/ride/${ride.id}`
                  )}
                  className="w-full glass rounded-2xl p-4 text-left hover:bg-bg-card-hover transition-all animate-fade-in-up"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-text-primary font-medium">{ride.dest_name}</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[ride.status] || 'status-pending'}`}>
                      {ride.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-muted">
                      {ride.ride_type === 'shared' ? 'Shared ride' : 'Solo ride'}
                    </span>
                    {ride.shared_fare ? (
                      <span className="text-success font-medium">
                        <span className="line-through text-text-muted mr-2">{'\u20B9'}{ride.solo_fare?.toFixed(0)}</span>
                        {'\u20B9'}{ride.shared_fare.toFixed(0)}
                      </span>
                    ) : ride.solo_fare ? (
                      <span className="text-text-secondary">{'\u20B9'}{ride.solo_fare.toFixed(0)}</span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Driver view link */}
        {user?.role === 'driver' && (
          <button
            onClick={() => navigate('/driver')}
            className="w-full mt-6 py-3 rounded-2xl border border-accent/30 text-accent font-medium hover:bg-accent/5 transition-all"
          >
            Switch to Driver View
          </button>
        )}
      </div>
    </div>
  );
}
