/**
 * MatchingPage — "Finding co-travelers" experience.
 *
 * Flow:
 *   1. Animated "Searching..." state
 *   2. Calls POST /api/matches/find/:rideId
 *   3. If match found → shows co-travelers, route, fare comparison
 *   4. If no match → offers solo ride fallback
 *   5. Passenger can Accept (confirm) or Decline (rematch)
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { matches as matchApi, rides as ridesApi } from '../services/api';

export default function MatchingPage() {
  const { rideId } = useParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState('searching'); // searching | found | not_found | error
  const [matchResult, setMatchResult] = useState(null);
  const [rideInfo, setRideInfo] = useState(null);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const searchAttempted = useRef(false);

  useEffect(() => {
    if (searchAttempted.current) return;
    searchAttempted.current = true;

    // Load ride details first, then attempt match after a visual delay
    ridesApi.get(rideId).then(setRideInfo).catch(() => {});

    const timer = setTimeout(async () => {
      try {
        const result = await matchApi.find(rideId);
        setMatchResult(result);
        setPhase('found');
      } catch (err) {
        if (err.message.includes('No matches found') || err.message.includes('404')) {
          setPhase('not_found');
        } else if (err.message.includes('already')) {
          // Already matched — load ride to see current state
          try {
            const ride = await ridesApi.get(rideId);
            if (ride.group_id) {
              navigate(`/ride/${rideId}`, { replace: true });
              return;
            }
          } catch (_) {}
          setPhase('not_found');
        } else {
          setError(err.message);
          setPhase('error');
        }
      }
    }, 2000);  // 2s delay for the search animation

    return () => clearTimeout(timer);
  }, [rideId]);

  // ── Action handlers ──

  const handleAccept = async () => {
    setActionLoading(true);
    try {
      await ridesApi.confirm(rideId);
      navigate(`/ride/${rideId}`, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDecline = async () => {
    setActionLoading(true);
    try {
      const result = await matchApi.decline(rideId);
      if (result.status === 'rematched' && result.match) {
        setMatchResult(result.match);
        setPhase('found');
      } else {
        setPhase('not_found');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleBookSolo = async () => {
    setActionLoading(true);
    try {
      await ridesApi.updateStatus(rideId, 'confirmed');
      navigate(`/ride/${rideId}`, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetryMatching = () => {
    setPhase('searching');
    setError('');
    setTimeout(async () => {
      try {
        const result = await matchApi.find(rideId);
        setMatchResult(result);
        setPhase('found');
      } catch (err) {
        if (err.message.includes('No matches found') || err.message.includes('404')) {
          setPhase('not_found');
        } else {
          setError(err.message);
          setPhase('error');
        }
      }
    }, 1500);
  };

  // ── Searching animation ──

  if (phase === 'searching') {
    return (
      <div className="min-h-screen bg-bg-dark flex flex-col items-center justify-center p-6">
        <div className="text-center animate-fade-in-up">
          {/* Radar animation */}
          <div className="relative w-32 h-32 mx-auto mb-8">
            <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-pulse-ring" />
            <div className="absolute inset-3 rounded-full border-2 border-primary/20 animate-pulse-ring" style={{ animationDelay: '0.3s' }} />
            <div className="absolute inset-6 rounded-full border-2 border-primary/15 animate-pulse-ring" style={{ animationDelay: '0.6s' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-3xl">
                🔍
              </div>
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-2">Finding co-travelers...</h2>
          <p className="text-text-secondary text-sm mb-2">
            Looking for passengers heading your way
          </p>
          {rideInfo && (
            <p className="text-accent text-sm">
              📍 {rideInfo.dest_name}
            </p>
          )}
          <div className="mt-6 flex justify-center gap-1">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-2.5 h-2.5 rounded-full bg-primary"
                style={{
                  animation: 'float 1.2s ease-in-out infinite',
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Match Found ──

  if (phase === 'found' && matchResult) {
    return (
      <div className="min-h-screen bg-bg-dark pb-8">
        <header className="glass sticky top-0 z-50 px-4 py-4">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-text-muted hover:text-text-primary transition-colors text-xl">
              ←
            </button>
            <h1 className="text-lg font-bold">Match Found!</h1>
          </div>
        </header>

        <div className="max-w-lg mx-auto px-4 mt-4 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-danger/15 text-danger text-sm border border-danger/20">
              {error}
            </div>
          )}

          {/* Success banner */}
          <div className="glass rounded-3xl p-6 text-center animate-fade-in-up">
            <div className="text-5xl mb-3">🎉</div>
            <h2 className="text-xl font-bold text-success mb-1">{matchResult.message}</h2>
            <p className="text-text-secondary text-sm">
              {matchResult.co_travelers.length} co-travelers heading your way
            </p>
          </div>

          {/* Fare comparison */}
          <div className="glass rounded-3xl p-6 animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
            <h3 className="text-text-muted text-xs uppercase tracking-wider font-semibold mb-4">Fare Comparison</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 rounded-2xl bg-bg-surface border border-border">
                <p className="text-text-muted text-xs mb-1">Solo Ride</p>
                <p className="text-2xl font-bold text-text-secondary line-through">
                  ₹{matchResult.solo_fare?.toFixed(0)}
                </p>
              </div>
              <div className="text-center p-4 rounded-2xl bg-success/10 border border-success/30">
                <p className="text-success text-xs mb-1">Shared Ride</p>
                <p className="text-2xl font-bold text-success">
                  ₹{matchResult.shared_fare?.toFixed(0)}
                </p>
              </div>
            </div>
            <div className="mt-3 text-center">
              <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-success/15 text-success text-sm font-semibold">
                💰 You save {matchResult.savings_pct}%
              </span>
            </div>
          </div>

          {/* Co-travelers */}
          <div className="glass rounded-3xl p-6 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
            <h3 className="text-text-muted text-xs uppercase tracking-wider font-semibold mb-4">Co-Travelers</h3>
            <div className="space-y-3">
              {matchResult.co_travelers.map((t, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-bg-surface">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-lg font-bold">
                    {t.first_name[0]}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-primary">{t.first_name}</span>
                      {t.verified && (
                        <span className="px-1.5 py-0.5 rounded-md bg-success/15 text-success text-[10px] font-semibold">
                          ✓ Verified
                        </span>
                      )}
                    </div>
                    <p className="text-text-muted text-xs">📍 {t.dest_name}</p>
                  </div>
                  <span className="text-text-muted text-sm">
                    Drop #{t.drop_order}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Drop-off route */}
          <div className="glass rounded-3xl p-6 animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
            <h3 className="text-text-muted text-xs uppercase tracking-wider font-semibold mb-4">Route Order</h3>
            <div className="relative pl-6">
              {matchResult.dropoff_order.map((stop, i) => (
                <div key={i} className="relative pb-4 last:pb-0">
                  {/* Vertical line */}
                  {i < matchResult.dropoff_order.length - 1 && (
                    <div className="absolute left-[-18px] top-[24px] w-0.5 h-[calc(100%-8px)] bg-border" />
                  )}
                  {/* Dot */}
                  <div className={`absolute left-[-22px] top-[6px] w-2.5 h-2.5 rounded-full border-2 ${
                    i === 0 ? 'bg-primary border-primary' : i === matchResult.dropoff_order.length - 1 ? 'bg-accent border-accent' : 'bg-bg-dark border-text-muted'
                  }`} />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-text-primary font-medium text-sm">{stop.dest_name}</p>
                      <p className="text-text-muted text-xs">Stop #{stop.order}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-sm">
              <span className="text-text-muted">Total route</span>
              <span className="text-text-primary font-medium">{matchResult.total_route_km} km</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="space-y-3 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            <button
              onClick={handleAccept}
              disabled={actionLoading}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-success to-emerald-600 text-white font-semibold text-lg hover:shadow-xl hover:shadow-success/30 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {actionLoading ? 'Confirming...' : '✓ Accept & Ride Together'}
            </button>
            <button
              onClick={handleDecline}
              disabled={actionLoading}
              className="w-full py-3 rounded-2xl border border-border text-text-secondary font-medium hover:border-warning hover:text-warning transition-all disabled:opacity-50"
            >
              Decline & Find Another Match
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── No match found ──

  if (phase === 'not_found') {
    return (
      <div className="min-h-screen bg-bg-dark flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-4 animate-float">🚕</div>
          <h2 className="text-2xl font-bold mb-2 animate-fade-in-up">No Co-Travelers Yet</h2>
          <p className="text-text-secondary text-sm mb-8 animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
            No one else is heading your way right now.
            <br />You can wait for a match or book a solo ride.
          </p>

          {rideInfo?.solo_fare && (
            <div className="glass rounded-2xl p-4 mb-6 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
              <div className="flex items-center justify-between">
                <span className="text-text-secondary text-sm">Solo fare to {rideInfo.dest_name}</span>
                <span className="text-text-primary font-bold text-lg">₹{rideInfo.solo_fare?.toFixed(0)}</span>
              </div>
            </div>
          )}

          <div className="space-y-3 animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
            <button
              onClick={handleRetryMatching}
              disabled={actionLoading}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-accent to-cyan-600 text-white font-semibold text-lg hover:shadow-xl hover:shadow-accent/25 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              🔄 Try Matching Again
            </button>
            <button
              onClick={handleBookSolo}
              disabled={actionLoading}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-primary to-primary-dark text-white font-semibold hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {actionLoading ? 'Booking...' : 'Book Solo Ride'}
            </button>
            <button
              onClick={() => navigate('/')}
              className="w-full py-3 rounded-2xl border border-border text-text-secondary font-medium hover:border-primary hover:text-primary-light transition-all"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ──

  return (
    <div className="min-h-screen bg-bg-dark flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
        <p className="text-text-secondary text-sm mb-6">{error}</p>
        <button
          onClick={() => navigate('/')}
          className="px-8 py-3 rounded-2xl bg-bg-surface border border-border text-text-primary hover:border-primary transition-all"
        >
          Go Home
        </button>
      </div>
    </div>
  );
}
