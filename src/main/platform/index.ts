import { desktopCapturer } from 'electron';
import type { SystemAudioSource } from '../../shared/types';

/**
 * Enumerate system-audio sources that require a main-process / native API.
 * Currently only Windows (desktopCapturer for WASAPI loopback) needs this.
 * Linux + macOS expose loopback as ordinary audioinput devices ("Monitor of …"
 * on PipeWire/Pulse, "BlackHole 2ch" on macOS), so the renderer enumerates them
 * via `navigator.mediaDevices.enumerateDevices()` directly.
 */
export async function listSystemAudioSources(): Promise<SystemAudioSource[]> {
  if (process.platform !== 'win32') return [];
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources.map((s) => ({
      id: s.id,
      label: `System Audio (${s.name})`,
      kind: 'loopback',
    }));
  } catch {
    return [];
  }
}
