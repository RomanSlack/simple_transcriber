import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Surface } from '../ui/Surface';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { Input } from '../ui/Input';
import {
  AudioInput,
  ensurePermission,
  findBlackHole,
  listAudioInputs,
} from '../audio/devices';
import type { AppSettings, SystemAudioSource, ThemePref, TranscriptionModel } from '../../shared/types';

interface Props {
  settings: AppSettings;
  onClose: () => void;
}

const MODEL_OPTIONS: { value: TranscriptionModel; label: string }[] = [
  { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe (recommended)' },
  { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe (cheap)' },
  { value: 'whisper-1', label: 'whisper-1 (legacy)' },
];

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function Settings({ settings, onClose }: Props) {
  const [s, setS] = useState<AppSettings>(settings);
  const [mics, setMics] = useState<AudioInput[]>([]);
  const [sysSources, setSysSources] = useState<SystemAudioSource[]>([]);
  const [inputs, setInputs] = useState<AudioInput[]>([]);
  const [newKey, setNewKey] = useState('');
  const [keyMsg, setKeyMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await ensurePermission();
      setMics(await listAudioInputs());
      setInputs(await listAudioInputs());
      setSysSources(await api.audio.systemSources());
    })();
  }, []);

  const save = async () => {
    await api.settings.update({
      model: s.model,
      workers: s.workers,
      chunkDurationSec: s.chunkDurationSec,
      chunkOverlapSec: s.chunkOverlapSec,
      micDeviceId: s.micDeviceId,
      micDeviceLabel: s.micDeviceLabel,
      systemDeviceId: s.systemDeviceId,
      systemDeviceLabel: s.systemDeviceLabel,
    });
    onClose();
  };

  const platform = api.platform as string;
  const sysOptions =
    platform === 'darwin'
      ? inputs.map((i) => ({ value: i.deviceId, label: i.label }))
      : sysSources.map((x) => ({ value: x.id, label: x.label }));

  const rotateKey = async () => {
    if (!newKey) return;
    setKeyMsg('Validating…');
    const r = await api.secrets.validateKey(newKey);
    if (!r.ok) {
      setKeyMsg(`Invalid: ${r.error}`);
      return;
    }
    await api.secrets.setKey(newKey);
    setNewKey('');
    setKeyMsg('Key saved.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, padding: '2px 2px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button size="sm" onClick={onClose}>← Back</Button>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Settings</span>
        </div>
        <Button size="sm" variant="primary" onClick={save}>Save</Button>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          // Leave room for card shadows on the right and a touch of bottom padding.
          padding: '8px 14px 16px 6px',
          margin: '-8px -14px 0 -6px',
        }}
      >
      <Surface size="sm" radius={18} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SectionTitle>Transcription</SectionTitle>
        <Dropdown
          label="Model"
          value={s.model}
          onChange={(v) => setS({ ...s, model: v as TranscriptionModel })}
          options={MODEL_OPTIONS}
        />
        <div style={{ display: 'flex', gap: 14 }}>
          <Input
            label="Workers"
            type="number"
            min={1}
            max={16}
            value={s.workers}
            onChange={(e) => setS({ ...s, workers: Math.max(1, Number(e.target.value) || 1) })}
          />
          <Input
            label="Chunk seconds"
            type="number"
            min={30}
            max={3600}
            value={s.chunkDurationSec}
            onChange={(e) => setS({ ...s, chunkDurationSec: Math.max(30, Number(e.target.value) || 600) })}
          />
          <Input
            label="Overlap seconds"
            type="number"
            min={0}
            max={30}
            value={s.chunkOverlapSec}
            onChange={(e) => setS({ ...s, chunkOverlapSec: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>
      </Surface>

      <Surface size="sm" radius={18} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SectionTitle>Audio devices</SectionTitle>
        <Dropdown
          label="Microphone"
          value={s.micDeviceId ?? ''}
          onChange={(v) => {
            const l = mics.find((m) => m.deviceId === v)?.label ?? null;
            setS({ ...s, micDeviceId: v, micDeviceLabel: l });
          }}
          options={mics.map((m) => ({ value: m.deviceId, label: m.label }))}
          placeholder="No microphone selected"
          emptyText="No microphones detected"
        />
        <Dropdown
          label={platform === 'darwin' ? 'System audio (BlackHole)' : 'System audio loopback'}
          value={s.systemDeviceId ?? ''}
          onChange={(v) => {
            const l = sysOptions.find((o) => o.value === v)?.label ?? null;
            setS({ ...s, systemDeviceId: v, systemDeviceLabel: l });
          }}
          options={sysOptions}
          placeholder="No source selected"
          emptyText="No loopback sources detected"
        />
        {platform === 'darwin' && !findBlackHole(inputs) && (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--bad)' }}>
            BlackHole not detected. Install from existential.audio/blackhole and configure a Multi-Output Device.
          </p>
        )}
      </Surface>

      <Surface size="sm" radius={18} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SectionTitle>API key</SectionTitle>
        <Input
          label="Replace OpenAI key"
          type="password"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="sk-..."
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button size="sm" onClick={rotateKey} disabled={!newKey}>Save new key</Button>
          <Button
            size="sm"
            variant="subtle"
            onClick={async () => {
              await api.secrets.clearKey();
              setKeyMsg('Key removed.');
            }}
          >
            Remove
          </Button>
          {keyMsg && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{keyMsg}</span>}
        </div>
      </Surface>

      <Surface size="sm" radius={18} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SectionTitle>Appearance</SectionTitle>
        <Dropdown
          label="Theme"
          value={s.theme}
          onChange={async (v) => {
            const pref = v as ThemePref;
            setS({ ...s, theme: pref });
            await api.theme.set(pref);
          }}
          options={THEME_OPTIONS}
        />
      </Surface>

      <StorageCard />

      <Surface size="sm" radius={18} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SectionTitle>Data</SectionTitle>
        <Button size="sm" onClick={() => api.shell.openData()}>Open data folder</Button>
      </Surface>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

function StorageCard() {
  const [stats, setStats] = useState<{ count: number; total: number } | null>(null);
  useEffect(() => {
    api.sessions.list().then((rows) => {
      const total = rows.reduce((acc, r) => acc + (r.bytesOnDisk ?? 0), 0);
      setStats({ count: rows.length, total });
    });
  }, []);
  return (
    <Surface size="sm" radius={18} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionTitle>Storage</SectionTitle>
      <div style={{ display: 'flex', gap: 18, alignItems: 'baseline' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
            {stats ? humanBytes(stats.total) : '—'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>
            On disk
          </div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
            {stats ? stats.count : '—'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>
            Sessions
          </div>
        </div>
      </div>
    </Surface>
  );
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}
