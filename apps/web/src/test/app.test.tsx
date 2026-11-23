import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/ui/badge';
import { Pagination } from '@/components/ui/feedback';
import { api, ApiError, tokenStore } from '@/services/api';
import { formatINR, formatDuration } from '@/utils/format';
import { propertyFormSchema } from '@/pages/properties/PropertyFormPage';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('formatting', () => {
  it('formats INR in lakh/crore', () => {
    expect(formatINR(5_800_000)).toBe('₹58 L');
    expect(formatINR(15_500_000)).toBe('₹1.55 Cr');
    expect(formatINR(14000)).toBe('₹14,000');
    expect(formatINR(null)).toBe('—');
    expect(formatDuration(125)).toBe('2:05');
  });
});

describe('StatusBadge', () => {
  it('humanises statuses and explains unsent messages', () => {
    render(<><StatusBadge status="SITE_VISIT_SCHEDULED" /><StatusBadge status="SKIPPED_NOT_CONFIGURED" /></>);
    expect(screen.getByText('Site Visit Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Not sent (not configured)')).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  it('disables prev on first page and calls onPage', async () => {
    const onPage = vi.fn();
    render(<Pagination page={1} totalPages={3} total={45} onPage={onPage} />);
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Next page'));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe('property form validation', () => {
  it('converts empty optional numbers and splits nothing until submit', () => {
    const r = propertyFormSchema.safeParse({ title: 'Nice flat', propertyType: 'APARTMENT', listingType: 'SALE', location: 'Arera', city: 'Bhopal', state: 'MP', price: '5800000', bedrooms: '', area: '', brokerId: '', furnishing: '', amenities: 'Lift, Parking' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.price).toBe(5800000);
      expect(r.data.bedrooms).toBeNull();
      expect(r.data.brokerId).toBeNull();
      expect(r.data.furnishing).toBeNull();
    }
  });
  it('rejects missing required fields and non-positive price', () => {
    const r = propertyFormSchema.safeParse({ title: 'x', propertyType: 'APARTMENT', listingType: 'SALE', location: '', city: '', state: '', price: '0', amenities: '' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toEqual(expect.arrayContaining(['title', 'location', 'city', 'price']));
    }
  });
});

describe('api client', () => {
  beforeEach(() => {
    tokenStore.set('expired');
    vi.restoreAllMocks();
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      calls.push({ url, auth });
      if (url === '/api/auth/refresh') return json(200, { accessToken: 'fresh' });
      return auth === 'Bearer fresh' ? json(200, { ok: true }) : json(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } });
    }));
    await expect(api('/leads')).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual(['/api/leads', '/api/auth/refresh', '/api/leads']);
    expect(tokenStore.get()).toBe('fresh');
  });

  it('surfaces validation errors as ApiError with details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, { error: { code: 'BAD_REQUEST', message: 'Validation failed', details: [{ path: 'price', message: 'Required' }] } })));
    const err = (await api('/properties', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.details?.[0]?.path).toBe('price');
  });
});

describe('Login page', () => {
  it('validates email before calling the API, then signs in', async () => {
    const { AuthProvider } = await import('@/contexts/AuthContext');
    const { LoginPage } = await import('@/pages/LoginPage');
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/refresh') return json(401, {});
      if (url === '/api/auth/login') return json(200, { accessToken: 'tok' });
      if (url === '/api/auth/me') return json(200, { id: '1', email: 'a@b.co', fullName: 'A', role: 'ADMIN', brokerId: null, permissions: [] });
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    wrap(<AuthProvider><LoginPage /></AuthProvider>);
    await userEvent.type(await screen.findByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/invalid email/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/auth/login')).toBe(false);

    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/auth/login')).toBe(true));
  });

  it('shows the server error message on failed login', async () => {
    const { AuthProvider } = await import('@/contexts/AuthContext');
    const { LoginPage } = await import('@/pages/LoginPage');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/auth/login' ? json(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }) : json(401, {}))));
    wrap(<AuthProvider><LoginPage /></AuthProvider>);
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});

describe('Guard', () => {
  it('shows access denied without the permission', async () => {
    const auth = await import('@/contexts/AuthContext');
    vi.spyOn(auth, 'useAuth').mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn(), reload: vi.fn(), can: () => false });
    const { Guard } = await import('@/routes');
    wrap(<Guard perm="user:manage"><p>secret page</p></Guard>);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('secret page')).not.toBeInTheDocument();
  });
});
