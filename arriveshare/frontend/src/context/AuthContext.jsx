import { createContext, useContext, useState, useEffect } from 'react';
import { auth as authApi } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('arriveshare_token');
    if (token) {
      authApi.me()
        .then(setUser)
        .catch(() => localStorage.removeItem('arriveshare_token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, otp) => {
    const { access_token } = await authApi.verifyOtp(email, otp);
    localStorage.setItem('arriveshare_token', access_token);
    const me = await authApi.me();
    setUser(me);
    return me;
  };

  const register = async (data) => {
    await authApi.register(data);
    await authApi.sendOtp(data.email);
  };

  const logout = () => {
    localStorage.removeItem('arriveshare_token');
    setUser(null);
  };

  // Quick login for demo — use a seeded user
  const demoLogin = async (userId) => {
    const email = `passenger${userId}@arriveshare.test`;
    try {
      await authApi.sendOtp(email);
    } catch (e) { /* user might already exist */ }
    return login(email, '1234');
  };

  const demoDriverLogin = async (driverId) => {
    const email = `driver${driverId}@arriveshare.test`;
    try {
      await authApi.sendOtp(email);
    } catch (e) { /* */ }
    return login(email, '1234');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, demoLogin, demoDriverLogin }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
