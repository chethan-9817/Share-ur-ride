/**
 * MatchingPage — Real-time co-traveler discovery & accept flow (Milestone 1).
 *
 * Features:
 *   - Live radar connected to backend background auto-matching worker
 *   - Accept countdown window (2 mins) with live progress bar
 *   - Transparent price breakdown (solo vs shared, INR savings, distance share)
 *   - Price Guarantee badge (locked maximum fare protection)
 *   - Race-safe accept & decline transitions
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
  const [secondsRemaining, setSecondsRemaining] = useState(120);

  // Poll for live matching state
  useEffect(() => {
    let isMounted = true;
    ridesApi.get(rideId).then(setRideInfo).catch(() => {});

    const checkMatch = async () => {
      try {
        const result = await matchApi.find(rideId);
        if (isMounted && result && result.group_id) {
          setMatchResult(result);
          setPhase('found');
          if (result.accept_expires_at) {
            const expiry = new Date(result.accept_expires_at).getTime();
            const left = Math.max(0, Math.round((expiry - Date.now()) / 1000));
            setSecondsRemaining(left || 120);
          }
        }
      } catch (err) {
        if (!isMounted) return;
        if (err.message.includes('No matches found') || err.message.includes('404')) {
          // Keep searching in radar mode for background worker to pair candidates
        } else if (err.message.includes('already')) {
          try {
            const ride = await ridesApi.get(rideId);
            if (ride.group_id) {
              navigate(`/ride/${rideId}`, { replace: true });
              return;
            }
          } catch (_) {}
        } else {
          setError(err.message);
        }
      }
    };

    // Immediate check
    checkMatch();

    // Poll every 4 seconds to catch background auto-match updates
    const interval = setInterval(checkMatch, 4000);

    // Timeout searching after 25s if still no match
    const searchTimeout = setTimeout(() => {
      if (isMounted && phase === 'searching') {
        setPhase('not_found');
      }
    }, 25000);

    return () => {
      isMounted = false;
      clearInterval(interval);
      clearTimeout(searchTimeout);
    };
  }, [rideId, phase]);

  // Acceptance window countdown timer
  useEffect(() => {
    if (phase !== 'found' || secondsRemaining <= 0) return;
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setPhase('not_found');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, secondsRemaining]);

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
  };

  const formatCountdown = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // ── Searching animation ──

  if (phase === 'searching') {
    return (
      <div className="min-h-screen bg-bg-dark flex flex-col items-center justify-center p-6">
        <div className="text-center animate-fade-in-up max-w-sm">
          {/* Radar animation */}
          <div className="relative w-32 h-32 mx-auto mb-8">
            <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-pulse-ring" />
            <div className="absolute inset-3 rounded-full border-2 border-primary/20 animate-pulse-ring" style={{ animationDelay: '0.3s' }} />
            <div className="absolute inset-6 rounded-full border-2 border-primary/15 animate-pulse-ring" style={{ animationDelay: '0.6s' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-3xl shadow-lg shadow-primary/30">
                🔍
              </div>
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-2">Scanning Live Arrivals...</h2>
          <p className="text-text-secondary text-sm mb-3">
            Matching with passengers landing within your ±{rideInfo?.match_window_minutes || 20} min window
          </p>
          {rideInfo && (
            <div className="p-3 rounded-xl bg-bg-surface/80 border border-border text-xs text-text-primary mb-4">
              <span className="text-accent font-semibold">📍 Destination:</span> {rideInfo.dest_name}
            </div>
          )}
          <div className="mt-4 flex justify-center gap-1.5">
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
    const savingsInr = matchResult.savings_inr ?? Math.max(0, matchResult.solo_fare - matchResult.shared_fare);

    return (
      <div className="min-h-screen bg-bg-dark pb-8">
        <header className="glass sticky top-0 z-50 px-4 py-4">
          <div className="max-w-lg mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/')} className="text-text-muted hover:text-text-primary transition-colors text-xl">
                ←
              </button>
              <h1 className="text-lg font-bold">Match Discovered!</h1>
            </div>
            {/* Live Acceptance Window Countdown */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning/15 text-warning text-xs font-bold border border-warning/30">
              <span>⏳</span>
              <span>Accept in {formatCountdown(secondsRemaining)}</span>
            </div>
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
            <div className="text-4xl mb-2">🤝</div>
            <h2 className="text-xl font-bold text-success mb-1">
              {matchResult.co_travelers.length} Co-Travelers Ready to Share
            </h2>
            <p className="text-text-secondary text-sm">
              Optimized route avoids detours and cuts your trip cost
            </p>
          </div>

          {/* Fare Comparison Breakdown */}
          <div className="glass rounded-3xl p-6 animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-text-muted text-xs uppercase tracking-wider font-semibold">Fare Breakdown</h3>
              <span className="text-xs text-text-muted">Proportional Split</span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="text-center p-4 rounded-2xl bg-bg-surface border border-border">
                <p className="text-text-muted text-xs mb-1">Solo Quote</p>
                <p className="text-2xl font-bold text-text-secondary line-through">
                  ₹{matchResult.solo_fare?.toFixed(0)}
                </p>
              </div>
              <div className="text-center p-4 rounded-2xl bg-success/10 border border-success/30">
                <p className="text-success text-xs mb-1">Your Share</p>
                <p className="text-2xl font-bold text-success">
                  ₹{matchResult.shared_fare?.toFixed(0)}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-success/15 border border-success/20 flex items-center justify-between text-sm">
              <span className="text-success font-medium">💰 Total Savings:</span>
              <span className="text-success font-bold text-base">
                ₹{savingsInr.toFixed(0)} ({matchResult.savings_pct}%)
              </span>
            </div>

            {matchResult.distance_share_pct && (
              <p className="text-text-muted text-[11px] text-center mt-2.5">
                You contribute {matchResult.distance_share_pct}% towards the total {matchResult.total_route_km} km journey.
              </p>
            )}
          </div>

          {/* Price Guarantee Callout */}
          <div className="p-4 rounded-2xl bg-primary/10 border border-primary/25 flex items-start gap-3 animate-fade-in-up" style={{ animationDelay: '0.08s' }}>
            <span className="text-xl">🔒</span>
            <div>
              <p className="text-text-primary font-semibold text-sm">Price Guarantee Active</p>
              <p className="text-text-secondary text-xs mt-0.5 leading-relaxed">
                ₹{matchResult.shared_fare?.toFixed(0)} is the maximum you will pay. If a co-traveler cancels, ArriveShare absorbs the fare difference.
              </p>
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
                  <span className="text-text-muted text-xs font-semibold px-2 py-1 rounded-lg bg-bg-dark">
                    Drop #{t.drop_order}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Drop-off route */}
          <div className="glass rounded-3xl p-6 animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
            <h3 className="text-text-muted text-xs uppercase tracking-wider font-semibold mb-4">Optimized Drop Sequence</h3>
            <div className="relative pl-6">
              {matchResult.dropoff_order.map((stop, i) => (
                <div key={i} className="relative pb-4 last:pb-0">
                  {i < matchResult.dropoff_order.length - 1 && (
                    <div className="absolute left-[-18px] top-[24px] w-0.5 h-[calc(100%-8px)] bg-border" />
                  )}
                  <div className={`absolute left-[-22px] top-[6px] w-2.5 h-2.5 rounded-full border-2 ${
                    i === 0 ? 'bg-primary border-primary' : i === matchResult.dropoff_order.length - 1 ? 'bg-accent border-accent' : 'bg-bg-dark border-text-muted'
                  }`} />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-text-primary font-medium text-sm">{stop.dest_name}</p>
                      <p className="text-text-muted text-xs">Drop #{stop.order}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-sm">
              <span className="text-text-muted">Total route distance</span>
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
              {actionLoading ? 'Locking Price...' : `✓ Accept & Lock ₹${matchResult.shared_fare?.toFixed(0)}`}
            </button>
            <button
              onClick={handleDecline}
              disabled={actionLoading}
              className="w-full py-3 rounded-2xl border border-border text-text-secondary font-medium hover:border-warning hover:text-warning transition-all disabled:opacity-50"
            >
              Decline & Rematch
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
          <h2 className="text-2xl font-bold mb-2 animate-fade-in-up">No Active Co-Travelers Yet</h2>
          <p className="text-text-secondary text-sm mb-8 animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
            No matching passengers arrived within your window.
            <br />Auto-matching is still running in the background.
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
              🔄 Keep Radar Active
            </button>
            <button
              onClick={handleBookSolo}
              disabled={actionLoading}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-primary to-primary-dark text-white font-semibold hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {actionLoading ? 'Booking...' : 'Book Solo Ride Now'}
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
