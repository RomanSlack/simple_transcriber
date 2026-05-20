#!/usr/bin/env bash
# Reverse of install-linux.sh — removes the AppImage, desktop entry, and icon.
# Leaves your session data and API key (in OS keychain) intact.

set -euo pipefail

APPIMAGE="${HOME}/.local/bin/SimpleTranscriber.AppImage"
DESKTOP="${HOME}/.local/share/applications/simple-transcriber.desktop"
ICON="${HOME}/.local/share/icons/hicolor/256x256/apps/simple-transcriber.png"

for f in "${APPIMAGE}" "${DESKTOP}" "${ICON}"; do
  if [[ -f "${f}" ]]; then
    echo "→ rm ${f}"
    rm -f "${f}"
  fi
done

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${HOME}/.local/share/applications" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q "${HOME}/.local/share/icons/hicolor" 2>/dev/null || true
fi

echo
echo "✓ Uninstalled. Session data and API key were not touched."
echo "  Data:  ~/.config/Simple Transcriber/"
echo "  Key:   in libsecret / GNOME Keyring under service 'simple-transcriber'"
