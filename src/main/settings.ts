import Store from 'electron-store';
import type { AppSettings } from '../shared/types';

const defaults: AppSettings = {
  model: 'gpt-4o-transcribe',
  workers: 4,
  chunkDurationSec: 600,
  chunkOverlapSec: 2,
  micDeviceId: null,
  systemDeviceId: null,
  micDeviceLabel: null,
  systemDeviceLabel: null,
  onboardingComplete: false,
  theme: 'system',
};

const store = new Store<AppSettings>({ defaults, name: 'settings' });

export function getSettings(): AppSettings {
  return store.store;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  for (const [k, v] of Object.entries(patch)) {
    (store as any).set(k, v);
  }
  return store.store;
}
