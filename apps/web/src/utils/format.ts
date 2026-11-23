import { humanize } from '@rea/shared';

export { humanize };

export function formatINR(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(2).replace(/\.?0+$/, '')} L`;
  return `₹${v.toLocaleString('en-IN')}`;
}

export function formatDate(d: string | Date | null | undefined, withTime = true): string {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('en-IN', withTime ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: 'numeric' });
}

export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(d, false);
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
