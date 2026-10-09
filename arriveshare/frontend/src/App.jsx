import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import RideRequestPage from './pages/RideRequestPage';
import MatchingPage from './pages/MatchingPage';
import TripPage from './pages/TripPage';
import DriverDashboard from './pages/DriverDashboard';
import './index.css';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-dark">
      <div className="text-center">
        <div className="w-12 h-12 rounded-full border-3 border-primary border-t-transparent animate-spin mx-auto mb-4" />
        <p className="text-text-secondary">Loading ArriveShare...</p>
      </div>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path="/ride/new" element={<ProtectedRoute><RideRequestPage /></ProtectedRoute>} />
      <Route path="/ride/:rideId/matching" element={<ProtectedRoute><MatchingPage /></ProtectedRoute>} />
      <Route path="/ride/:rideId" element={<ProtectedRoute><TripPage /></ProtectedRoute>} />
      <Route path="/driver" element={<ProtectedRoute><DriverDashboard /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
