import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ConnectionState, Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client';
import { Bot, Loader2, Mic, MicOff, PhoneOff, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '@/services/api';
import { errorMessage } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/utils/cn';
import { formatDuration } from '@/utils/format';

type Session = { status: string; customerFirstName: string | null; businessName: string; recordingEnabled: boolean; expiresAt: string };
type TokenRes = { token: string; url: string; roomName: string; expiresAt: string; maxCallMinutes: number };
type Phase = 'idle' | 'mic' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'error';

/** Public page opened from the WhatsApp link: browser-based AI voice call (no phone network). */
export function CallPage() {
  const { code = '' } = useParams();
  const session = useQuery({ queryKey: ['call-session', code], queryFn: () => api<Session>(`/voice/session/${code}`, { auth: false }), retry: false });
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [agentPresent, setAgentPresent] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [consent, setConsent] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const endedByUser = useRef(false);

  useEffect(() => {
    if (phase !== 'connected' && phase !== 'reconnecting') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => () => void roomRef.current?.disconnect(), []);

  const join = useCallback(async () => {
    setError(null);
    endedByUser.current = false;
    setPhase('mic');
    try {
      // Ask for the microphone first so permission errors are explained before connecting.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setPhase('error');
      setError('Microphone access was blocked. Allow microphone access for this site in your browser settings, then try again.');
      return;
    }
    setPhase('connecting');
    try {
      const tok = await api<TokenRes>('/voice/token', { method: 'POST', body: { code, recordingConsent: consent }, auth: false });
      const room = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      roomRef.current = room;
      const isAgent = (p: Participant) => !p.identity.startsWith('customer-');
      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            audioRef.current?.appendChild(el);
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => track.detach().forEach((el) => el.remove()))
        .on(RoomEvent.ParticipantConnected, (p) => isAgent(p) && setAgentPresent(true))
        .on(RoomEvent.ParticipantDisconnected, (p) => isAgent(p) && setAgentPresent(false))
        .on(RoomEvent.ActiveSpeakersChanged, (speakers) => setAgentSpeaking(speakers.some(isAgent)))
        .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsAudioUnlock(!room.canPlaybackAudio))
        .on(RoomEvent.ConnectionStateChanged, (s) => {
          if (s === ConnectionState.Reconnecting) setPhase('reconnecting');
          if (s === ConnectionState.Connected) setPhase('connected');
        })
        .on(RoomEvent.Disconnected, () => {
          setAgentPresent(false);
          setPhase(endedByUser.current ? 'ended' : 'error');
          if (!endedByUser.current) setError('The call was disconnected.');
        });
      await room.connect(tok.url, tok.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setAgentPresent([...room.remoteParticipants.values()].some(isAgent));
      setNeedsAudioUnlock(!room.canPlaybackAudio);
      setStartedAt((s) => s ?? Date.now());
      setPhase('connected');
    } catch (e) {
      setPhase('error');
      setError(errorMessage(e));
    }
  }, [code, consent]);

  const end = async () => {
    endedByUser.current = true;
    await roomRef.current?.disconnect();
    await api('/voice/end', { method: 'POST', body: { code }, auth: false }).catch(() => undefined);
    setPhase('ended');
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(muted);
    setMuted(!muted);
  };

  const s = session.data;
  const expired = s?.status === 'EXPIRED';
  const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) : 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-teal-50 via-background to-sky-50 p-4">
      <Card className="w-full max-w-md p-8 text-center">
        {session.isLoading ? (
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        ) : session.isError || !s ? (
          <><h1 className="text-lg font-semibold">Link not valid</h1><p className="mt-2 text-sm text-muted-foreground">This call link is invalid. Please request a new one on WhatsApp.</p></>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{s.businessName}</p>
            <h1 className="mt-1 text-xl font-semibold">{s.customerFirstName ? `Hi ${s.customerFirstName}!` : 'AI property assistant'}</h1>
            <div className="my-8 flex justify-center">
              <div className={cn('flex h-28 w-28 items-center justify-center rounded-full bg-primary/10 transition-all', agentSpeaking && 'scale-110 bg-primary/20 ring-8 ring-primary/10')}>
                <Bot className={cn('h-12 w-12 text-primary', phase === 'connecting' && 'animate-pulse')} />
              </div>
            </div>
            <p className="mb-1 text-sm font-medium" aria-live="polite">
              {expired && phase === 'idle' ? 'This link has expired' :
                phase === 'idle' ? 'Ready when you are' :
                phase === 'mic' ? 'Waiting for microphone permission…' :
                phase === 'connecting' ? 'Connecting…' :
                phase === 'reconnecting' ? 'Reconnecting…' :
                phase === 'connected' ? (agentPresent ? (agentSpeaking ? 'Assistant is speaking' : 'Listening…') : 'Waiting for the assistant to join…') :
                phase === 'ended' ? 'Call ended. Thank you!' : 'Something went wrong'}
            </p>
            {(phase === 'connected' || phase === 'reconnecting') && <p className="text-xs tabular-nums text-muted-foreground">{formatDuration(elapsed)}</p>}
            {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}

            {phase === 'idle' && !expired && (
              <div className="mt-6 space-y-4">
                {s.recordingEnabled && (
                  <label className="flex items-start gap-2 text-left text-xs text-muted-foreground">
                    <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    I agree that this call may be recorded for quality and follow-up purposes. (Optional — the call works either way.)
                  </label>
                )}
                <Button size="lg" className="w-full" onClick={join}><Mic /> Start voice call</Button>
                <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Secure browser call · uses your microphone, not a phone line</p>
              </div>
            )}
            {(phase === 'connected' || phase === 'reconnecting') && (
              <div className="mt-6 flex justify-center gap-3">
                <Button variant="outline" size="lg" onClick={toggleMute} aria-pressed={muted}>{muted ? <><MicOff /> Unmute</> : <><Mic /> Mute</>}</Button>
                <Button variant="destructive" size="lg" onClick={end}><PhoneOff /> End call</Button>
              </div>
            )}
            {needsAudioUnlock && phase === 'connected' && (
              <Button variant="secondary" className="mt-3" onClick={() => roomRef.current?.startAudio()}>Tap to enable audio</Button>
            )}
            {phase === 'error' && !expired && <Button className="mt-4" onClick={join}><RefreshCw /> Try again</Button>}
          </>
        )}
        <div ref={audioRef} hidden />
      </Card>
    </div>
  );
}
