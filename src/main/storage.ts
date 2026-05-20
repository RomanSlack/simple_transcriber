import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream, WriteStream } from 'node:fs';
import Database from 'better-sqlite3';
import type { SessionMeta } from '../shared/types';

let db: Database.Database | null = null;

function dataRoot() {
  return app.getPath('userData');
}

export function sessionsDir() {
  return path.join(dataRoot(), 'sessions');
}

export function sessionDir(id: string) {
  return path.join(sessionsDir(), id);
}

export async function ensureStorageDirs() {
  await fs.mkdir(sessionsDir(), { recursive: true });
  const dbPath = path.join(dataRoot(), 'index.sqlite');
  db = new Database(dbPath);
  // WAL mode lets concurrent reads happen, and synchronous=NORMAL gives durable
  // commits without forcing fsync on every write — survives crashes.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      duration_sec REAL NOT NULL DEFAULT 0,
      model TEXT NOT NULL,
      mic_label TEXT,
      system_label TEXT,
      status TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
  `);
}

function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export function insertSession(meta: SessionMeta) {
  getDb()
    .prepare(
      `INSERT INTO sessions (id, created_at, duration_sec, model, mic_label, system_label, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      meta.id,
      meta.createdAt,
      meta.durationSec,
      meta.model,
      meta.micLabel,
      meta.systemLabel,
      meta.status,
      meta.error ?? null,
    );
}

export function updateSession(id: string, patch: Partial<SessionMeta>) {
  const cur = getSession(id);
  if (!cur) return;
  const next: SessionMeta = { ...cur, ...patch };
  getDb()
    .prepare(
      `UPDATE sessions SET duration_sec=?, status=?, error=?, model=?, mic_label=?, system_label=? WHERE id=?`,
    )
    .run(
      next.durationSec,
      next.status,
      next.error ?? null,
      next.model,
      next.micLabel,
      next.systemLabel,
      id,
    );
}

export function listSessions(): SessionMeta[] {
  const rows = getDb()
    .prepare(`SELECT * FROM sessions ORDER BY created_at DESC`)
    .all() as any[];
  return rows.map(rowToMeta);
}

export function getSession(id: string): SessionMeta | null {
  const row = getDb().prepare(`SELECT * FROM sessions WHERE id=?`).get(id) as any;
  return row ? rowToMeta(row) : null;
}

function rowToMeta(row: any): SessionMeta {
  return {
    id: row.id,
    createdAt: row.created_at,
    durationSec: row.duration_sec,
    model: row.model,
    micLabel: row.mic_label,
    systemLabel: row.system_label,
    status: row.status,
    error: row.error ?? undefined,
  };
}

/* --- recording stream sink --- */

const writers = new Map<string, WriteStream>();

export async function openRecordingSink(id: string): Promise<string> {
  await fs.mkdir(sessionDir(id), { recursive: true });
  const filePath = path.join(sessionDir(id), 'audio.webm');
  const stream = createWriteStream(filePath);
  writers.set(id, stream);
  return filePath;
}

export function writeRecordingChunk(id: string, data: Uint8Array) {
  const w = writers.get(id);
  if (!w) throw new Error(`No open writer for session ${id}`);
  w.write(Buffer.from(data));
}

export async function closeRecordingSink(id: string): Promise<string> {
  const w = writers.get(id);
  if (!w) throw new Error(`No open writer for session ${id}`);
  return new Promise((resolve, reject) => {
    w.end((err: unknown) => {
      writers.delete(id);
      if (err) reject(err);
      else resolve(path.join(sessionDir(id), 'audio.webm'));
    });
  });
}

export async function writeTranscript(id: string, text: string) {
  await fs.writeFile(path.join(sessionDir(id), 'transcript.txt'), text, 'utf-8');
}

export async function readTranscript(id: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(sessionDir(id), 'transcript.txt'), 'utf-8');
  } catch {
    return null;
  }
}

export async function writeMeta(meta: SessionMeta) {
  await fs.writeFile(
    path.join(sessionDir(meta.id), 'meta.json'),
    JSON.stringify(meta, null, 2),
    'utf-8',
  );
}

export async function deleteSession(id: string) {
  getDb().prepare(`DELETE FROM sessions WHERE id=?`).run(id);
  await fs.rm(sessionDir(id), { recursive: true, force: true });
}

export function dataPathForReveal() {
  return dataRoot();
}

export async function sessionBytes(id: string): Promise<number> {
  try {
    const entries = await fs.readdir(sessionDir(id));
    let total = 0;
    for (const name of entries) {
      try {
        const st = await fs.stat(path.join(sessionDir(id), name));
        if (st.isFile()) total += st.size;
      } catch { /* ignore */ }
    }
    return total;
  } catch {
    return 0;
  }
}

export async function listSessionsWithBytes(): Promise<SessionMeta[]> {
  const sessions = listSessions();
  await Promise.all(
    sessions.map(async (s) => {
      s.bytesOnDisk = await sessionBytes(s.id);
    }),
  );
  return sessions;
}

