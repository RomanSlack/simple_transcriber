import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'recording' | 'stopping';

interface StartArgs {
  micStream: MediaStream;
  systemStream: MediaStream | null;
  sessionId: string;
  onChunk: (data: ArrayBuffer) => Promise<void>;
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const startTimeRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const stopResolveRef = useRef<((dur: number) => void) | null>(null);

  const tick = useCallback(() => {
    if (startTimeRef.current) {
      setElapsedSec((performance.now() - startTimeRef.current) / 1000);
    }
    tickRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async ({ micStream, systemStream, onChunk }: StartArgs) => {
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const dest = ctx.createMediaStreamDestination();

    const micSrc = ctx.createMediaStreamSource(micStream);
    const micGain = ctx.createGain();
    micGain.gain.value = 1.0;
    micSrc.connect(micGain).connect(dest);

    if (systemStream && systemStream.getAudioTracks().length > 0) {
      const sysSrc = ctx.createMediaStreamSource(systemStream);
      const sysGain = ctx.createGain();
      sysGain.gain.value = 1.0;
      sysSrc.connect(sysGain).connect(dest);
    }

    const mime = pickMime();
    const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined);
    recorderRef.current = rec;

    rec.addEventListener('dataavailable', async (ev) => {
      if (ev.data.size > 0) {
        const buf = await ev.data.arrayBuffer();
        try {
          await onChunk(buf);
        } catch (err) {
          console.error('chunk write failed', err);
        }
      }
    });

    const stopped = new Promise<number>((resolve) => {
      stopResolveRef.current = resolve;
    });
    rec.addEventListener('stop', () => {
      const dur = (performance.now() - startTimeRef.current) / 1000;
      stopResolveRef.current?.(dur);
      stopResolveRef.current = null;
    });

    rec.start(1000); // emit a blob every second
    startTimeRef.current = performance.now();
    setElapsedSec(0);
    setState('recording');
    tickRef.current = requestAnimationFrame(tick);

    return { stopped };
  }, [tick]);

  const stop = useCallback(async (): Promise<number> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return 0;
    setState('stopping');
    const dur = await new Promise<number>((resolve) => {
      stopResolveRef.current = resolve;
      rec.stop();
    });
    if (tickRef.current != null) cancelAnimationFrame(tickRef.current);
    tickRef.current = null;
    ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    recorderRef.current = null;
    setState('idle');
    return dur;
  }, []);

  useEffect(() => {
    return () => {
      if (tickRef.current != null) cancelAnimationFrame(tickRef.current);
      recorderRef.current?.stop();
      ctxRef.current?.close().catch(() => undefined);
    };
  }, []);

  return { state, elapsedSec, start, stop };
}

function pickMime(): string | null {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}
