import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Props {
  onImported: (sessionId: string) => void;
  onError: (message: string) => void;
  children: React.ReactNode;
}

export function DropZone({ onImported, onError, children }: Props) {
  const [over, setOver] = useState(false);
  const counterRef = useRef(0);

  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
    };
  }, []);

  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    counterRef.current += 1;
    setOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    counterRef.current = Math.max(0, counterRef.current - 1);
    if (counterRef.current === 0) setOver(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
  };
  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    counterRef.current = 0;
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      const filePath = api.importer.getDroppedFilePath(file);
      if (!filePath) {
        onError("Couldn't read the file path. Try the Import button instead.");
        return;
      }
      const id = await api.importer.fromPath(filePath);
      if (!id) return; // user stopped the import — not an error
      onImported(id);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <div
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 18, height: '100%' }}
    >
      {children}
      {over && <Overlay />}
    </div>
  );
}

function Overlay() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: -6,
        borderRadius: 26,
        background: 'color-mix(in srgb, var(--bg) 92%, transparent)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        pointerEvents: 'none',
        boxShadow:
          'inset 8px 8px 18px var(--shadow-dark), inset -8px -8px 18px var(--shadow-light)',
      }}
    >
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          style={{
            fontSize: 56,
            color: 'var(--accent)',
            textShadow: '0 4px 14px rgba(255,107,107,0.35)',
          }}
        >
          ↓
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          Drop to transcribe
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
          Any audio or video file
        </div>
      </div>
    </div>
  );
}

function hasFiles(e: React.DragEvent | DragEvent): boolean {
  const types = (e.dataTransfer?.types ?? []) as readonly string[];
  return types.includes('Files');
}
