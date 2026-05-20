import { nativeTheme, BrowserWindow } from 'electron';
import { getSettings, updateSettings } from './settings';
import type { ThemePref } from '../shared/types';

interface EffectiveTheme {
  pref: ThemePref;
  effective: 'light' | 'dark';
}

export function getEffectiveTheme(): EffectiveTheme {
  const pref = getSettings().theme;
  if (pref === 'light' || pref === 'dark') {
    return { pref, effective: pref };
  }
  return {
    pref: 'system',
    effective: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  };
}

export function applyTheme(pref: ThemePref) {
  updateSettings({ theme: pref });
  nativeTheme.themeSource = pref;
  broadcast();
}

function broadcast() {
  const payload = getEffectiveTheme();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('theme:changed', payload);
  }
}

export function initTheme() {
  // Apply persisted preference at startup so any subsequent system changes
  // we observe will only matter for 'system' mode.
  nativeTheme.themeSource = getSettings().theme;
  nativeTheme.on('updated', () => {
    // System theme changed; if user pref is 'system' the effective theme moves
    // with it, so broadcast.
    if (getSettings().theme === 'system') broadcast();
  });
}
