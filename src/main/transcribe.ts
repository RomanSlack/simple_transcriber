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
import { getSettings } from './settings';
import {
  sessionDir,
  updateSession,
  writeTranscript,
  writeMeta,
  getSession,
} from './storage';
import type { TranscribeProgress } from '../shared/types';

export type ProgressEmitter = (p: TranscribeProgress) => void;

export async function runTranscription(
  sessionId: string,
  emit: ProgressEmitter,
): Promise<void> {
  const meta = getSession(sessionId);
  if (!meta) throw new Error(`Session not found: ${sessionId}`);

  const key = await getApiKey();
  if (!key) throw new Error('OpenAI API key not set. Open Settings to paste one.');

  const dir = sessionDir(sessionId);
  const webm = path.join(dir, 'audio.webm');
  const systemPcm = path.join(dir, 'system.pcm');
  const mp3 = path.join(dir, 'audio.mp3');
  const settings = getSettings();

  try {
    emit({ sessionId, phase: 'transcoding', message: 'Mixing audio...' });
    updateSession(sessionId, { status: 'transcoding' });

    const hasWebm = await sizeOf(webm);
    const hasSystemPcm = await sizeOf(systemPcm);
    const hasMp3 = await sizeOf(mp3);

    // Stage 1: produce a single audio.mp3 with both speakers properly balanced.
    if (hasWebm && hasSystemPcm) {
      // OBS-style mix: mic gets gate+comp+boost, system gets ducked when mic
      // is active, both end up at -16 LUFS. One file, naturally time-ordered.
      await obsStyleMix(webm, systemPcm, 48000, 2, mp3);
      // Raw PCM no longer needed.
      await fsp.unlink(systemPcm).catch(() => undefined);
    } else if (hasWebm) {
      // Mic only — just normalize loudness.
      await transcodeMicToMp3(webm, mp3);
    } else if (hasMp3) {
      // Imported session — audio.mp3 already exists.
    } else {
      throw new Error('No audio found for this session.');
    }

    const dur = await getDurationSec(mp3);
    if (dur) updateSession(sessionId, { durationSec: dur });

    // Stage 2: chunk for the API's 25MB limit and transcribe in parallel.
    emit({ sessionId, phase: 'chunking', message: 'Slicing audio...' });
    const chunks = await chunkAudio(mp3, settings.chunkDurationSec, settings.chunkOverlapSec);

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
    await Promise.all(
      chunks.map((chunkPath, idx) =>
        limit(async () => {
          try {
            const transcript = await client.audio.transcriptions.create({
              model: settings.model,
              file: fs.createReadStream(chunkPath),
              response_format: 'text',
            });
            results[idx] = String(transcript).trim();
          } catch (err) {
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

    // Concatenate chunks; chunk-level ordering is already chronological.
    const fullTranscript = results.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    emit({ sessionId, phase: 'saving', message: 'Saving transcript...' });
    await writeTranscript(sessionId, fullTranscript);

    updateSession(sessionId, { status: 'done' });
    const updated = getSession(sessionId)!;
    await writeMeta(updated);
    emit({ sessionId, phase: 'done' });
  } catch (err) {
    const message = (err as Error).message;
    updateSession(sessionId, { status: 'error', error: message });
    emit({ sessionId, phase: 'error', message });
    throw err;
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
