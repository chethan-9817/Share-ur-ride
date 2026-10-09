import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { auth as authApi } from '../services/api';

export default function LoginPage() {
  const [mode, setMode] = useState('login'); // login | register | otp
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, demoLogin, demoDriverLogin } = useAuth();
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.register({ name, email, phone, role: 'passenger' });
      await authApi.sendOtp(email);
      setMode('otp');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.sendOtp(email);
      setMode('otp');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, otp);
      navigate(user.role === 'driver' ? '/driver' : '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (id) => {
    setLoading(true);
    try {
      await demoLogin(id);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDriverDemo = async (id) => {
    setLoading(true);
    try {
      await demoDriverLogin(id);
      navigate('/driver');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-bg-dark relative overflow-hidden">
      {/* Background gradient blobs */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/10 blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-accent/10 blur-[100px]" />

      {/* Logo */}
      <div className="text-center mb-8 animate-fade-in-up relative z-10">
        <div className="inline-flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-2xl font-bold">
            A
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-light to-accent bg-clip-text text-transparent">
            ArriveShare
          </h1>
        </div>
        <p className="text-text-secondary text-sm">Share rides. Save money. Reduce traffic.</p>
      </div>

      {/* Auth Card */}
      <div className="w-full max-w-md glass rounded-3xl p-8 animate-fade-in-up relative z-10" style={{ animationDelay: '0.1s' }}>
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-danger/15 text-danger text-sm border border-danger/20">
            {error}
          </div>
        )}

        {mode === 'login' && (
          <form onSubmit={handleSendOtp}>
            <h2 className="text-xl font-semibold mb-6">Welcome back</h2>
            <div className="mb-4">
              <label className="block text-text-secondary text-sm mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-bg-surface border border-border text-text-primary focus:border-primary focus:outline-none transition-colors"
                placeholder="you@example.com"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-primary-dark text-white font-semibold hover:shadow-lg hover:shadow-primary/25 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Sending OTP...' : 'Send OTP'}
            </button>
            <p className="text-center text-text-muted text-sm mt-4">
              New here?{' '}
              <button type="button" onClick={() => setMode('register')} className="text-primary-light hover:underline">
                Create account
              </button>
            </p>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={handleRegister}>
            <h2 className="text-xl font-semibold mb-6">Create Account</h2>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-text-secondary text-sm mb-2">Full Name</label>
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-bg-surface border border-border text-text-primary focus:border-primary focus:outline-none transition-colors"
                  placeholder="John Doe" required
                />
              </div>
              <div>
                <label className="block text-text-secondary text-sm mb-2">Email</label>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-bg-surface border border-border text-text-primary focus:border-primary focus:outline-none transition-colors"
                  placeholder="you@example.com" required
                />
              </div>
              <div>
                <label className="block text-text-secondary text-sm mb-2">Phone</label>
                <input
                  type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-bg-surface border border-border text-text-primary focus:border-primary focus:outline-none transition-colors"
                  placeholder="+91 98765 43210" required
                />
              </div>
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-primary-dark text-white font-semibold hover:shadow-lg hover:shadow-primary/25 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Account'}
            </button>
            <p className="text-center text-text-muted text-sm mt-4">
              Already have an account?{' '}
              <button type="button" onClick={() => setMode('login')} className="text-primary-light hover:underline">
                Log in
              </button>
            </p>
          </form>
        )}

        {mode === 'otp' && (
          <form onSubmit={handleVerifyOtp}>
            <h2 className="text-xl font-semibold mb-2">Enter OTP</h2>
            <p className="text-text-secondary text-sm mb-6">
              We sent a code to <span className="text-primary-light">{email}</span>
              <br />
              <span className="text-text-muted">(Hint: use 1234)</span>
            </p>
            <input
              type="text" value={otp} onChange={(e) => setOtp(e.target.value)} maxLength={4}
              className="w-full px-4 py-4 rounded-xl bg-bg-surface border border-border text-text-primary text-center text-2xl tracking-[0.5em] focus:border-primary focus:outline-none transition-colors mb-6"
              placeholder="----" required
            />
            <button
              type="submit" disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-primary-dark text-white font-semibold hover:shadow-lg hover:shadow-primary/25 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify & Login'}
            </button>
          </form>
        )}
      </div>

      {/* Demo Quick Login */}
      <div className="w-full max-w-md mt-6 glass rounded-3xl p-6 animate-fade-in-up relative z-10" style={{ animationDelay: '0.2s' }}>
        <p className="text-text-muted text-xs uppercase tracking-wider mb-3 font-semibold">Quick Demo Login</p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[1, 2, 3].map((id) => (
            <button
              key={id}
              onClick={() => handleDemoLogin(id)}
              disabled={loading}
              className="py-2.5 rounded-xl bg-bg-surface border border-border text-text-secondary text-sm hover:border-primary hover:text-primary-light transition-all disabled:opacity-50"
            >
              Passenger {id}
            </button>
          ))}
        </div>
        <button
          onClick={() => handleDriverDemo(1)}
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-bg-surface border border-accent/30 text-accent text-sm hover:border-accent hover:bg-accent/5 transition-all disabled:opacity-50"
        >
          Driver View
        </button>
      </div>
    </div>
  );
}
