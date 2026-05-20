export type Platform = 'linux' | 'win32' | 'darwin';

export type TranscriptionModel =
  | 'gpt-4o-transcribe'
  | 'gpt-4o-mini-transcribe'
  | 'whisper-1';

export type ThemePref = 'system' | 'light' | 'dark';

export interface AppSettings {
  model: TranscriptionModel;
  workers: number;
  chunkDurationSec: number;
  chunkOverlapSec: number;
  micDeviceId: string | null;
  systemDeviceId: string | null;
  micDeviceLabel: string | null;
  systemDeviceLabel: string | null;
  onboardingComplete: boolean;
  theme: ThemePref;
}

export interface SessionMeta {
  id: string;
  createdAt: string;
  durationSec: number;
  model: TranscriptionModel;
  micLabel: string | null;
  systemLabel: string | null;
  status: 'recording' | 'transcoding' | 'transcribing' | 'done' | 'error';
  error?: string;
  bytesOnDisk?: number;
}

export interface StorageSummary {
  totalBytes: number;
  sessionCount: number;
}

export interface TranscribeProgress {
  sessionId: string;
  phase: 'transcoding' | 'chunking' | 'transcribing' | 'saving' | 'done' | 'error';
  current?: number;
  total?: number;
  message?: string;
}

export interface SystemAudioSource {
  id: string;
  label: string;
  kind: 'monitor' | 'loopback' | 'virtual';
}

export interface ValidateKeyResult {
  ok: boolean;
  error?: string;
}
