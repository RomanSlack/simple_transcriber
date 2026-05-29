import { BrowserWindow, IpcMain, dialog, shell, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { transcodeToMp3, getDurationSec } from './ffmpeg';
import { sessionDir } from './storage';
import OpenAI from 'openai';
import {
  closeRecordingSink,
  dataPathForReveal,
  deleteSession,
  insertSession,
  listSessions,
  listSessionsWithBytes,
  openRecordingSink,
  readTranscript,
  sessionBytes,
  updateSession,
  writeRecordingChunk,
  writeMeta,
  getSession,
} from './storage';
import { hasKey, setApiKey, clearApiKey } from './secrets';
import { applyTheme, getEffectiveTheme } from './theme';
import { activeRecordings } from './active';
import { getSettings, updateSettings } from './settings';
import { listSystemAudioSources } from './platform';
import {
  listLinuxSinks,
  startPreview as startLinuxPreview,
  startCapture as startLinuxCapture,
  stopCapture as stopLinuxCapture,
  systemPcmFilename,
  testRecord as testLinuxRecord,
} from './linux-loopback';
import { runTranscription } from './transcribe';
import { beginCancellable, finishCancellable, cancel } from './cancel';
import type {
  AppSettings,
  SessionMeta,
  TranscribeProgress,
  ValidateKeyResult,
} from '../shared/types';

export function registerIpc(ipc: IpcMain) {
  ipc.handle('settings:get', () => getSettings());
  ipc.handle('settings:update', (_e, patch: Partial<AppSettings>) => updateSettings(patch));

  ipc.handle('secrets:hasKey', () => hasKey());
  ipc.handle('secrets:setKey', (_e, key: string) => setApiKey(key));
  ipc.handle('secrets:clearKey', () => clearApiKey());

  ipc.handle('secrets:validateKey', async (_e, key: string): Promise<ValidateKeyResult> => {
    try {
      const client = new OpenAI({ apiKey: key });
      await client.models.list();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipc.handle('audio:systemSources', async () => {
    if (process.platform === 'linux') return listLinuxSinks();
    return listSystemAudioSources();
  });

  // --- Linux native loopback (PipeWire pw-record) ---
  let activePreviewStop: (() => Promise<void>) | null = null;
  ipc.handle('loopback:startPreview', (e, sinkName: string) => {
    console.log('[ipc] loopback:startPreview', sinkName);
    const wc = e.sender;
    if (activePreviewStop) {
      activePreviewStop().catch(() => undefined);
      activePreviewStop = null;
    }
    let sent = 0;
    const { stop } = startLinuxPreview(sinkName, (rms) => {
      sent++;
      if (sent <= 3 || sent % 60 === 0) {
        console.log('[ipc] sending loopback:level rms=', rms.toFixed(4), 'totalSent=', sent);
      }
      if (!wc.isDestroyed()) {
        wc.send('loopback:level', { kind: 'preview', rms });
      }
    });
    activePreviewStop = stop;
    return true;
  });
  ipc.handle('loopback:stopPreview', async () => {
    if (activePreviewStop) {
      await activePreviewStop();
      activePreviewStop = null;
    }
  });

  ipc.handle('loopback:testRecord', async (_e, payload: { sinkName: string; seconds: number }) => {
    // Pause any preview so pw-record isn't doubly active.
    if (activePreviewStop) {
      await activePreviewStop();
      activePreviewStop = null;
    }
    try {
      const r = await testLinuxRecord(payload.sinkName, payload.seconds);
      return {
        ok: true,
        bytes: r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength),
        size: r.bytes.length,
        rmsMax: r.rmsMax,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipc.handle('sessions:list', () => listSessionsWithBytes());
  ipc.handle('sessions:get', (_e, id: string) => getSession(id));
  ipc.handle('sessions:bytes', (_e, id: string) => sessionBytes(id));
  ipc.handle('sessions:transcript', (_e, id: string) => readTranscript(id));
  ipc.handle('sessions:delete', async (_e, id: string) => deleteSession(id));

  ipc.handle(
    'recording:start',
    async (e, payload: { id: string; meta: SessionMeta; linuxSinkName?: string }) => {
      insertSession(payload.meta);
      const filePath = await openRecordingSink(payload.id);
      await writeMeta(payload.meta);
      activeRecordings.add(payload.id);
      if (process.platform === 'linux' && payload.linuxSinkName) {
        const sender = BrowserWindow.fromWebContents(e.sender);
        const pcmPath = systemPcmFilename(sessionDir(payload.id));
        startLinuxCapture(payload.id, payload.linuxSinkName, pcmPath, (rms) => {
          sender?.webContents.send('loopback:level', { kind: 'capture', sessionId: payload.id, rms });
        });
      }
      return filePath;
    },
  );

  ipc.handle('recording:chunk', (_e, payload: { id: string; data: ArrayBuffer }) => {
    writeRecordingChunk(payload.id, new Uint8Array(payload.data));
  });

  ipc.handle('recording:heartbeat', (_e, payload: { id: string; durationSec: number }) => {
    updateSession(payload.id, { durationSec: payload.durationSec });
  });

  ipc.handle(
    'recording:stop',
    async (_e, payload: { id: string; durationSec: number }) => {
      await closeRecordingSink(payload.id);
      if (process.platform === 'linux') {
        await stopLinuxCapture(payload.id);
      }
      updateSession(payload.id, { durationSec: payload.durationSec });
      activeRecordings.delete(payload.id);
      return true;
    },
  );

  ipc.handle('transcribe:run', async (event, sessionId: string) => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    const emit = (p: TranscribeProgress) => {
      sender?.webContents.send('transcribe:progress', p);
    };
    const controller = beginCancellable(sessionId);
    try {
      await runTranscription(sessionId, emit, controller.signal);
      return { ok: true };
    } catch (err) {
      if ((err as any)?.cancelled) return { ok: false, cancelled: true };
      return { ok: false, error: (err as Error).message };
    } finally {
      finishCancellable(sessionId, controller);
      broadcastSessionsChanged();
    }
  });

  ipc.handle('transcribe:cancel', (_e, sessionId: string) => cancel(sessionId));

  ipc.handle('shell:openData', () => shell.openPath(dataPathForReveal()));

  ipc.handle('theme:get', () => getEffectiveTheme());
  ipc.handle('theme:set', (_e, pref: 'system' | 'light' | 'dark') => {
    applyTheme(pref);
    return getEffectiveTheme();
  });

  ipc.handle('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipc.handle('window:toggleMaximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return false;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
    return w.isMaximized();
  });
  ipc.handle('window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close();
  });
  ipc.handle('window:getState', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    return { maximized: w?.isMaximized() ?? false, focused: w?.isFocused() ?? false };
  });
  ipc.handle('app:platform', () => process.platform);
  ipc.handle('app:name', () => app.getName());

  ipc.handle('dialog:exportTranscript', async (_e, payload: { id: string; defaultName: string }) => {
    const transcript = await readTranscript(payload.id);
    if (transcript == null) return { ok: false, error: 'No transcript' };
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: payload.defaultName,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' };
    await fs.writeFile(result.filePath, transcript, 'utf-8');
    return { ok: true, path: result.filePath };
  });

  ipc.handle('dialog:exportAudio', async (_e, payload: { id: string; defaultName: string }) => {
    const mp3 = path.join(sessionDir(payload.id), 'audio.mp3');
    try {
      await fs.access(mp3);
    } catch {
      return { ok: false, error: 'Audio is still being prepared — run or retry transcription first.' };
    }
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: payload.defaultName,
      filters: [{ name: 'MP3 Audio', extensions: ['mp3'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' };
    await fs.copyFile(mp3, result.filePath);
    return { ok: true, path: result.filePath };
  });

  ipc.handle('shell:revealSession', async (_e, id: string) => {
    const dir = sessionDir(id);
    // Highlight the most relevant file if present, else just open the folder.
    for (const name of ['audio.mp3', 'audio.webm']) {
      const f = path.join(dir, name);
      try {
        await fs.access(f);
        shell.showItemInFolder(f);
        return { ok: true };
      } catch {
        /* try next */
      }
    }
    await shell.openPath(dir);
    return { ok: true };
  });

  ipc.handle('import:pickFile', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import audio or video',
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio / Video',
          extensions: [
            'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'webm',
            'mp4', 'mov', 'mkv', 'avi', 'wmv', 'm4v', '3gp',
          ],
        },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipc.handle('import:fromPath', async (_e, sourcePath: string) => {
    const id = newImportSessionId();
    const baseName = path.basename(sourcePath);
    await fs.mkdir(sessionDir(id), { recursive: true });
    const mp3Path = path.join(sessionDir(id), 'audio.mp3');

    const meta: SessionMeta = {
      id,
      createdAt: new Date().toISOString(),
      durationSec: 0,
      model: getSettings().model,
      micLabel: `imported · ${baseName}`,
      systemLabel: null,
      status: 'transcoding',
    };
    // Register the session up-front so it shows in the list as "encoding"
    // immediately — transcoding a long video to mp3 can take minutes, and the
    // user should see it's working rather than staring at an empty list.
    insertSession(meta);
    await writeMeta(meta);
    broadcastSessionsChanged();

    const controller = beginCancellable(id);
    try {
      await transcodeToMp3(sourcePath, mp3Path, controller.signal);
    } catch (err) {
      // Either an unsupported/unreadable file or a user stop — in both cases
      // there's nothing usable yet, so drop the in-progress session.
      await deleteSession(id);
      broadcastSessionsChanged();
      finishCancellable(id, controller);
      // Custom error fields don't survive IPC, so signal a user-cancel by
      // returning null rather than throwing (real failures still throw).
      if (controller.signal.aborted || (err as any)?.name === 'AbortError') {
        return null;
      }
      throw err;
    }
    finishCancellable(id, controller);

    const dur = (await getDurationSec(mp3Path)) ?? 0;
    updateSession(id, { durationSec: dur });
    await writeMeta(getSession(id)!);
    broadcastSessionsChanged();
    return id;
  });
}

function broadcastSessionsChanged() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('sessions:changed');
  }
}

function newImportSessionId(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}_import`;
}
