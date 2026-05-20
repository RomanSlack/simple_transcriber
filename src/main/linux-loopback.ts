import { exec, spawn, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream, WriteStream } from 'node:fs';
import path from 'node:path';
import type { SystemAudioSource } from '../shared/types';

const execP = promisify(exec);

interface PwSink {
  name: string;
  description: string;
  isDefault: boolean;
}

/** Returns one entry per PipeWire/Pulse audio sink (output). Each sink has an
 *  implicit monitor we'll record from with pw-record --target. */
export async function listLinuxSinks(): Promise<SystemAudioSource[]> {
  const sinks = await dumpSinks();
  console.log(`[loopback] enumerated ${sinks.length} sink(s):`, sinks.map((s) => s.name));
  return sinks.map((s) => ({
    id: s.name,
    label: `Monitor of ${s.description}${s.isDefault ? ' (default)' : ''}`,
    kind: 'monitor',
  }));
}

async function dumpSinks(): Promise<PwSink[]> {
  try {
    const cmd = await resolvePwDump();
    if (!cmd) {
      console.error('[loopback] pw-dump not found on PATH');
      return [];
    }
    const { stdout } = await execP(cmd, { maxBuffer: 64 * 1024 * 1024 });
    const json = parseFirstJsonArray(stdout) as any[];
    const sinks: PwSink[] = [];
    let defaultSinkName: string | null = null;
    for (const obj of json) {
      const props = obj?.info?.props ?? {};
      if (props['media.class'] === 'Audio/Sink' && props['node.name']) {
        sinks.push({
          name: String(props['node.name']),
          description: String(props['node.description'] ?? props['node.name']),
          isDefault: false,
        });
      }
      if (obj?.type === 'PipeWire:Interface:Metadata' && Array.isArray(obj?.metadata)) {
        for (const m of obj.metadata) {
          if (m?.key === 'default.audio.sink') {
            try {
              const parsed = typeof m.value === 'string' ? JSON.parse(m.value) : m.value;
              if (parsed?.name) defaultSinkName = parsed.name;
            } catch {
              defaultSinkName = String(m.value);
            }
          }
        }
      }
    }
    if (defaultSinkName) {
      for (const s of sinks) if (s.name === defaultSinkName) s.isDefault = true;
    } else if (sinks[0]) {
      sinks[0].isDefault = true;
    }
    sinks.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    return sinks;
  } catch (err) {
    console.error('[loopback] pw-dump enumeration failed:', err);
    return [];
  }
}

/** pw-dump sometimes emits a second JSON array of partial updates after the
 *  primary snapshot. Walk the brackets so we only parse the first array. */
function parseFirstJsonArray(text: string): unknown {
  const start = text.indexOf('[');
  if (start < 0) throw new Error('no JSON array in pw-dump output');
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }
  throw new Error('unterminated JSON array');
}

let cachedPwDump: string | null | undefined;
async function resolvePwDump(): Promise<string | null> {
  if (cachedPwDump !== undefined) return cachedPwDump;
  const candidates = ['pw-dump', '/usr/bin/pw-dump', '/usr/local/bin/pw-dump'];
  for (const c of candidates) {
    try {
      await execP(`${c} --help`, { timeout: 1500 });
      cachedPwDump = c;
      return c;
    } catch { /* try next */ }
  }
  cachedPwDump = null;
  return null;
}

let cachedPwRecord: string | null | undefined;
export async function resolvePwRecord(): Promise<string | null> {
  if (cachedPwRecord !== undefined) return cachedPwRecord;
  const candidates = ['pw-record', '/usr/bin/pw-record', '/usr/local/bin/pw-record'];
  for (const c of candidates) {
    try {
      await execP(`${c} --help`, { timeout: 1500 });
      cachedPwRecord = c;
      return c;
    } catch { /* try next */ }
  }
  cachedPwRecord = null;
  return null;
}

/* ---------- capture / preview ---------- */

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2 * CHANNELS; // s16 stereo

interface Capture {
  proc: ChildProcess;
  fileStream: WriteStream | null;
  filePath: string | null;
  onLevel: (rms: number) => void;
  rmsAccum: { sumSquares: number; samples: number };
  lastEmit: number;
}

const captures = new Map<string, Capture>();

function spawnPwRecord(sinkName: string, outArg = '-'): ChildProcess {
  // Critical: stream.capture.sink=true tells PipeWire/WirePlumber to link this
  // recording stream to the sink's MONITOR ports (i.e., what's being played
  // out). Without it, --target=<sink> connects to the sink's input ports and
  // captures near-silence.
  const args = [
    '-P', 'stream.capture.sink=true',
    '--target', sinkName,
    '--format', 's16',
    '--rate', String(SAMPLE_RATE),
    '--channels', String(CHANNELS),
    outArg,
  ];
  const cmd = cachedPwRecord || 'pw-record';
  console.log('[loopback] spawning', cmd, args.join(' '));
  const proc = spawn(cmd, args, { stdio: ['ignore', outArg === '-' ? 'pipe' : 'ignore', 'pipe'] });
  proc.on('error', (err) => console.error('[loopback] pw-record spawn error:', err));
  proc.on('exit', (code, sig) => console.log('[loopback] pw-record exited code', code, 'sig', sig));
  proc.stderr?.on('data', (b: Buffer) => console.log('[loopback] pw-record stderr:', b.toString().trim()));
  return proc;
}

function attachLevelStream(cap: Capture) {
  let chunkCount = 0;
  if (!cap.proc.stdout) {
    console.error('[loopback] pw-record has no stdout');
    return;
  }
  cap.proc.stdout.on('data', (chunk: Buffer) => {
    chunkCount++;
    if (chunkCount === 1 || chunkCount % 100 === 0) {
      console.log('[loopback] chunk', chunkCount, 'size', chunk.length);
    }
    if (cap.fileStream) cap.fileStream.write(chunk);
    // Accumulate RMS across the chunk; emit at ~30fps.
    const samples = Math.floor(chunk.length / 2); // int16 samples (both channels interleaved)
    for (let i = 0; i < samples; i++) {
      const v = chunk.readInt16LE(i * 2) / 32768;
      cap.rmsAccum.sumSquares += v * v;
      cap.rmsAccum.samples += 1;
    }
    const now = Date.now();
    if (now - cap.lastEmit >= 33 && cap.rmsAccum.samples > 0) {
      const rms = Math.sqrt(cap.rmsAccum.sumSquares / cap.rmsAccum.samples);
      if (chunkCount < 5 || chunkCount % 100 === 0) {
        console.log('[loopback] emit rms', rms.toFixed(4));
      }
      cap.onLevel(rms);
      cap.rmsAccum.sumSquares = 0;
      cap.rmsAccum.samples = 0;
      cap.lastEmit = now;
    }
  });
}

/** Start a level-only preview (no file). Returns a stop function. */
export function startPreview(
  sinkName: string,
  onLevel: (rms: number) => void,
): { stop: () => Promise<void> } {
  stopByKey('preview'); // single global preview at a time
  const proc = spawnPwRecord(sinkName);
  const cap: Capture = {
    proc,
    fileStream: null,
    filePath: null,
    onLevel,
    rmsAccum: { sumSquares: 0, samples: 0 },
    lastEmit: 0,
  };
  captures.set('preview', cap);
  attachLevelStream(cap);

  return {
    stop: () => stopByKey('preview'),
  };
}

/** Start a recording capture: writes PCM to outPath and emits levels. */
export function startCapture(
  sessionId: string,
  sinkName: string,
  outPath: string,
  onLevel: (rms: number) => void,
): void {
  stopByKey(captureKey(sessionId));
  const proc = spawnPwRecord(sinkName);
  const fileStream = createWriteStream(outPath);
  const cap: Capture = {
    proc,
    fileStream,
    filePath: outPath,
    onLevel,
    rmsAccum: { sumSquares: 0, samples: 0 },
    lastEmit: 0,
  };
  captures.set(captureKey(sessionId), cap);
  attachLevelStream(cap);
}

export async function stopCapture(sessionId: string): Promise<string | null> {
  const cap = captures.get(captureKey(sessionId));
  if (!cap) return null;
  await stopByKey(captureKey(sessionId));
  return cap.filePath;
}

function captureKey(sessionId: string): string {
  return `capture:${sessionId}`;
}

async function stopByKey(key: string): Promise<void> {
  const cap = captures.get(key);
  if (!cap) return;
  captures.delete(key);
  try {
    cap.proc.kill('SIGINT');
  } catch { /* ignore */ }
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (cap.fileStream) {
        cap.fileStream.end(() => resolve());
      } else {
        resolve();
      }
    };
    cap.proc.once('exit', finish);
    cap.proc.once('close', finish);
    setTimeout(finish, 1500);
  });
}

export function pcmFormatArgs(): string[] {
  // ffmpeg input args for our PCM dump
  return ['-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS)];
}

export function systemPcmFilename(sessionDir: string): string {
  return path.join(sessionDir, 'system.pcm');
}

/** Record N seconds of audio from a sink's monitor into a temp WAV and return
 *  the bytes. Used by onboarding's "record & play back" tester. */
export async function testRecord(
  sinkName: string,
  seconds: number,
): Promise<{ bytes: Buffer; durationSec: number; rmsMax: number }> {
  const cmd = cachedPwRecord || 'pw-record';
  const os = await import('node:os');
  const fs = await import('node:fs/promises');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'st-test-'));
  const wavPath = path.join(tmpDir, 'test.wav');
  console.log('[loopback] test record', seconds, 's →', wavPath, 'sink:', sinkName);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      cmd,
      ['-P', 'stream.capture.sink=true', '--target', sinkName, wavPath],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    proc.on('error', reject);
    proc.stderr?.on('data', (b: Buffer) => console.log('[loopback] test stderr:', b.toString().trim()));
    setTimeout(() => {
      try { proc.kill('SIGINT'); } catch { /* ignore */ }
    }, seconds * 1000);
    proc.once('exit', () => resolve());
    proc.once('close', () => resolve());
  });
  const bytes = await fs.readFile(wavPath);
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  // quick RMS scan to know if the WAV is silent
  let rmsMax = 0;
  const headerSize = 44;
  if (bytes.length > headerSize + 4) {
    const samples = Math.floor((bytes.length - headerSize) / 2);
    let windowSum = 0;
    let windowCount = 0;
    const windowSize = 48000; // ~1 sec of mono-equivalent samples
    for (let i = 0; i < samples; i++) {
      const v = bytes.readInt16LE(headerSize + i * 2) / 32768;
      windowSum += v * v;
      windowCount++;
      if (windowCount >= windowSize) {
        const r = Math.sqrt(windowSum / windowCount);
        if (r > rmsMax) rmsMax = r;
        windowSum = 0;
        windowCount = 0;
      }
    }
  }
  return { bytes, durationSec: seconds, rmsMax };
}
