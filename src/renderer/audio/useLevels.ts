import { useEffect, useRef, useState } from 'react';

interface Levels {
  level: number;
  peak: number;
}

export function useLevels(stream: MediaStream | null): Levels {
  const [levels, setLevels] = useState<Levels>({ level: 0, peak: 0 });
  const peakRef = useRef(0);
  const peakDecayUntilRef = useRef(0);

  useEffect(() => {
    if (!stream) {
      setLevels({ level: 0, peak: 0 });
      peakRef.current = 0;
      return;
    }
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let lastUpdate = 0;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - lastUpdate < 33) return; // ~30fps
      lastUpdate = t;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      // Map RMS to a perceptual 0..1 with a small floor.
      const level = Math.min(1, Math.max(0, (rms * 3.2) ** 0.7));
      const now = performance.now();
      if (level >= peakRef.current) {
        peakRef.current = level;
        peakDecayUntilRef.current = now + 900;
      } else if (now > peakDecayUntilRef.current) {
        peakRef.current = Math.max(level, peakRef.current - 0.015);
      }
      setLevels({ level, peak: peakRef.current });
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      src.disconnect();
      analyser.disconnect();
      ctx.close().catch(() => undefined);
    };
  }, [stream]);

  return levels;
}
