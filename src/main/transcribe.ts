import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import pLimit from 'p-limit';
import fsp from 'node:fs/promises';
import {
  chunkAudio,
  cleanupChunks,
  getDurationSec,
  obsStyleMix,
  transcodeMicToMp3,
  transcodeToMp3,
} from './ffmpeg';
import { getApiKey } from './secrets';
import { friendlyTranscribeError } from './errors';
import { getSettings } from './settings';
import {
  sessionDir,
  updateSession,
  writeTranscript,
  writeMeta,
  getSession,
  deleteSession,
} from './storage';
import type { TranscribeProgress } from '../shared/types';

export type ProgressEmitter = (p: TranscribeProgress) => void;

/** Error subtype thrown when the user stops processing midway. */
export class CancelledError extends Error {
  cancelled = true as const;
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

export async function runTranscription(
  sessionId: string,
  emit: ProgressEmitter,
  signal?: AbortSignal,
): Promise<void> {
  const meta = getSession(sessionId);
  if (!meta) throw new Error(`Session not found: ${sessionId}`);
  // A completed session keeps its existing transcript on disk, so if a re-run is
  // stopped we restore it to "done" rather than flagging a false error.
  const wasDone = meta.status === 'done';

  const key = await getApiKey();
  if (!key) throw new Error('OpenAI API key not set. Open Settings to paste one.');

  const dir = sessionDir(sessionId);
  const webm = path.join(dir, 'audio.webm');
  const systemPcm = path.join(dir, 'system.pcm');
  const mp3 = path.join(dir, 'audio.mp3');
  const settings = getSettings();
  const checkAbort = () => {
    if (signal?.aborted) throw new CancelledError();
  };

  // Whether audio.mp3 was a complete, reusable mix before transcription began.
  // Drives cleanup if the user cancels: a half-written mix must be discarded,
  // but a complete one is kept so the recording isn't lost.
  let mp3WasReady = await sizeOf(mp3);
  const hadWebm = await sizeOf(webm);

  try {
    emit({ sessionId, phase: 'transcoding', message: 'Mixing audio...' });
    // Clear any error from a previous (failed) attempt so a retry starts clean.
    updateSession(sessionId, { status: 'transcoding', error: undefined });

    const hasWebm = hadWebm;
    const hasSystemPcm = await sizeOf(systemPcm);
    const hasMp3 = mp3WasReady;

    // Stage 1: produce a single audio.mp3 with both speakers properly balanced.
    if (hasMp3) {
      // Already mixed: a retry / re-run of a session we've processed before, or
      // an imported file. Reuse the existing mix as-is — the raw system PCM is
      // deleted after the first mix, so re-mixing here would silently drop the
      // other party's audio.
    } else if (hasWebm && hasSystemPcm) {
      // OBS-style mix: mic gets gate+comp+boost, system gets ducked when mic
      // is active, both end up at -16 LUFS. One file, naturally time-ordered.
      await obsStyleMix(webm, systemPcm, 48000, 2, mp3, signal);
      // Raw PCM no longer needed.
      await fsp.unlink(systemPcm).catch(() => undefined);
    } else if (hasWebm) {
      // Mic only — just normalize loudness.
      await transcodeMicToMp3(webm, mp3, signal);
    } else {
      throw new Error('No audio found for this session.');
    }
    // Stage 1 produced (or confirmed) a complete mix.
    mp3WasReady = true;
    checkAbort();

    const dur = await getDurationSec(mp3);
    if (dur) updateSession(sessionId, { durationSec: dur });

    // Stage 2: chunk for the API's 25MB limit and transcribe in parallel.
    emit({ sessionId, phase: 'chunking', message: 'Slicing audio...' });
    const chunks = await chunkAudio(mp3, settings.chunkDurationSec, settings.chunkOverlapSec, signal);
    checkAbort();

    emit({
      sessionId,
      phase: 'transcribing',
      current: 0,
      total: chunks.length,
      message: `Transcribing ${chunks.length} chunk${chunks.length === 1 ? '' : 's'}...`,
    });
    updateSession(sessionId, { status: 'transcribing' });

    const client = new OpenAI({ apiKey: key });
    const limit = pLimit(Math.max(1, settings.workers));
    let completed = 0;

    const results: (string | null)[] = new Array(chunks.length).fill(null);
    const chunkErrors: unknown[] = [];
    await Promise.all(
      chunks.map((chunkPath, idx) =>
        limit(async () => {
          try {
            const transcript = await client.audio.transcriptions.create(
              {
                model: settings.model,
                file: fs.createReadStream(chunkPath),
                response_format: 'text',
              },
              { signal },
            );
            results[idx] = String(transcript).trim();
          } catch (err) {
            chunkErrors.push(err);
            results[idx] = `[ERROR transcribing chunk ${idx + 1}: ${(err as Error).message}]`;
          } finally {
            completed++;
            emit({
              sessionId,
              phase: 'transcribing',
              current: completed,
              total: chunks.length,
            });
          }
        }),
      ),
    );

    await cleanupChunks(chunks, mp3);
    checkAbort();

    // If every chunk failed (e.g. went offline mid-transcribe), this is a real
    // failure, not a "done" transcript full of error markers — surface it so the
    // user gets a friendly message and a working Retry button.
    if (chunkErrors.length === chunks.length) throw chunkErrors[0];

    // Concatenate chunks; chunk-level ordering is already chronological.
    const fullTranscript = results.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    emit({ sessionId, phase: 'saving', message: 'Saving transcript...' });
    await writeTranscript(sessionId, fullTranscript);

    updateSession(sessionId, { status: 'done', error: undefined });
    const updated = getSession(sessionId)!;
    await writeMeta(updated);
    emit({ sessionId, phase: 'done' });
  } catch (err) {
    // Stopped by the user: reset the session to a clean state and re-throw a
    // CancelledError so the IPC layer can distinguish it from a real failure.
    if (signal?.aborted || (err as any)?.cancelled) {
      await resetCancelled(sessionId, dir, mp3, hadWebm, mp3WasReady, wasDone);
      emit({ sessionId, phase: 'error', message: 'Stopped' });
      throw new CancelledError();
    }
    const message = friendlyTranscribeError(err);
    updateSession(sessionId, { status: 'error', error: message });
    emit({ sessionId, phase: 'error', message });
    // Rethrow as a friendly error so the IPC layer reports the same message.
    throw new Error(message);
  }
}

/** Undo partial work after a cancel so the session ends in a sane, retryable
 *  state (or disappears if there's nothing salvageable). */
async function resetCancelled(
  sessionId: string,
  dir: string,
  mp3: string,
  hadWebm: boolean,
  mp3WasReady: boolean,
  wasDone: boolean,
): Promise<void> {
  // Remove leftover chunk slices (audio_chunk_N.mp3) from this run.
  try {
    const entries = await fsp.readdir(dir);
    await Promise.all(
      entries
        .filter((n) => /_chunk_\d+\.mp3$/.test(n))
        .map((n) => fsp.unlink(path.join(dir, n)).catch(() => undefined)),
    );
  } catch {
    /* ignore */
  }

  if (mp3WasReady) {
    // A complete mix exists. If this was a re-run of an already-finished
    // session, the prior transcript is untouched — restore "done". Otherwise
    // leave it retryable.
    updateSession(
      sessionId,
      wasDone
        ? { status: 'done', error: undefined }
        : { status: 'error', error: 'Stopped. Press Retry to transcribe again.' },
    );
    return;
  }

  // The mix was still being written — discard the partial file.
  await fsp.unlink(mp3).catch(() => undefined);
  if (hadWebm) {
    // A recording: the raw mic capture is still there, so a retry can re-mix.
    updateSession(sessionId, {
      status: 'error',
      error: 'Stopped. Press Retry to transcribe again.',
    });
  } else {
    // An import stopped before any usable audio existed — nothing to keep.
    await deleteSession(sessionId);
  }
}

async function sizeOf(p: string): Promise<boolean> {
  try {
    const st = await fsp.stat(p);
    return st.size > 0;
  } catch {
    return false;
  }
}
