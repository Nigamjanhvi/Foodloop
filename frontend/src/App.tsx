import { ArrowRight, Leaf } from 'lucide-react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/AuthPages';
import RegistrationFlow from './auth/RegistrationFlow';
import { RequireAuth } from './auth/RequireAuth';
import LandingPage from './LandingPage';
import { AdminComingSoonPage, AdminOverview, AdminUsersPage, AccessTrustPage, OrganizationReviewPage } from './dashboard/AdminPages';
import { AdminNotificationMonitorPage } from './notifications/AdminNotificationMonitorPage';
import { AdminAnalyticsPage } from './dashboard/AnalyticsPages';
import { DashboardFrame, DonorDashboard, NgoDashboard, VolunteerDashboard } from './dashboard/Dashboard';
import { ComingSoonPanel, PageHeader } from './components/ui';
import type { UserRole } from './auth/AuthContext';
import { AdminDonationManagementPage, AdminReservationManagementPage, CreateDonationPage, DonorDonationsPage, DonorReservationRequestsPage, DonationDetailsPage, FoodDiscoveryPage, RecipientReservationsPage, ReservationDetailsPage } from './donations/DonationPages';
import { VolunteerAssignmentDetailsPage, VolunteerProfilePage, VolunteerTasksPage } from './assignments/AssignmentPages';
import NotificationPage from './notifications/NotificationPage';

function DashboardRedirect() {
  const { user } = useAuth();
  return <Navigate replace to={`/dashboard/${user!.role}`} />;
}

function RoleFuturePage({ role, title, description, features }: { role: UserRole; title: string; description: string; features: string[] }) {
  return <div className="page-content"><PageHeader eyebrow={`${role.toUpperCase()} WORKSPACE`} title={title} description={description} /><ComingSoonPanel title={title} description="This workflow is planned. No data or activity is fabricated while its API is still unavailable." features={features} /></div>;
}

function AppRoutes() {
  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegistrationFlow />} />
    <Route element={<RequireAuth />}>
      <Route path="/dashboard" element={<DashboardRedirect />} />
      <Route element={<DashboardFrame />}>
        <Route path="/dashboard/donor" element={<RequireAuth roles={['donor']} />}>
          <Route index element={<DonorDashboard />} />
          <Route path="donations" element={<DonorDonationsPage />} />
          <Route path="donations/new" element={<CreateDonationPage />} />
          <Route path="donations/:id" element={<DonationDetailsPage />} />
          <Route path="reservations" element={<DonorReservationRequestsPage />} />
          <Route path="reservations/:id" element={<ReservationDetailsPage />} />
          <Route path="history" element={<DonorDonationsPage historyOnly />} />
          <Route path="notifications" element={<NotificationPage />} />
        </Route>
        <Route path="/dashboard/ngo" element={<RequireAuth roles={['ngo']} />}>
          <Route index element={<NgoDashboard />} />
          <Route path="available" element={<FoodDiscoveryPage />} />
          <Route path="available/:id" element={<DonationDetailsPage />} />
          <Route path="reservations" element={<RecipientReservationsPage />} />
          <Route path="reservations/:id" element={<ReservationDetailsPage />} />
          <Route path="tracking" element={<Navigate replace to="/dashboard/ngo/reservations" />} />
          <Route path="history" element={<RecipientReservationsPage historyOnly />} />
          <Route path="notifications" element={<NotificationPage />} />
        </Route>
        <Route path="/dashboard/volunteer" element={<RequireAuth roles={['volunteer']} />}><Route index element={<VolunteerDashboard />} /><Route path="profile" element={<VolunteerProfilePage />} /><Route path="available" element={<VolunteerTasksPage view="available" />} /><Route path="tasks" element={<VolunteerTasksPage view="active" />} /><Route path="tasks/:id" element={<VolunteerAssignmentDetailsPage />} /><Route path="completed" element={<VolunteerTasksPage view="completed" />} /><Route path="history" element={<VolunteerTasksPage view="all" />} /><Route path="notifications" element={<NotificationPage />} /></Route>
        <Route path="/dashboard/admin" element={<RequireAuth roles={['admin']} />}>
          <Route index element={<AdminOverview />} />
          <Route path="organizations" element={<OrganizationReviewPage />} />
          <Route path="users" element={<AdminUsersPage />} /><Route path="donors" element={<AdminUsersPage />} /><Route path="ngos" element={<AdminUsersPage />} /><Route path="volunteers" element={<AdminUsersPage />} />
          <Route path="trust" element={<AccessTrustPage />} />
          <Route path="activity" element={<NotificationPage />} />
          <Route path="notifications" element={<AdminNotificationMonitorPage />} />
          <Route path="donations" element={<AdminDonationManagementPage />} />
          <Route path="donations/:id" element={<DonationDetailsPage />} />
          <Route path="reservations" element={<AdminReservationManagementPage />} />
          <Route path="reservations/:id" element={<ReservationDetailsPage />} />
          <Route path="tasks" element={<AdminComingSoonPage title="Volunteer task management" description="Manage assigned pickup and delivery tasks." features={['Volunteer assignments', 'Pickup progress', 'OTP delivery checks']} />} />
          <Route path="analytics" element={<AdminAnalyticsPage />} />
          <Route path="devops" element={<AdminComingSoonPage title="DevOps Control Center" description="No CI/CD, AWS, Docker health, or Nagios integration is connected yet." features={['Pipeline status', 'Deployment version', 'Host and service monitoring']} />} />
          <Route path="settings" element={<AdminComingSoonPage title="Platform settings" description="Administrative settings are not implemented yet." features={['Platform configuration', 'Account preferences']} />} />
        </Route>
      </Route>
    </Route>
    <Route path="*" element={<main className="not-found"><div className="not-found-icon"><Leaf /></div><span className="eyebrow">404 · PAGE NOT FOUND</span><h1>This page hasn’t arrived yet.</h1><p>Let’s get you back to the FoodLoop community.</p><Link className="button" to="/">Back to home <ArrowRight size={16} /></Link></main>} />
  </Routes>;
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>;
}
