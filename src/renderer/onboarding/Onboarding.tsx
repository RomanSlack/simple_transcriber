import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Surface } from '../ui/Surface';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Dropdown } from '../ui/Dropdown';
import { LevelMeter } from '../ui/LevelMeter';
import {
  AudioInput,
  ensurePermission,
  findBlackHole,
  findLinuxMonitors,
  listAudioInputs,
  openMicStream,
  openSystemStream,
} from '../audio/devices';
import { useLevels } from '../audio/useLevels';
import { useNativeLevels } from '../audio/useNativeLevels';
import type { SystemAudioSource } from '../../shared/types';

type Step = 0 | 1 | 2 | 3 | 4;

interface Props {
  onDone: () => void | Promise<void>;
}

export function Onboarding({ onDone }: Props) {
  const [step, setStep] = useState<Step>(0);
  const platform = api.platform;

  const next = () => setStep((s) => Math.min(4, s + 1) as Step);
  const back = () => setStep((s) => Math.max(0, s - 1) as Step);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar step={step} />
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Surface size="lg" radius={28} style={{ width: 620, padding: 36 }}>
          {step === 0 && <Welcome onNext={next} />}
          {step === 1 && <ApiKeyStep onNext={next} onBack={back} />}
          {step === 2 && <MicStep onNext={next} onBack={back} />}
          {step === 3 && <SystemAudioStep platform={platform} onNext={next} onBack={back} />}
          {step === 4 && <DoneStep onDone={onDone} onBack={back} />}
        </Surface>
      </div>
    </div>
  );
}

function TopBar({ step }: { step: Step }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 10, padding: '8px 0 0' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            width: i === step ? 28 : 10,
            height: 6,
            borderRadius: 3,
            background: i <= step ? 'var(--accent)' : 'var(--bg-deep)',
            transition: 'width 200ms ease, background 200ms ease',
          }}
        />
      ))}
    </div>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h1 style={{ margin: 0, fontSize: 30, letterSpacing: '-0.02em' }}>Simple Transcriber</h1>
      <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.55 }}>
        Record meetings — your voice and everyone else's — and get a clean transcript powered by your own OpenAI API key.
        Nothing is sent anywhere we don't tell you about. Let's get you set up in about a minute.
      </p>
      <Footer right={<Button variant="primary" onClick={onNext}>Get started →</Button>} />
    </div>
  );
}

function ApiKeyStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [key, setKey] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.secrets.hasKey().then(setHasExistingKey);
  }, []);

  const submit = async () => {
    if (hasExistingKey && !key) {
      onNext();
      return;
    }
    if (!key) {
      setError('Paste your OpenAI API key.');
      return;
    }
    setBusy(true);
    setError(null);
    const v = await api.secrets.validateKey(key);
    if (!v.ok) {
      setBusy(false);
      setError(v.error ?? 'Could not validate key.');
      return;
    }
    await api.secrets.setKey(key);
    setBusy(false);
    onNext();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StepTitle
        title="OpenAI API key"
        subtitle="Stored in your OS keychain (Keychain / Credential Manager / libsecret) — never on disk in plain text."
      />
      <Input
        label={hasExistingKey ? 'API key (leave blank to keep existing)' : 'API key'}
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="sk-..."
      />
      {error && <ErrorText text={error} />}
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
        Get a key at platform.openai.com → API keys. Make sure billing is enabled.
      </p>
      <Footer
        left={<Button onClick={onBack}>Back</Button>}
        right={
          <Button variant="primary" disabled={busy} onClick={submit}>
            {busy ? 'Validating…' : 'Continue →'}
          </Button>
        }
      />
    </div>
  );
}

function MicStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [devices, setDevices] = useState<AudioInput[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const levels = useLevels(stream);

  useEffect(() => {
    (async () => {
      await ensurePermission();
      const list = await listAudioInputs();
      setDevices(list);
      const initial = list[0]?.deviceId ?? '';
      setSelected(initial);
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    openMicStream(selected).then((s) => {
      if (!active) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      setStream((prev) => {
        prev?.getTracks().forEach((t) => t.stop());
        return s;
      });
    });
    return () => {
      active = false;
    };
  }, [selected]);

  useEffect(
    () => () => {
      stream?.getTracks().forEach((t) => t.stop());
    },
    [stream],
  );

  const save = async () => {
    const label = devices.find((d) => d.deviceId === selected)?.label ?? null;
    await api.settings.update({ micDeviceId: selected, micDeviceLabel: label });
    onNext();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <StepTitle title="Your microphone" subtitle="Say something — the bar should move." />
      <Dropdown
        label="Input device"
        value={selected}
        onChange={(v) => setSelected(v)}
        options={devices.map((d) => ({ value: d.deviceId, label: d.label }))}
        placeholder="No microphone selected"
        emptyText="No microphones detected"
      />
      <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
        <LevelMeter level={levels.level} peak={levels.peak} label="You" orientation="horizontal" height={420} width={28} />
      </div>
      <Footer
        left={<Button onClick={onBack}>Back</Button>}
        right={<Button variant="primary" onClick={save} disabled={!selected}>Continue →</Button>}
      />
    </div>
  );
}

function SystemAudioStep({
  platform,
  onNext,
  onBack,
}: {
  platform: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const [sources, setSources] = useState<SystemAudioSource[]>([]);
  const [inputs, setInputs] = useState<AudioInput[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const webrtcLevels = useLevels(stream);
  const nativeLevels = useNativeLevels(platform === 'linux' && !!selected, 'preview');
  const levels = platform === 'linux' ? nativeLevels : webrtcLevels;

  useEffect(() => {
    (async () => {
      await ensurePermission();
      const [sys, ins] = await Promise.all([api.audio.systemSources(), listAudioInputs()]);
      setSources(sys);
      setInputs(ins);
      if (platform === 'darwin') {
        const bh = findBlackHole(ins);
        if (bh) {
          setSelected(bh.deviceId);
          setSelectedLabel(bh.label);
        }
      } else if (platform === 'linux') {
        // Linux uses the native sink list from main process, not enumerateDevices.
        if (sys[0]) {
          setSelected(sys[0].id);
          setSelectedLabel(sys[0].label);
        }
      } else {
        if (sys[0]) {
          setSelected(sys[0].id);
          setSelectedLabel(sys[0].label);
        }
      }
    })();
  }, [platform]);

  // Stream-based preview for darwin/win32, native preview for linux.
  useEffect(() => {
    if (!selected) return;
    let active = true;
    if (platform === 'linux') {
      api.loopback.startPreview(selected).catch(() => undefined);
      return () => {
        active = false;
        api.loopback.stopPreview().catch(() => undefined);
      };
    }
    openSystemStream(selected, platform as any)
      .then((s) => {
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream((prev) => {
          prev?.getTracks().forEach((t) => t.stop());
          return s;
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [selected, platform]);

  useEffect(
    () => () => {
      stream?.getTracks().forEach((t) => t.stop());
    },
    [stream],
  );

  const save = async () => {
    await api.settings.update({ systemDeviceId: selected, systemDeviceLabel: selectedLabel });
    onNext();
  };

  const options = useMemo(() => {
    if (platform === 'darwin') {
      return inputs.map((d) => ({ value: d.deviceId, label: d.label }));
    }
    // Linux + Windows: use main-process-supplied sources (PipeWire sinks /
    // desktopCapturer screens).
    return sources.map((s) => ({ value: s.id, label: s.label }));
  }, [platform, inputs, sources]);

  const blackHoleMissing = platform === 'darwin' && !findBlackHole(inputs);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <StepTitle
        title="System audio"
        subtitle="Capture whatever your speakers play — your meeting will keep working normally."
      />
      {blackHoleMissing ? (
        <BlackHoleHelp />
      ) : (
        <>
          <Dropdown
            label={platform === 'darwin' ? 'Virtual input (BlackHole)' : 'Loopback source'}
            value={selected}
            onChange={(v) => {
              setSelected(v);
              const o = options.find((o) => o.value === v);
              if (o) setSelectedLabel(o.label);
            }}
            options={options}
            placeholder="No source selected"
            emptyText="No loopback sources detected"
          />
          {platform === 'linux' && (
            <Hint
              text={
                options.length === 0
                  ? "No audio outputs detected. Make sure PipeWire (or PulseAudio) is running — we read the sink list with pw-dump."
                  : "Pick the speaker you actually listen on. We tap its monitor with pw-record — no interruption to playback, the meeting app keeps working normally."
              }
            />
          )}
          {platform === 'win32' && (
            <Hint text="On Windows we tap WASAPI loopback through Chromium's desktopCapturer. Playback is unaffected." />
          )}
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
            <LevelMeter level={levels.level} peak={levels.peak} label="Them" orientation="horizontal" height={420} width={28} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>
            Play any sound (YouTube, a song) to verify the bar moves.
          </p>
          {platform === 'linux' && (
            <>
              <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                debug · events received: {(levels as any).rxCount ?? 0} · last rms: {((levels as any).lastRms ?? 0).toFixed(4)}
              </p>
              <LoopbackTester sinkName={selected} />
            </>
          )}
        </>
      )}
      <Footer
        left={<Button onClick={onBack}>Back</Button>}
        right={
          <Button variant="primary" onClick={save} disabled={blackHoleMissing || !selected}>
            Continue →
          </Button>
        }
      />
    </div>
  );
}

function BlackHoleHelp() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Hint text="macOS doesn't expose loopback natively. We use BlackHole, a free virtual audio driver, to route speaker audio into the app." />
      <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.7 }}>
        <li>
          Install BlackHole 2ch:{' '}
          <a href="https://existential.audio/blackhole/" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
            existential.audio/blackhole
          </a>
        </li>
        <li>Open Audio MIDI Setup → "+" → Create Multi-Output Device → check both your speakers and BlackHole 2ch.</li>
        <li>Set that Multi-Output Device as your system output (in the menu bar).</li>
        <li>Come back here — we'll detect BlackHole automatically.</li>
      </ol>
    </div>
  );
}

function DoneStep({ onDone, onBack }: { onDone: () => void | Promise<void>; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <StepTitle title="You're all set." subtitle="Hit record when you're ready. Both audio sources will be captured." />
      <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6 }}>
        Tip: settings, device re-selection, and your data folder are all under the gear icon in the top right.
      </p>
      <Footer left={<Button onClick={onBack}>Back</Button>} right={<Button variant="primary" onClick={onDone}>Open recorder</Button>} />
    </div>
  );
}

function StepTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 style={{ margin: '0 0 6px 0', fontSize: 22, letterSpacing: '-0.02em' }}>{title}</h2>
      <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 14 }}>{subtitle}</p>
    </div>
  );
}

function Footer({ left, right }: { left?: React.ReactNode; right: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
      <div>{left}</div>
      <div>{right}</div>
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.55, padding: '10px 14px', borderRadius: 12, background: 'var(--bg)', boxShadow: 'inset 3px 3px 6px var(--shadow-dark), inset -3px -3px 6px var(--shadow-light)' }}>
      {text}
    </div>
  );
}

function ErrorText({ text }: { text: string }) {
  return <div style={{ color: 'var(--bad)', fontSize: 13 }}>{text}</div>;
}

function LoopbackTester({ sinkName }: { sinkName: string }) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'ready'>('idle');
  const [count, setCount] = useState(5);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  const startTest = async () => {
    if (!sinkName) return;
    setError(null);
    setInfo(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setPhase('recording');
    setCount(5);
    const tick = setInterval(() => setCount((c) => Math.max(0, c - 1)), 1000);
    try {
      const result = await api.loopback.testRecord(sinkName, 5);
      clearInterval(tick);
      if (!result.ok) {
        setError(result.error);
        setPhase('idle');
        return;
      }
      const blob = new Blob([result.bytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      const silent = result.rmsMax < 0.001;
      setInfo(
        silent
          ? `Captured ${(result.size / 1024).toFixed(0)} KB but it sounds silent (peak rms ${result.rmsMax.toFixed(4)}). Pick a different sink — this one isn't your active speaker output.`
          : `Captured ${(result.size / 1024).toFixed(0)} KB · peak rms ${result.rmsMax.toFixed(4)}. Play it back below.`,
      );
      setPhase('ready');
    } catch (err) {
      clearInterval(tick);
      setError((err as Error).message);
      setPhase('idle');
    }
  };

  return (
    <div
      style={{
        background: 'var(--bg)',
        borderRadius: 14,
        boxShadow:
          'inset 3px 3px 6px var(--shadow-dark), inset -3px -3px 6px var(--shadow-light)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>Speaker capture test</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
            Record 5 s from the selected sink, then play it back so you can hear what we actually grab.
          </div>
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={!sinkName || phase === 'recording'}
          onClick={startTest}
        >
          {phase === 'recording' ? `Recording… ${count}s` : phase === 'ready' ? 'Re-test' : '▶ Record 5s'}
        </Button>
      </div>
      {error && <ErrorText text={error} />}
      {info && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{info}</div>}
      {audioUrl && (
        <audio
          src={audioUrl}
          controls
          style={{
            width: '100%',
            height: 38,
            borderRadius: 10,
          }}
        />
      )}
    </div>
  );
}
