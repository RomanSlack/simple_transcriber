import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Surface } from '../ui/Surface';
import { Button } from '../ui/Button';
import { LevelMeter } from '../ui/LevelMeter';
import { RecordButton } from './RecordButton';
import { useLevels } from '../audio/useLevels';
import { useNativeLevels } from '../audio/useNativeLevels';
import { useRecorder } from '../audio/useRecorder';
import { openMicStream, openSystemStream } from '../audio/devices';
import type { AppSettings, SessionMeta, TranscribeProgress } from '../../shared/types';
import { SessionList } from '../sessions/SessionList';
import { DropZone } from './DropZone';
import { useToast } from '../ui/Toast';

interface Props {
  settings: AppSettings;
  onOpenSettings: () => void;
  onOpenTranscript: (id: string) => void;
}

export function Recorder({ settings, onOpenSettings, onOpenTranscript }: Props) {
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [systemStream, setSystemStream] = useState<MediaStream | null>(null);
  const isLinux = api.platform === 'linux';
  const micLevels = useLevels(micStream);
  const sysWebrtcLevels = useLevels(systemStream);
  const { state, elapsedSec, start, stop } = useRecorder();
  // While idle: native preview shows live monitor levels. While recording:
  // capture-kind events drive the meter (same hook works for both because
  // session-id filtering is opt-in).
  const sysNativeLevels = useNativeLevels(
    isLinux && !!settings.systemDeviceId,
    state === 'recording' ? 'capture' : 'preview',
  );
  const sysLevels = isLinux ? sysNativeLevels : sysWebrtcLevels;
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [progress, setProgress] = useState<TranscribeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{ phase: string; [k: string]: unknown } | null>(null);
  const toast = useToast();

  useEffect(() => {
    let mic: MediaStream | null = null;
    let sys: MediaStream | null = null;
    (async () => {
      try {
        if (settings.micDeviceId) {
          mic = await openMicStream(settings.micDeviceId);
          setMicStream(mic);
        }
        if (!isLinux && settings.systemDeviceId) {
          sys = await openSystemStream(settings.systemDeviceId, api.platform as any);
          setSystemStream(sys);
        }
      } catch (err) {
        setError((err as Error).message);
      }
    })();
    return () => {
      mic?.getTracks().forEach((t) => t.stop());
      sys?.getTracks().forEach((t) => t.stop());
    };
  }, [settings.micDeviceId, settings.systemDeviceId, isLinux]);

  // Linux: run a native loopback preview while idle so the bar moves.
  useEffect(() => {
    if (!isLinux || !settings.systemDeviceId) return;
    if (state !== 'idle') return;
    api.loopback.startPreview(settings.systemDeviceId).catch(() => undefined);
    return () => {
      api.loopback.stopPreview().catch(() => undefined);
    };
  }, [isLinux, settings.systemDeviceId, state]);

  useEffect(() => {
    refreshSessions();
    const off = api.transcribe.onProgress((p) => setProgress(p));
    const offRec = api.recovery.onEvent((e) => {
      setRecovery(e);
      // Refresh the list when a recovery operation touches a session.
      refreshSessions();
    });
    return () => {
      off();
      offRec();
    };
  }, []);

  // Periodic heartbeat: update durationSec on disk every 5s while recording so
  // a crash leaves the session with an accurate duration for recovery.
  useEffect(() => {
    if (state !== 'recording') return;
    const id = (window as any).__activeSession as string | undefined;
    if (!id) return;
    const interval = setInterval(() => {
      api.recording.heartbeat(id, elapsedSec).catch(() => undefined);
    }, 5000);
    return () => clearInterval(interval);
  }, [state, elapsedSec]);

  const refreshSessions = async () => {
    setSessions(await api.sessions.list());
  };

  const onRecordClick = async () => {
    if (state === 'recording') {
      await handleStop();
    } else if (state === 'idle') {
      await handleStart();
    }
  };

  const handleStart = async () => {
    setError(null);
    if (!micStream) {
      setError('Microphone is not available. Open Settings to pick a device.');
      return;
    }
    const id = newSessionId();
    const meta: SessionMeta = {
      id,
      createdAt: new Date().toISOString(),
      durationSec: 0,
      model: settings.model,
      micLabel: settings.micDeviceLabel,
      systemLabel: settings.systemDeviceLabel,
      status: 'recording',
    };
    // Stop idle preview so the native capture path can take over for this sink.
    if (isLinux) await api.loopback.stopPreview().catch(() => undefined);
    await api.recording.start(id, meta, isLinux ? settings.systemDeviceId ?? undefined : undefined);
    await refreshSessions();
    await start({
      micStream,
      // On Linux the system audio is captured natively via pw-record in the
      // main process, so we don't pass a system MediaStream here.
      systemStream: isLinux ? null : systemStream,
      sessionId: id,
      onChunk: (data) => api.recording.chunk(id, data),
    });
    (window as any).__activeSession = id;
  };

  const handleStop = async () => {
    const id = (window as any).__activeSession as string | undefined;
    const dur = await stop();
    if (id) {
      await api.recording.stop(id, dur);
      await refreshSessions();
      runTranscribe(id);
    }
  };

  const runTranscribe = (id: string) => {
    api.transcribe.run(id).then((r) => {
      if (!r.ok) {
        setError(r.error ?? 'Transcription failed');
        toast.push(r.error ?? 'Transcription failed', 'error');
      } else {
        toast.push('Transcript ready', 'success');
      }
      refreshSessions();
    });
  };

  const pickImport = async () => {
    setError(null);
    const filePath = await api.importer.pickFile();
    if (!filePath) return;
    try {
      const id = await api.importer.fromPath(filePath);
      await refreshSessions();
      toast.push('Imported · transcribing…', 'info');
      runTranscribe(id);
    } catch (err) {
      setError((err as Error).message);
      toast.push((err as Error).message, 'error');
    }
  };

  return (
    <DropZone
      onImported={async (id) => {
        await refreshSessions();
        runTranscribe(id);
      }}
      onError={(msg) => setError(msg)}
    >
      <Header onSettings={onOpenSettings} onImport={pickImport} />
      {recovery && <RecoveryBanner event={recovery} onDismiss={() => setRecovery(null)} />}
      <Surface size="lg" radius={28} style={{ padding: 26, display: 'flex', alignItems: 'center', gap: 36 }}>
        <LevelMeter level={micLevels.level} peak={micLevels.peak} label="You · Mic" height={200} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <Timer seconds={elapsedSec} active={state === 'recording'} />
          <RecordButton state={state} onClick={onRecordClick} />
          <StatusLine state={state} progress={progress} error={error} />
        </div>
        <LevelMeter level={sysLevels.level} peak={sysLevels.peak} label="Them · System" height={200} />
      </Surface>
      <Surface variant="inset" radius={22} style={{ flex: 1, padding: 18, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <SessionList
          sessions={sessions}
          activeProgress={progress}
          onOpen={onOpenTranscript}
          onRefresh={refreshSessions}
        />
      </Surface>
    </DropZone>
  );
}

function Header({ onSettings, onImport }: { onSettings: () => void; onImport: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '6px 0 0' }}>
      <Button size="sm" onClick={onImport}>⤓ Import file…</Button>
      <Button size="sm" onClick={onSettings}>⚙ Settings</Button>
    </div>
  );
}

function Timer({ seconds, active }: { seconds: number; active: boolean }) {
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
  const ss = Math.floor(seconds % 60).toString().padStart(2, '0');
  return (
    <div
      style={{
        fontVariantNumeric: 'tabular-nums',
        fontSize: 34,
        fontWeight: 600,
        letterSpacing: '-0.03em',
        color: active ? 'var(--accent)' : 'var(--text-dim)',
        transition: 'color 200ms',
      }}
    >
      {mm}:{ss}
    </div>
  );
}

function StatusLine({
  state,
  progress,
  error,
}: {
  state: 'idle' | 'recording' | 'stopping';
  progress: TranscribeProgress | null;
  error: string | null;
}) {
  let text = 'Ready';
  if (state === 'recording') text = 'Recording';
  else if (state === 'stopping') text = 'Finalizing...';
  else if (progress && progress.phase !== 'done' && progress.phase !== 'error') {
    if (progress.phase === 'transcribing' && progress.total) {
      text = `Transcribing ${progress.current ?? 0}/${progress.total}`;
    } else {
      text = progress.message ?? progress.phase;
    }
  }
  return (
    <div style={{ fontSize: 13, color: error ? 'var(--bad)' : 'var(--text-dim)', minHeight: 18 }}>
      {error ?? text}
    </div>
  );
}

function RecoveryBanner({
  event,
  onDismiss,
}: {
  event: { phase: string; [k: string]: unknown };
  onDismiss: () => void;
}) {
  let message: string;
  let kind: 'info' | 'good' = 'info';
  if (event.phase === 'start') {
    message = `Recovering ${event.orphans} unfinished session${(event.orphans as number) === 1 ? '' : 's'} from a previous run…`;
  } else if (event.phase === 'session') {
    message = `Recovering session ${event.sessionId}…`;
  } else if (event.phase === 'done') {
    const r = event.report as { recovered: number; failed: number; skipped: number; orphans: number };
    if (r.orphans === 0) return null;
    message = `Recovery complete · ${r.recovered} recovered${r.failed ? `, ${r.failed} failed` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}.`;
    kind = 'good';
  } else {
    return null;
  }
  return (
    <Surface
      variant="flat"
      radius={14}
      style={{
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 13,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: kind === 'good' ? 'var(--good)' : 'var(--warn)',
          boxShadow: `0 0 8px ${kind === 'good' ? 'var(--good)' : 'var(--warn)'}88`,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, color: 'var(--text)' }}>{message}</span>
      {event.phase === 'done' && (
        <Button size="sm" variant="subtle" onClick={onDismiss}>Dismiss</Button>
      )}
    </Surface>
  );
}

function newSessionId(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
