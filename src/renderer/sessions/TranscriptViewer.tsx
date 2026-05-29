import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Surface } from '../ui/Surface';
import { Button } from '../ui/Button';
import type { SessionMeta, TranscribeProgress } from '../../shared/types';

interface Props {
  id: string;
  onBack: () => void;
}

export function TranscriptViewer({ id, onBack }: Props) {
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [text, setText] = useState<string>('');
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [progress, setProgress] = useState<TranscribeProgress | null>(null);

  // Live transcription progress for this session, so the re-run overlay can show
  // the current phase / chunk count instead of a static spinner.
  useEffect(() => {
    const off = api.transcribe.onProgress((p) => {
      if (p.sessionId === id) setProgress(p);
    });
    return () => {
      off();
    };
  }, [id]);

  const load = async () => {
    const [m, t] = await Promise.all([api.sessions.get(id), api.sessions.transcript(id)]);
    setMeta(m);
    setText(t ?? '');
  };

  useEffect(() => {
    load();
  }, [id]);

  const rerun = async () => {
    setRerunning(true);
    setExportMsg(null);
    setProgress(null);
    const r = await api.transcribe.run(id);
    if (r.cancelled) {
      await load();
      setExportMsg('Stopped');
    } else if (r.ok) {
      await load();
      setExportMsg('Transcript updated');
    } else {
      setExportMsg(r.error ?? 'Transcription failed');
    }
    setProgress(null);
    setRerunning(false);
  };

  useEffect(() => {
    if (copyState === 'copied') {
      const t = setTimeout(() => setCopyState('idle'), 1600);
      return () => clearTimeout(t);
    }
  }, [copyState]);

  useEffect(() => {
    if (exportMsg) {
      const t = setTimeout(() => setExportMsg(null), 2400);
      return () => clearTimeout(t);
    }
  }, [exportMsg]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button size="sm" onClick={onBack}>← Back</Button>
          <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>{meta?.createdAt ?? ''}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {exportMsg && (
            <span style={{ fontSize: 12, color: 'var(--text-dim)', marginRight: 4 }}>{exportMsg}</span>
          )}
          <Button
            size="sm"
            onClick={rerun}
            disabled={rerunning}
            title="Re-run transcription (replaces this transcript)"
          >
            {rerunning ? 'Re-running…' : 'Re-run AI'}
          </Button>
          <Button
            size="sm"
            variant="subtle"
            title="Show this recording's folder"
            onClick={() => api.sessions.reveal(id)}
          >
            Folder
          </Button>
          <Button
            size="sm"
            variant="subtle"
            title="Download the recording (mp3)"
            onClick={async () => {
              const r = await api.sessions.exportAudio(id, `${id}.mp3`);
              if (r?.ok) setExportMsg('Audio saved');
              else if (r?.error && r.error !== 'cancelled') setExportMsg(r.error);
            }}
          >
            Audio
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopyState('copied');
              } catch {
                setExportMsg('Copy failed');
              }
            }}
            style={
              copyState === 'copied'
                ? { color: 'var(--good)', transition: 'color 200ms ease' }
                : undefined
            }
          >
            {copyState === 'copied' ? '✓ Copied' : 'Copy'}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              const r = await api.sessions.exportTranscript(id, `${id}_transcript.txt`);
              if (r?.ok) setExportMsg(`Saved`);
              else if (r?.error && r.error !== 'cancelled') setExportMsg('Export failed');
            }}
          >
            Export…
          </Button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex' }}>
        <Surface variant="inset" radius={22} style={{ flex: 1, padding: 24, overflow: 'auto' }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.7, color: 'var(--text)', userSelect: 'text' }}>
            {text || '(no transcript yet)'}
          </pre>
        </Surface>
        {rerunning && <RerunOverlay progress={progress} onStop={() => api.transcribe.cancel(id)} />}
      </div>
    </div>
  );
}

function RerunOverlay({ progress, onStop }: { progress: TranscribeProgress | null; onStop: () => void }) {
  const phase = progress?.phase;
  const total = progress?.total ?? 0;
  const current = progress?.current ?? 0;
  const determinate = phase === 'transcribing' && total > 0;
  const pct = determinate ? Math.round((current / total) * 100) : 0;

  let headline = 'Starting…';
  if (phase === 'transcoding') headline = 'Mixing audio…';
  else if (phase === 'chunking') headline = 'Slicing audio into chunks…';
  else if (phase === 'transcribing') {
    headline = total ? `Transcribing chunk ${current} of ${total}…` : 'Transcribing…';
  } else if (phase === 'saving') headline = 'Saving transcript…';
  else if (progress?.message) headline = progress.message;

  return (
    <div
      className="st-fade-in"
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'color-mix(in srgb, var(--bg) 72%, transparent)',
        backdropFilter: 'blur(3px)',
        zIndex: 2,
      }}
    >
      <Surface
        radius={20}
        style={{
          padding: '26px 30px',
          width: 'min(420px, 80%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            className="st-pulse"
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 10px var(--accent)',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Re-running transcription
          </span>
        </div>

        <ProgressBar determinate={determinate} pct={pct} />

        <div style={{ fontSize: 13, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', minHeight: 18 }}>
          {headline}
          {determinate ? `  ·  ${pct}%` : ''}
        </div>

        <div
          style={{
            fontSize: 12,
            color: 'var(--warn)',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            marginTop: 2,
          }}
        >
          <span style={{ fontSize: 14 }}>⚠</span>
          <span>Please keep this window open until it finishes.</span>
        </div>

        <Button size="sm" variant="subtle" onClick={onStop} title="Stop and keep the current transcript">
          Stop
        </Button>
      </Surface>
    </div>
  );
}

function ProgressBar({ determinate, pct }: { determinate: boolean; pct: number }) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: 8,
        borderRadius: 999,
        overflow: 'hidden',
        background: 'color-mix(in srgb, var(--bg) 88%, transparent)',
        boxShadow: 'inset 1.5px 1.5px 3px var(--shadow-dark), inset -1.5px -1.5px 3px var(--shadow-light)',
      }}
    >
      {determinate ? (
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: 999,
            background: 'linear-gradient(90deg, var(--accent-dim), var(--accent))',
            transition: 'width 300ms cubic-bezier(.2,.9,.4,1)',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            top: 0,
            height: '100%',
            width: '40%',
            borderRadius: 999,
            background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
            animation: 'st-indeterminate 1.1s ease-in-out infinite',
          }}
        />
      )}
    </div>
  );
}
