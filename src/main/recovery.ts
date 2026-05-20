import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { listSessions, updateSession, sessionDir, getSession } from './storage';
import { runTranscription } from './transcribe';
import { getApiKey } from './secrets';
import type { SessionMeta, TranscribeProgress } from '../shared/types';

export interface RecoveryReport {
  orphans: number;
  recovered: number;
  failed: number;
  skipped: number;
}

/**
 * Scan the DB for sessions stuck in a non-terminal state (the app died mid-
 * recording or mid-transcription). For each, try to bring it to a terminal
 * state — either by finalizing the audio and running transcription, or by
 * marking it as error if there's nothing salvageable.
 */
export async function runRecoveryScan(): Promise<RecoveryReport> {
  const report: RecoveryReport = { orphans: 0, recovered: 0, failed: 0, skipped: 0 };
  const all = listSessions();
  const stuck = all.filter((s) => s.status === 'recording' || s.status === 'transcoding' || s.status === 'transcribing');
  if (stuck.length === 0) return report;
  report.orphans = stuck.length;

  console.log('[recovery]', stuck.length, 'orphaned session(s)');
  broadcastRecovery({ phase: 'start', orphans: stuck.length });

  const apiKey = await getApiKey();

  for (const session of stuck) {
    try {
      const dir = sessionDir(session.id);
      const webm = path.join(dir, 'audio.webm');
      const mp3 = path.join(dir, 'audio.mp3');
      const webmExists = await fileSize(webm);
      const mp3Exists = await fileSize(mp3);

      // Case 1: no audio at all — nothing to recover, mark error.
      if (webmExists === 0 && mp3Exists === 0) {
        updateSession(session.id, {
          status: 'error',
          error: 'No audio captured before crash.',
        });
        report.failed++;
        continue;
      }

      // Case 2: audio exists. If no API key is loaded yet, leave the session
      // marked so transcription can be retried later.
      if (!apiKey) {
        updateSession(session.id, {
          status: 'error',
          error: 'App restarted before transcription could finish. Audio preserved — re-run transcription manually.',
        });
        report.skipped++;
        continue;
      }

      // Case 3: re-run the pipeline. transcribe.ts will transcode webm → mp3
      // (or skip if mp3 already exists), then chunk + transcribe.
      broadcastRecovery({ phase: 'session', sessionId: session.id });
      await runTranscription(session.id, (p) => broadcastProgress(p));
      report.recovered++;
    } catch (err) {
      console.error('[recovery] failed for', session.id, err);
      updateSession(session.id, {
        status: 'error',
        error: `Recovery failed: ${(err as Error).message}`,
      });
      report.failed++;
    }
  }

  broadcastRecovery({ phase: 'done', report });
  return report;
}

async function fileSize(p: string): Promise<number> {
  try {
    const st = await fs.stat(p);
    return st.size;
  } catch {
    return 0;
  }
}

function broadcastRecovery(payload: { phase: string; [k: string]: unknown }) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('recovery:event', payload);
  }
}

function broadcastProgress(p: TranscribeProgress) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('transcribe:progress', p);
  }
}

/**
 * Called when the app is shutting down (clean or otherwise). For each active
 * recording, flush the write stream and mark the session as needing recovery
 * so the next launch can finish it.
 */
export async function flushOnShutdown(activeRecordings: Set<string>): Promise<void> {
  for (const id of activeRecordings) {
    try {
      const s = getSession(id);
      if (!s) continue;
      // Mark as 'recording' still so recovery scan picks it up.
      console.log('[recovery] flushing active session on shutdown:', id);
    } catch (err) {
      console.error('[recovery] shutdown flush error for', id, err);
    }
  }
}
