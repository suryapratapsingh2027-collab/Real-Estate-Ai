import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, Bell, Bot, Building2, CalendarClock, ClipboardList, Home, KeyRound, LayoutDashboard, LogOut, Menu, MessageSquare, Phone, Plug, ScrollText, Settings, UserCircle, Users, UsersRound, X,
} from 'lucide-react';
import type { Permission } from '@rea/shared';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtime } from '@/hooks/useRealtime';
import { api } from '@/services/api';
import { cn } from '@/utils/cn';
import { humanize, initials } from '@/utils/format';

type NavItem = { to: string; label: string; icon: typeof Home; perm: Permission };
const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard:read' },
      { to: '/analytics', label: 'Analytics', icon: BarChart3, perm: 'analytics:read' },
    ],
  },
  {
    section: 'CRM',
    items: [
      { to: '/leads', label: 'Leads', icon: ClipboardList, perm: 'lead:read' },
      { to: '/conversations', label: 'Conversations', icon: MessageSquare, perm: 'conversation:read' },
      { to: '/calls', label: 'Voice Calls', icon: Phone, perm: 'call:read' },
      { to: '/follow-ups', label: 'Follow-ups', icon: CalendarClock, perm: 'followup:read' },
      { to: '/customers', label: 'Customers', icon: UsersRound, perm: 'customer:read' },
      { to: '/properties', label: 'Properties', icon: Building2, perm: 'property:read' },
      { to: '/brokers', label: 'Brokers', icon: Users, perm: 'broker:read' },
    ],
  },
  {
    section: 'Settings',
    items: [
      { to: '/settings/business', label: 'Business', icon: Settings, perm: 'settings:business' },
      { to: '/settings/ai', label: 'AI Settings', icon: Bot, perm: 'settings:business' },
      { to: '/settings/integrations', label: 'Integrations', icon: Plug, perm: 'settings:business' },
      { to: '/users', label: 'Users', icon: KeyRound, perm: 'user:manage' },
      { to: '/audit-logs', label: 'Audit Logs', icon: ScrollText, perm: 'audit:read' },
    ],
  },
];

export function AppLayout() {
  const { user, can, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  useRealtime();
  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api<{ unread: number }>('/notifications', { query: { pageSize: 1 } }),
    refetchInterval: 60_000,
    enabled: can('notification:read'),
  });

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <Link to="/" className="flex items-center gap-2 px-2" onClick={() => setMobileOpen(false)}>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Home className="h-4 w-4" />
        </span>
        <span className="text-lg font-semibold tracking-tight">EstateFlow</span>
      </Link>
      {NAV.map((s) => {
        const items = s.items.filter((i) => can(i.perm));
        if (!items.length) return null;
        return (
          <div key={s.section}>
            <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s.section}</p>
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    end={i.to === '/'}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) => cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors', isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-slate-600 hover:bg-secondary hover:text-foreground')}
                  >
                    <i.icon className="h-4 w-4" />
                    {i.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-card lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-card shadow-xl">
            <button className="absolute right-3 top-4" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card/90 px-4 backdrop-blur lg:px-8">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden text-sm text-muted-foreground lg:block">{user && humanize(user.role)} workspace</div>
          <div className="flex items-center gap-3">
            {can('notification:read') && (
              <Link to="/notifications" className="relative rounded-md p-2 hover:bg-secondary" aria-label="Notifications">
                <Bell className="h-5 w-5" />
                {(unread.data?.unread ?? 0) > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">{unread.data!.unread}</span>
                )}
              </Link>
            )}
            <Link to="/profile" className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-secondary">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(user?.fullName)}</span>
              <span className="hidden text-sm font-medium sm:block">{user?.fullName}</span>
              <UserCircle className="h-4 w-4 text-muted-foreground sm:hidden" />
            </Link>
            <button
              className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
