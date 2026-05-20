export interface AudioInput {
  deviceId: string;
  label: string;
}

export async function ensurePermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

export async function listAudioInputs(): Promise<AudioInput[]> {
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone' }));
}

export function findBlackHole(devices: AudioInput[]): AudioInput | null {
  return devices.find((d) => /blackhole/i.test(d.label)) ?? null;
}

/** Pulse/PipeWire monitor sources surface as audioinput devices with "Monitor of …" labels. */
export function findLinuxMonitors(devices: AudioInput[]): AudioInput[] {
  return devices.filter((d) => /monitor of/i.test(d.label) || /\bmonitor\b/i.test(d.label));
}

export async function openMicStream(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });
}

/**
 * Open the system-audio (loopback) stream.
 * - Linux: deviceId is a WebRTC audioinput deviceId for a Pulse/PipeWire "Monitor of …" source.
 * - Windows: deviceId is the desktopCapturer source id; uses chromeMediaSource.
 * - macOS: deviceId is the BlackHole audioinput deviceId.
 */
export async function openSystemStream(
  deviceId: string,
  platform: 'linux' | 'win32' | 'darwin',
): Promise<MediaStream> {
  if (platform === 'win32') {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: deviceId,
        },
      },
      // Chromium requires asking for video alongside desktop audio; we drop it.
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: deviceId,
        },
      },
    } as any).then((stream) => {
      stream.getVideoTracks().forEach((t) => {
        t.stop();
        stream.removeTrack(t);
      });
      return stream;
    });
  }
  // Linux + macOS: standard input device
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });
}
