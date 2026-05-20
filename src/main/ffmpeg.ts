import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import ffmpegStaticImport from 'ffmpeg-static';

const ffmpegPath = (ffmpegStaticImport as unknown as string).replace(
  'app.asar',
  'app.asar.unpacked',
);

function ffprobeFromFfmpeg(): string {
  return ffmpegPath.replace(/ffmpeg(\.exe)?$/, (_m, ext) => `ffprobe${ext ?? ''}`);
}

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(cmd)} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export async function transcodeToMp3(input: string, output: string): Promise<void> {
  await run(ffmpegPath, [
    '-y',
    '-i', input,
    '-vn',
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    output,
  ]);
}

/** Transcode mic input (webm/etc) to mp3, with loudness normalization since
 *  webcam/headset mics are typically much quieter than playback. */
export async function transcodeMicToMp3(input: string, output: string): Promise<void> {
  await run(ffmpegPath, [
    '-y',
    '-i', input,
    '-vn',
    '-af', 'aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11',
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    output,
  ]);
}

/** Mix mic + system into one mp3 for transcription. Assumes meeting-style audio
 *  (people take turns), so we don't need ducking or per-source processing — just
 *  bring both streams to the same perceived loudness and sum.
 *
 *  Implemented in two passes to avoid the ffmpeg `best_input >= 0` assertion
 *  crash that fires when amix is fed a truncated WebM (our MediaRecorder output
 *  often has a half-finalized trailer because the stream is closed mid-cluster).
 *  Pass 1: each source → its own clean loudnorm'd mp3 in a temp file.
 *  Pass 2: amix the two clean mp3s. */
export async function obsStyleMix(
  micInput: string,
  systemPcm: string,
  systemSampleRate: number,
  systemChannels: number,
  output: string,
): Promise<void> {
  const tmpMic = output + '.mic.tmp.mp3';
  const tmpSys = output + '.sys.tmp.mp3';
  try {
    await transcodeMicToMp3(micInput, tmpMic);
    await transcodePcmToMp3(systemPcm, systemSampleRate, systemChannels, tmpSys);
    await run(ffmpegPath, [
      '-y',
      '-i', tmpMic,
      '-i', tmpSys,
      '-filter_complex',
      '[0:a][1:a]amix=inputs=2:duration=shortest:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]',
      '-map', '[aout]',
      '-acodec', 'libmp3lame',
      '-q:a', '4',
      output,
    ]);
  } finally {
    const fs = await import('node:fs/promises');
    await Promise.all([
      fs.unlink(tmpMic).catch(() => undefined),
      fs.unlink(tmpSys).catch(() => undefined),
    ]);
  }
}

/** Transcode raw PCM (s16le) system loopback to mp3, also loudness-normalized. */
export async function transcodePcmToMp3(
  pcmPath: string,
  sampleRate: number,
  channels: number,
  output: string,
): Promise<void> {
  await run(ffmpegPath, [
    '-y',
    '-f', 's16le',
    '-ar', String(sampleRate),
    '-ac', String(channels),
    '-i', pcmPath,
    '-af', 'aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11',
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    output,
  ]);
}

export async function getDurationSec(file: string): Promise<number | null> {
  try {
    const { stdout } = await run(ffprobeFromFfmpeg(), [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      file,
    ]);
    const v = parseFloat(stdout.trim());
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export async function sliceChunk(
  input: string,
  output: string,
  startSec: number,
  durationSec: number,
): Promise<void> {
  await run(ffmpegPath, [
    '-y',
    '-ss', String(startSec),
    '-i', input,
    '-t', String(durationSec),
    '-vn',
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    output,
  ]);
}

export async function chunkAudio(
  input: string,
  chunkDurationSec: number,
  overlapSec: number,
): Promise<string[]> {
  const duration = await getDurationSec(input);
  if (!duration || duration <= chunkDurationSec) return [input];

  const numChunks = Math.ceil(duration / chunkDurationSec);
  const dir = path.dirname(input);
  const base = path.basename(input, path.extname(input));
  const chunks: string[] = [];

  for (let i = 0; i < numChunks; i++) {
    const start = Math.max(0, i * chunkDurationSec - (i > 0 ? overlapSec : 0));
    const dur = Math.min(chunkDurationSec + overlapSec, duration - start);
    const out = path.join(dir, `${base}_chunk_${i}.mp3`);
    await sliceChunk(input, out, start, dur);
    chunks.push(out);
  }
  return chunks;
}

export async function cleanupChunks(files: string[], originalInput: string): Promise<void> {
  await Promise.all(
    files
      .filter((f) => f !== originalInput)
      .map((f) => fs.unlink(f).catch(() => undefined)),
  );
}
