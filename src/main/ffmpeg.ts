import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import ffmpegStaticImport from 'ffmpeg-static';

const ffmpegPath = (ffmpegStaticImport as unknown as string).replace(
  'app.asar',
  'app.asar.unpacked',
);

function run(
  cmd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true, signal });
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

export async function transcodeToMp3(input: string, output: string, signal?: AbortSignal): Promise<void> {
  await run(ffmpegPath, [
    '-y',
    '-i', input,
    '-vn',
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    output,
  ], signal);
}

/** Transcode mic input (webm/etc) to mp3, with loudness normalization since
 *  webcam/headset mics are typically much quieter than playback. */
export async function transcodeMicToMp3(input: string, output: string, signal?: AbortSignal): Promise<void> {
  await run(ffmpegPath, [
    '-y',
    '-i', input,
    '-vn',
    '-af', 'aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11',
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    output,
  ], signal);
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
  signal?: AbortSignal,
): Promise<void> {
  const tmpMic = output + '.mic.tmp.mp3';
  const tmpSys = output + '.sys.tmp.mp3';
  try {
    await transcodeMicToMp3(micInput, tmpMic, signal);
    await transcodePcmToMp3(systemPcm, systemSampleRate, systemChannels, tmpSys, signal);
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
    ], signal);
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
  signal?: AbortSignal,
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
  ], signal);
}

/** Run a command and resolve with its stderr regardless of exit code. ffmpeg
 *  exits non-zero when handed no output file, but still prints stream metadata. */
function runForStderr(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', () => resolve(stderr));
    proc.on('close', () => resolve(stderr));
  });
}

export async function getDurationSec(file: string): Promise<number | null> {
  // ffmpeg-static does NOT ship ffprobe, so derive duration from ffmpeg's own
  // header output ("Duration: HH:MM:SS.cc"). This reads the container header
  // only (no full decode), so it stays fast even for hour-long files. Getting
  // this wrong is serious: a null here makes chunkAudio() skip chunking and send
  // the whole file to the API, blowing past the 25MB limit on long recordings.
  const stderr = await runForStderr(ffmpegPath, ['-hide_banner', '-i', file]);
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const total = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
  return Number.isFinite(total) ? total : null;
}

export async function sliceChunk(
  input: string,
  output: string,
  startSec: number,
  durationSec: number,
  signal?: AbortSignal,
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
  ], signal);
}

export async function chunkAudio(
  input: string,
  chunkDurationSec: number,
  overlapSec: number,
  signal?: AbortSignal,
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
    await sliceChunk(input, out, start, dur, signal);
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
