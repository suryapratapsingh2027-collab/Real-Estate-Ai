import { lazy, Suspense } from 'react';
import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import type { Permission } from '@rea/shared';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/layouts/AppLayout';
import { EmptyState } from '@/components/ui/feedback';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { PropertiesPage } from '@/pages/properties/PropertiesPage';
import { PropertyFormPage } from '@/pages/properties/PropertyFormPage';
import { PropertyDetailsPage } from '@/pages/properties/PropertyDetailsPage';
import { BrokersPage } from '@/pages/brokers/BrokersPage';
import { BrokerDetailsPage } from '@/pages/brokers/BrokerDetailsPage';
import { CustomersPage } from '@/pages/customers/CustomersPage';
import { CustomerDetailsPage } from '@/pages/customers/CustomerDetailsPage';
import { LeadsPage } from '@/pages/leads/LeadsPage';
import { LeadDetailsPage } from '@/pages/leads/LeadDetailsPage';
import { ConversationsPage } from '@/pages/conversations/ConversationsPage';
import { VoiceCallsPage } from '@/pages/calls/VoiceCallsPage';
import { VoiceCallDetailsPage } from '@/pages/calls/VoiceCallDetailsPage';
import { FollowUpsPage } from '@/pages/FollowUpsPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { BusinessSettingsPage } from '@/pages/settings/BusinessSettingsPage';
import { AiSettingsPage } from '@/pages/settings/AiSettingsPage';
import { IntegrationSettingsPage } from '@/pages/settings/IntegrationSettingsPage';
import { UsersPage } from '@/pages/admin/UsersPage';
import { AuditLogsPage } from '@/pages/admin/AuditLogsPage';
import { ProfilePage } from '@/pages/ProfilePage';
// Customer call page is lazy-loaded so staff never download the LiveKit client unnecessarily.
const CallPage = lazy(() => import('@/pages/CallPage').then((m) => ({ default: m.CallPage })));

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** UI-level guard only; the API enforces every permission independently. */
export function Guard({ perm, children }: { perm: Permission; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <EmptyState title="Access denied" description="Your role does not have access to this page." />;
  return <>{children}</>;
}

const g = (perm: Permission, el: React.ReactNode) => <Guard perm={perm}>{el}</Guard>;

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/call/:code', element: <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}><CallPage /></Suspense> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: g('dashboard:read', <DashboardPage />) },
          { path: 'analytics', element: g('analytics:read', <AnalyticsPage />) },
          { path: 'properties', element: g('property:read', <PropertiesPage />) },
          { path: 'properties/new', element: g('property:write', <PropertyFormPage />) },
          { path: 'properties/:id', element: g('property:read', <PropertyDetailsPage />) },
          { path: 'properties/:id/edit', element: g('property:write', <PropertyFormPage />) },
          { path: 'brokers', element: g('broker:read', <BrokersPage />) },
          { path: 'brokers/:id', element: g('broker:read', <BrokerDetailsPage />) },
          { path: 'customers', element: g('customer:read', <CustomersPage />) },
          { path: 'customers/:id', element: g('customer:read', <CustomerDetailsPage />) },
          { path: 'leads', element: g('lead:read', <LeadsPage />) },
          { path: 'leads/:id', element: g('lead:read', <LeadDetailsPage />) },
          { path: 'conversations', element: g('conversation:read', <ConversationsPage />) },
          { path: 'conversations/:id', element: g('conversation:read', <ConversationsPage />) },
          { path: 'calls', element: g('call:read', <VoiceCallsPage />) },
          { path: 'calls/:id', element: g('call:read', <VoiceCallDetailsPage />) },
          { path: 'follow-ups', element: g('followup:read', <FollowUpsPage />) },
          { path: 'notifications', element: g('notification:read', <NotificationsPage />) },
          { path: 'settings/business', element: g('settings:business', <BusinessSettingsPage />) },
          { path: 'settings/ai', element: g('settings:business', <AiSettingsPage />) },
          { path: 'settings/integrations', element: g('settings:business', <IntegrationSettingsPage />) },
          { path: 'users', element: g('user:manage', <UsersPage />) },
          { path: 'audit-logs', element: g('audit:read', <AuditLogsPage />) },
          { path: 'profile', element: <ProfilePage /> },
          { path: '*', element: <EmptyState title="Page not found" /> },
        ],
      },
    ],
  },
]);
