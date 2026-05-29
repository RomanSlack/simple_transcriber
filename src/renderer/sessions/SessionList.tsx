import React, { useEffect, useMemo, useRef } from 'react';
import { Button } from '../ui/Button';
import { api } from '../api';
import { humanBytes } from '../settings/Settings';
import type { SessionMeta, TranscribeProgress } from '../../shared/types';

interface Props {
  sessions: SessionMeta[];
  activeProgress: TranscribeProgress | null;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  onRetry: (id: string) => void;
  onStop: (id: string) => void;
}

export function SessionList({ sessions, activeProgress, onOpen, onRefresh, onRetry, onStop }: Props) {
  const totalBytes = useMemo(
    () => sessions.reduce((acc, s) => acc + (s.bytesOnDisk ?? 0), 0),
    [sessions],
  );

  // Sessions are newest-first, so when a new one is added (record stop / import)
  // jump the list back to the top to reveal it.
  const scrollRef = useRef<HTMLDivElement>(null);
  const topId = sessions[0]?.id ?? null;
  useEffect(() => {
    if (topId && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [topId]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px', gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Sessions
        </span>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
          <span>{humanBytes(totalBytes)} on disk</span>
          <span style={{ opacity: 0.6 }}>·</span>
          <span>{sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}</span>
        </div>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
        {sessions.length === 0 && (
          <Empty />
        )}
        {sessions.map((s) => (
          <Row
            key={s.id}
            session={s}
            progress={activeProgress && activeProgress.sessionId === s.id ? activeProgress : null}
            onOpen={() => onOpen(s.id)}
            onRetry={() => onRetry(s.id)}
            onStop={() => onStop(s.id)}
            onDelete={async () => {
              await api.sessions.delete(s.id);
              onRefresh();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-faint)', fontSize: 13 }}>
      No recordings yet. Hit record above to start.
    </div>
  );
}

function Row({
  session,
  progress,
  onOpen,
  onRetry,
  onStop,
  onDelete,
}: {
  session: SessionMeta;
  progress: TranscribeProgress | null;
  onOpen: () => void;
  onRetry: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  React.useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 2400);
    return () => clearTimeout(t);
  }, [confirming]);
  const status = session.status;
  // Audio.mp3 exists once a session has been processed at least once, so the
  // download/reveal actions are meaningful for both finished and failed sessions.
  const hasAudio = status === 'done' || status === 'error';
  const processing = status === 'transcoding' || status === 'transcribing';
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 12,
        background: hover ? 'var(--row-hover)' : 'transparent',
        boxShadow: hover ? 'var(--row-hover-inset)' : 'none',
        padding: '11px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        transition: 'background 120ms ease, box-shadow 120ms ease',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {formatDate(session.createdAt)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 3, display: 'flex', gap: 10, fontVariantNumeric: 'tabular-nums' }}>
          <span>{formatDuration(session.durationSec)}</span>
          <span>·</span>
          <span>{session.model}</span>
          {session.bytesOnDisk != null && (
            <>
              <span>·</span>
              <span>{humanBytes(session.bytesOnDisk)}</span>
            </>
          )}
          {progress?.phase === 'transcribing' && progress.total ? (
            <>
              <span>·</span>
              <span>chunk {progress.current}/{progress.total}</span>
            </>
          ) : null}
        </div>
        {status === 'error' && session.error && (
          <div style={{ fontSize: 12, color: 'var(--bad)', marginTop: 5, lineHeight: 1.4 }}>
            {session.error}
          </div>
        )}
      </div>
      <StatusPill status={status} />
      {processing && (
        <Button size="sm" variant="primary" onClick={onStop} title="Stop processing and reset this session">
          Stop
        </Button>
      )}
      {hasAudio && (
        <Button
          size="sm"
          variant={status === 'error' ? 'primary' : 'subtle'}
          onClick={onRetry}
          title={
            status === 'error'
              ? 'Try transcribing again'
              : 'Re-run transcription (replaces the current transcript)'
          }
        >
          {status === 'error' ? 'Retry' : 'Re-run'}
        </Button>
      )}
      {hasAudio && (
        <Button
          size="sm"
          variant="subtle"
          title="Download the recording (mp3)"
          onClick={() => api.sessions.exportAudio(session.id, `${session.id}.mp3`)}
        >
          Audio
        </Button>
      )}
      {hasAudio && (
        <Button
          size="sm"
          variant="subtle"
          title="Show this recording's folder"
          onClick={() => api.sessions.reveal(session.id)}
        >
          Folder
        </Button>
      )}
      <Button size="sm" onClick={onOpen} disabled={status !== 'done'}>Open</Button>
      {!processing && (
        <Button
          size="sm"
          variant="subtle"
          onClick={() => {
            if (confirming) {
              onDelete();
            } else {
              setConfirming(true);
            }
          }}
          style={confirming ? { color: 'var(--bad)' } : undefined}
          title={confirming ? 'Click again to confirm' : 'Delete'}
        >
          {confirming ? 'Delete?' : '×'}
        </Button>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: SessionMeta['status'] }) {
  const map: Record<SessionMeta['status'], { label: string; color: string }> = {
    recording: { label: 'rec', color: 'var(--accent)' },
    transcoding: { label: 'encoding', color: 'var(--warn)' },
    transcribing: { label: 'working', color: 'var(--warn)' },
    done: { label: 'ready', color: 'var(--good)' },
    error: { label: 'error', color: 'var(--bad)' },
  };
  const m = map[status];
  return (
    <span
      style={{
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: m.color,
        padding: '3px 9px 3px 18px',
        borderRadius: 999,
        position: 'relative',
        background: 'color-mix(in srgb, var(--bg) 88%, transparent)',
        boxShadow: 'inset 1.5px 1.5px 3px var(--shadow-dark), inset -1.5px -1.5px 3px var(--shadow-light)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: m.color,
          boxShadow: `0 0 4px ${m.color}`,
        }}
      />
      {m.label}
    </span>
  );
}

function formatDuration(sec: number): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
