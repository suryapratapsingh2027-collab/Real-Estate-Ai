import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { humanize } from '@rea/shared';
import { cn } from '@/utils/cn';

const badgeVariants = cva('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    tone: {
      gray: 'border-slate-200 bg-slate-50 text-slate-700',
      green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      blue: 'border-sky-200 bg-sky-50 text-sky-700',
      amber: 'border-amber-200 bg-amber-50 text-amber-800',
      red: 'border-red-200 bg-red-50 text-red-700',
      violet: 'border-violet-200 bg-violet-50 text-violet-700',
      teal: 'border-teal-200 bg-teal-50 text-teal-700',
    },
  },
  defaultVariants: { tone: 'gray' },
});

export function Badge({ className, tone, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />;
}

type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;
const STATUS_TONES: Record<string, Tone> = {
  NEW: 'gray', QUALIFIED: 'blue', ASSIGNED: 'violet', CONTACTED: 'teal', INTERESTED: 'teal', SITE_VISIT_SCHEDULED: 'amber', NEGOTIATION: 'amber', CONVERTED: 'green', LOST: 'red',
  AVAILABLE: 'green', UNDER_OFFER: 'amber', SOLD: 'gray', RENTED: 'gray', INACTIVE: 'gray', ACTIVE: 'green', BUSY: 'amber', ON_LEAVE: 'gray',
  RECEIVED: 'gray', QUEUED: 'gray', SENT: 'blue', DELIVERED: 'teal', READ: 'green', FAILED: 'red', SKIPPED_NOT_CONFIGURED: 'amber',
  CREATED: 'gray', LINK_SENT: 'blue', IN_PROGRESS: 'violet', COMPLETED: 'green', MISSED: 'amber', EXPIRED: 'gray',
  PENDING: 'amber', DONE: 'green', CANCELLED: 'gray', NOT_CONFIGURED: 'gray', CONFIGURED: 'blue', OK: 'green', ERROR: 'red',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = status === 'SKIPPED_NOT_CONFIGURED' ? 'Not sent (not configured)' : humanize(status);
  return <Badge tone={STATUS_TONES[status] ?? 'gray'} className={className}>{label}</Badge>;
}
