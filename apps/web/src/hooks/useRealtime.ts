import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { tokenStore } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';

/** Subscribes to server events and refreshes affected queries. */
export function useRealtime() {
  const { user } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    if (!user) return;
    const socket = io({ path: '/socket.io', auth: (cb) => cb({ token: tokenStore.get() }), transports: ['websocket', 'polling'] });
    socket.on('message:new', (p: { conversationId: string }) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['messages', p.conversationId] });
    });
    socket.on('message:status', (p: { conversationId: string }) => qc.invalidateQueries({ queryKey: ['messages', p.conversationId] }));
    socket.on('lead:updated', (p: { leadId: string }) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead', p.leadId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    });
    socket.on('call:updated', () => qc.invalidateQueries({ queryKey: ['calls'] }));
    socket.on('dashboard:refresh', () => qc.invalidateQueries({ queryKey: ['dashboard'] }));
    socket.on('notification:new', (p: { title: string }) => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast(p.title);
    });
    socket.on('connect_error', () => {
      /* token may have rotated; socket.io retries using the auth callback */
    });
    return () => {
      socket.disconnect();
    };
  }, [user, qc]);
}
