import { ArrowRight, Leaf } from 'lucide-react';
import { Link, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/AuthPages';
import RegistrationFlow from './auth/RegistrationFlow';
import { RequireAuth } from './auth/RequireAuth';
import LandingPage from './LandingPage';
import { AdminComingSoonPage, AdminOverview, AdminUsersPage, AccessTrustPage, OrganizationReviewPage } from './dashboard/AdminPages';
import { DashboardFrame, DonorDashboard, NgoDashboard, VolunteerDashboard } from './dashboard/Dashboard';
import { ComingSoonPanel, PageHeader } from './components/ui';
import type { UserRole } from './auth/AuthContext';

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
        <Route path="/dashboard/donor" element={<RequireAuth roles={['donor']} />}><Route index element={<DonorDashboard />} /><Route path="donations" element={<RoleFuturePage role="donor" title="My donations" description="Donation listing and management." features={['Food item and quantity', 'Collection deadline', 'Remaining quantity and status']} />} /><Route path="reservations" element={<RoleFuturePage role="donor" title="Reservation requests" description="Coordinate requests from recipient organizations." features={['Recipient details', 'Requested quantity', 'Pickup progress']} />} /><Route path="history" element={<RoleFuturePage role="donor" title="Donation history" description="Completed, cancelled, and expired food listings." features={['Completed donations', 'Expired listings', 'Delivery history']} />} /><Route path="notifications" element={<RoleFuturePage role="donor" title="Notifications" description="Donor updates from the FoodLoop platform." features={['Organization status', 'Reservation updates', 'Delivery completion']} />} /></Route>
        <Route path="/dashboard/ngo" element={<RequireAuth roles={['ngo']} />}><Route index element={<NgoDashboard />} /><Route path="available" element={<RoleFuturePage role="ngo" title="Browse available food" description="Locality-based food discovery will use real donor listings." features={['City and pincode filters', 'Food category', 'Collection deadline']} />} /><Route path="reservations" element={<RoleFuturePage role="ngo" title="My reservations" description="Reservation requests and their recorded status." features={['Requested quantity', 'Reservation status', 'Donor details']} />} /><Route path="tracking" element={<RoleFuturePage role="ngo" title="Pickup and delivery" description="Track a confirmed pickup when volunteer tasks become available." features={['Pickup details', 'Volunteer assignment', 'Delivery confirmation']} />} /><Route path="history" element={<RoleFuturePage role="ngo" title="Reservation history" description="Previous food pickups and deliveries." features={['Delivered food', 'Cancelled requests', 'Recipient records']} />} /></Route>
        <Route path="/dashboard/volunteer" element={<RequireAuth roles={['volunteer']} />}><Route index element={<VolunteerDashboard />} /><Route path="tasks" element={<RoleFuturePage role="volunteer" title="Assigned tasks" description="Volunteer assignments will appear after donation and pickup workflows exist." features={['Pickup location and deadline', 'Donor and recipient contact', 'OTP verification']} />} /><Route path="history" element={<RoleFuturePage role="volunteer" title="Task history" description="Completed volunteer assignments backed by saved delivery records." features={['Completed tasks', 'Pickup and delivery timestamps']} />} /></Route>
        <Route path="/dashboard/admin" element={<RequireAuth roles={['admin']} />}>
          <Route index element={<AdminOverview />} />
          <Route path="organizations" element={<OrganizationReviewPage />} />
          <Route path="users" element={<AdminUsersPage />} /><Route path="donors" element={<AdminUsersPage />} /><Route path="ngos" element={<AdminUsersPage />} /><Route path="volunteers" element={<AdminUsersPage />} />
          <Route path="trust" element={<AccessTrustPage />} />
          <Route path="donations" element={<AdminComingSoonPage title="Donation management" description="Manage FoodLoop donation listings." features={['Donation review', 'Status management', 'Food safety eligibility']} />} />
          <Route path="reservations" element={<AdminComingSoonPage title="Reservation management" description="Review and track recipient reservations." features={['Partial reservations', 'Status history', 'Over-reservation safeguards']} />} />
          <Route path="tasks" element={<AdminComingSoonPage title="Volunteer task management" description="Manage assigned pickup and delivery tasks." features={['Volunteer assignments', 'Pickup progress', 'OTP delivery checks']} />} />
          <Route path="notifications" element={<AdminComingSoonPage title="Notification operations" description="Monitor real notification queue records when the worker is implemented." features={['Queued messages', 'Retry attempts', 'Delivery failures']} />} />
          <Route path="analytics" element={<AdminComingSoonPage title="Reports and analytics" description="Analytics will appear only when real donation and delivery records exist." features={['Monthly donations', 'Food successfully delivered', 'Locality trends']} />} />
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
