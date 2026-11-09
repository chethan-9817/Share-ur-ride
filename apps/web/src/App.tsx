import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { GuestOnly, homeFor, RequireAuth } from '@/components/layout/Guards';
import { PageLoader } from '@/components/ui/primitives';
import { refreshSession } from '@/lib/api';
import { useAuth } from '@/store/auth';

// Route-level code splitting keeps the first load small on mobile data.
const Landing = lazy(() => import('@/pages/Landing'));
const Login = lazy(() => import('@/pages/Login'));
const Onboarding = lazy(() => import('@/pages/Onboarding'));
const RiderHome = lazy(() => import('@/pages/rider/RiderHome'));
const BookRide = lazy(() => import('@/pages/rider/BookRide'));
const Rides = lazy(() => import('@/pages/rider/Rides'));
const RideDetail = lazy(() => import('@/pages/rider/RideDetail'));
const SafetyCenter = lazy(() => import('@/pages/SafetyCenter'));
const Profile = lazy(() => import('@/pages/Profile'));
const DriverHome = lazy(() => import('@/pages/driver/DriverHome'));
const DriverOnboard = lazy(() => import('@/pages/driver/DriverOnboard'));
const Earnings = lazy(() => import('@/pages/driver/Earnings'));
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const AdminDrivers = lazy(() => import('@/pages/admin/AdminDrivers'));
const AdminUsers = lazy(() => import('@/pages/admin/AdminUsers'));
const ShareTrip = lazy(() => import('@/pages/ShareTrip'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const DemoSwitch = lazy(() => import('@/pages/DemoSwitch'));

/** "/" is the landing page for guests and the signed-in app shell for everyone else. */
function RootGate() {
  const { ready, user } = useAuth();
  const loc = useLocation();
  if (!ready) return <PageLoader />;
  if (!user) return loc.pathname === '/' ? <Landing /> : <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return (
    <RequireAuth>
      <AppShell />
    </RequireAuth>
  );
}

/** Each role lands on its own dashboard. */
function RoleHome() {
  const user = useAuth((s) => s.user)!;
  return user.role === 'rider' ? <RiderHome /> : <Navigate to={homeFor(user.role)} replace />;
}

const only = (roles: Parameters<typeof RequireAuth>[0]['roles'], el: JSX.Element) => <RequireAuth roles={roles}>{el}</RequireAuth>;

export default function App() {
  const markReady = useAuth((s) => s.markReady);
  useEffect(() => {
    // Restore the session from the httpOnly refresh cookie on first load.
    refreshSession().finally(markReady);
  }, [markReady]);

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/share/:token" element={<ShareTrip />} />
        <Route path="/demo/:as" element={<DemoSwitch />} />
        <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />

        <Route path="/" element={<RootGate />}>
          <Route index element={<RoleHome />} />
          <Route path="book" element={only(['rider'], <BookRide />)} />
          <Route path="rides" element={only(['rider'], <Rides />)} />
          <Route path="rides/:id" element={only(['rider'], <RideDetail />)} />
          <Route path="safety" element={<SafetyCenter />} />
          <Route path="profile" element={<Profile />} />
          <Route path="driver" element={only(['driver'], <DriverHome />)} />
          <Route path="driver/earnings" element={only(['driver'], <Earnings />)} />
          <Route path="driver/onboard" element={<DriverOnboard />} />
          <Route path="admin" element={only(['admin'], <AdminDashboard />)} />
          <Route path="admin/drivers" element={only(['admin'], <AdminDrivers />)} />
          <Route path="admin/users" element={only(['admin'], <AdminUsers />)} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
