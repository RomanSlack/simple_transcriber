import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Levels {
  level: number;
  peak: number;
  rxCount: number;
  lastRms: number;
}

/**
 * Subscribes to native loopback level events (Linux pw-record path).
 * Filter by `kind` (preview vs capture) and optional sessionId.
 */
export function useNativeLevels(active: boolean, kind: 'preview' | 'capture', sessionId?: string): Levels {
  const [levels, setLevels] = useState<Levels>({ level: 0, peak: 0, rxCount: 0, lastRms: 0 });
  const peakRef = useRef(0);
  const peakDecayUntilRef = useRef(0);
  const lastNonZeroRef = useRef(0);
  const decayRafRef = useRef<number | null>(null);
  const rxRef = useRef(0);

  useEffect(() => {
    if (!active) {
      setLevels({ level: 0, peak: 0, rxCount: 0, lastRms: 0 });
      peakRef.current = 0;
      rxRef.current = 0;
      return;
    }
    const off = api.loopback.onLevel((e) => {
      rxRef.current++;
      if (rxRef.current <= 3 || rxRef.current % 60 === 0) {
        console.log('[useNativeLevels] event', rxRef.current, e);
      }
      if (e.kind !== kind) return;
      if (sessionId && e.sessionId && e.sessionId !== sessionId) return;
      // More sensitive perceptual mapping — pull quiet sounds up so the bar
      // visibly moves on normal-volume playback (rms ~0.02..0.2).
      const level = Math.min(1, Math.max(0, (e.rms * 8) ** 0.55));
      const now = performance.now();
      if (level >= peakRef.current) {
        peakRef.current = level;
        peakDecayUntilRef.current = now + 900;
      } else if (now > peakDecayUntilRef.current) {
        peakRef.current = Math.max(level, peakRef.current - 0.015);
      }
      lastNonZeroRef.current = now;
      setLevels({ level, peak: peakRef.current, rxCount: rxRef.current, lastRms: e.rms });
    });

    const decayTick = () => {
      const now = performance.now();
      if (now - lastNonZeroRef.current > 120) {
        setLevels((cur) => {
          const next = Math.max(0, cur.level - 0.04);
          peakRef.current = Math.max(next, peakRef.current - 0.02);
          return { ...cur, level: next, peak: peakRef.current };
        });
      }
      decayRafRef.current = requestAnimationFrame(decayTick);
    };
    decayRafRef.current = requestAnimationFrame(decayTick);

    return () => {
      off();
      if (decayRafRef.current != null) cancelAnimationFrame(decayRafRef.current);
    };
  }, [active, kind, sessionId]);

  return levels;
}
