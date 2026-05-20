#!/usr/bin/env bash
# Install Simple Transcriber on Linux as a desktop app (searchable in
# GNOME/KDE/etc, pin-to-favorites friendly). Requires that
# `npm run package:linux` has been run successfully first.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPIMAGE_SRC="$(ls -1 "${REPO_ROOT}/release/"*.AppImage 2>/dev/null | head -1 || true)"
ICON_SRC="${REPO_ROOT}/assets/icon-256.png"
APP_NAME="Simple Transcriber"

if [[ -z "${APPIMAGE_SRC}" ]]; then
  echo "Error: no AppImage found in ${REPO_ROOT}/release/" >&2
  echo "Run 'npm run package:linux' first." >&2
  exit 1
fi
if [[ ! -f "${ICON_SRC}" ]]; then
  echo "Error: icon not found at ${ICON_SRC}" >&2
  exit 1
fi

BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"
APPIMAGE_DEST="${BIN_DIR}/SimpleTranscriber.AppImage"
DESKTOP_DEST="${APP_DIR}/simple-transcriber.desktop"
ICON_DEST="${ICON_DIR}/simple-transcriber.png"

mkdir -p "${BIN_DIR}" "${APP_DIR}" "${ICON_DIR}"

echo "→ Copying AppImage to ${APPIMAGE_DEST}"
cp -f "${APPIMAGE_SRC}" "${APPIMAGE_DEST}"
chmod +x "${APPIMAGE_DEST}"

echo "→ Installing icon to ${ICON_DEST}"
cp -f "${ICON_SRC}" "${ICON_DEST}"

echo "→ Writing desktop entry to ${DESKTOP_DEST}"
cat > "${DESKTOP_DEST}" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Record meetings and transcribe via OpenAI
Exec=${APPIMAGE_DEST} --no-sandbox %U
Icon=simple-transcriber
Terminal=false
Categories=AudioVideo;Audio;Recorder;
StartupWMClass=Simple Transcriber
EOF
chmod +x "${DESKTOP_DEST}"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APP_DIR}" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q "${HOME}/.local/share/icons/hicolor" 2>/dev/null || true
fi

echo
echo "✓ Installed."
echo "  Search 'Simple Transcriber' in your launcher."
echo "  Or run from the terminal: ${APPIMAGE_DEST}"
