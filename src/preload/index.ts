import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppSettings,
  SessionMeta,
  SystemAudioSource,
  ThemePref,
  TranscribeProgress,
  ValidateKeyResult,
} from '../shared/types';

interface ThemeState {
  pref: ThemePref;
  effective: 'light' | 'dark';
}

const api = {
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:update', patch),
  },
  secrets: {
    hasKey: (): Promise<boolean> => ipcRenderer.invoke('secrets:hasKey'),
    setKey: (key: string): Promise<void> => ipcRenderer.invoke('secrets:setKey', key),
    clearKey: (): Promise<void> => ipcRenderer.invoke('secrets:clearKey'),
    validateKey: (key: string): Promise<ValidateKeyResult> =>
      ipcRenderer.invoke('secrets:validateKey', key),
  },
  audio: {
    systemSources: (): Promise<SystemAudioSource[]> =>
      ipcRenderer.invoke('audio:systemSources'),
  },
  loopback: {
    startPreview: (sinkName: string): Promise<boolean> =>
      ipcRenderer.invoke('loopback:startPreview', sinkName),
    stopPreview: (): Promise<void> => ipcRenderer.invoke('loopback:stopPreview'),
    testRecord: (
      sinkName: string,
      seconds: number,
    ): Promise<{ ok: true; bytes: ArrayBuffer; size: number; rmsMax: number } | { ok: false; error: string }> =>
      ipcRenderer.invoke('loopback:testRecord', { sinkName, seconds }),
    onLevel: (cb: (e: { kind: 'preview' | 'capture'; sessionId?: string; rms: number }) => void) => {
      const listener = (_e: unknown, payload: { kind: 'preview' | 'capture'; sessionId?: string; rms: number }) => cb(payload);
      ipcRenderer.on('loopback:level', listener);
      return () => {
        ipcRenderer.removeListener('loopback:level', listener);
      };
    },
  },
  sessions: {
    list: (): Promise<SessionMeta[]> => ipcRenderer.invoke('sessions:list'),
    get: (id: string): Promise<SessionMeta | null> => ipcRenderer.invoke('sessions:get', id),
    bytes: (id: string): Promise<number> => ipcRenderer.invoke('sessions:bytes', id),
    transcript: (id: string): Promise<string | null> =>
      ipcRenderer.invoke('sessions:transcript', id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('sessions:delete', id),
    exportTranscript: (id: string, defaultName: string) =>
      ipcRenderer.invoke('dialog:exportTranscript', { id, defaultName }),
  },
  theme: {
    get: (): Promise<ThemeState> => ipcRenderer.invoke('theme:get'),
    set: (pref: ThemePref): Promise<ThemeState> => ipcRenderer.invoke('theme:set', pref),
    onChange: (cb: (t: ThemeState) => void) => {
      const listener = (_e: unknown, t: ThemeState) => cb(t);
      ipcRenderer.on('theme:changed', listener);
      return () => {
        ipcRenderer.removeListener('theme:changed', listener);
      };
    },
  },
  recording: {
    start: (id: string, meta: SessionMeta, linuxSinkName?: string): Promise<string> =>
      ipcRenderer.invoke('recording:start', { id, meta, linuxSinkName }),
    chunk: (id: string, data: ArrayBuffer): Promise<void> =>
      ipcRenderer.invoke('recording:chunk', { id, data }),
    heartbeat: (id: string, durationSec: number): Promise<void> =>
      ipcRenderer.invoke('recording:heartbeat', { id, durationSec }),
    stop: (id: string, durationSec: number): Promise<boolean> =>
      ipcRenderer.invoke('recording:stop', { id, durationSec }),
  },
  recovery: {
    onEvent: (cb: (e: { phase: string; [k: string]: unknown }) => void) => {
      const listener = (_e: unknown, payload: { phase: string; [k: string]: unknown }) => cb(payload);
      ipcRenderer.on('recovery:event', listener);
      return () => {
        ipcRenderer.removeListener('recovery:event', listener);
      };
    },
  },
  transcribe: {
    run: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('transcribe:run', id),
    onProgress: (cb: (p: TranscribeProgress) => void) => {
      const listener = (_e: unknown, p: TranscribeProgress) => cb(p);
      ipcRenderer.on('transcribe:progress', listener);
      return () => ipcRenderer.removeListener('transcribe:progress', listener);
    },
  },
  shell: {
    openData: (): Promise<string> => ipcRenderer.invoke('shell:openData'),
  },
  importer: {
    pickFile: (): Promise<string | null> => ipcRenderer.invoke('import:pickFile'),
    fromPath: (sourcePath: string): Promise<string> =>
      ipcRenderer.invoke('import:fromPath', sourcePath),
    getDroppedFilePath: (file: File): string => webUtils.getPathForFile(file),
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggleMaximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    getState: (): Promise<{ maximized: boolean; focused: boolean }> =>
      ipcRenderer.invoke('window:getState'),
    onState: (cb: (s: { maximized: boolean; focused: boolean }) => void) => {
      const listener = (_e: unknown, s: { maximized: boolean; focused: boolean }) => cb(s);
      ipcRenderer.on('window:state', listener);
      return () => {
        ipcRenderer.removeListener('window:state', listener);
      };
    },
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
