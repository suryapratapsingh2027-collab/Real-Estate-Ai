import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError, type Paged } from '@/services/api';

export function usePagedList<T>(key: string, path: string, filters: Record<string, unknown>, pageSize = 20) {
  const [page, setPage] = useState(1);
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    setPage(1);
  }, [filterKey]);
  const query = useQuery({
    queryKey: [key, 'list', filters, page, pageSize],
    queryFn: () => api<Paged<T>>(path, { query: { ...filters, page, pageSize } }),
    placeholderData: keepPreviousData,
  });
  return { ...query, page, setPage };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.details?.length) return `${e.message}: ${e.details.map((d) => `${d.path || 'field'} ${d.message}`).join('; ')}`;
    return e.message;
  }
  return 'Something went wrong';
}

/** Mutation with success/error toasts and query invalidation. */
export function useApiMutation<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, opts: { success?: string; invalidate?: QueryKey[]; onSuccess?: (r: TRes, v: TVars) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      if (opts.success) toast.success(opts.success);
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      opts.onSuccess?.(r, v);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}