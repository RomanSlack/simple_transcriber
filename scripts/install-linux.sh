#!/usr/bin/env bash
# Install Simple Transcriber on Linux as a desktop app (searchable in
# GNOME/KDE/etc, pin-to-favorites friendly). Requires that
# `npm run package:linux` has been run successfully first.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPIMAGE_SRC="$(ls -1 "${REPO_ROOT}/release/"*.AppImage 2>/dev/null | head -1 || true)"
APP_NAME="Simple Transcriber"

if [[ -z "${APPIMAGE_SRC}" ]]; then
  echo "Error: no AppImage found in ${REPO_ROOT}/release/" >&2
  echo "Run 'npm run package:linux' first." >&2
  exit 1
fi

BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/share/applications"
HICOLOR_ROOT="${HOME}/.local/share/icons/hicolor"
APPIMAGE_DEST="${BIN_DIR}/SimpleTranscriber.AppImage"
DESKTOP_DEST="${APP_DIR}/simple-transcriber.desktop"

mkdir -p "${BIN_DIR}" "${APP_DIR}"

echo "→ Copying AppImage to ${APPIMAGE_DEST}"
cp -f "${APPIMAGE_SRC}" "${APPIMAGE_DEST}"
chmod +x "${APPIMAGE_DEST}"

echo "→ Installing icons (multi-size)"
for SIZE in 16 24 32 48 64 128 256 512; do
  SRC="${REPO_ROOT}/assets/icon-${SIZE}.png"
  [[ -f "${SRC}" ]] || continue
  DST_DIR="${HICOLOR_ROOT}/${SIZE}x${SIZE}/apps"
  mkdir -p "${DST_DIR}"
  cp -f "${SRC}" "${DST_DIR}/simple-transcriber.png"
done
# Also drop a scalable fallback (some launchers prefer this)
SCALABLE_DIR="${HICOLOR_ROOT}/scalable/apps"
mkdir -p "${SCALABLE_DIR}"
if [[ -f "${REPO_ROOT}/assets/icon.png" ]]; then
  cp -f "${REPO_ROOT}/assets/icon.png" "${SCALABLE_DIR}/simple-transcriber.png"
fi

# Pixmaps location — older launchers fall back here when hicolor lookup fails.
PIXMAPS="${HOME}/.local/share/pixmaps"
mkdir -p "${PIXMAPS}"
if [[ -f "${REPO_ROOT}/assets/icon-256.png" ]]; then
  cp -f "${REPO_ROOT}/assets/icon-256.png" "${PIXMAPS}/simple-transcriber.png"
fi

echo "→ Writing desktop entry to ${DESKTOP_DEST}"
cat > "${DESKTOP_DEST}" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=${APP_NAME}
GenericName=Meeting Transcriber
Comment=Record meetings and transcribe via OpenAI
Exec=${APPIMAGE_DEST} --no-sandbox %U
Icon=simple-transcriber
Terminal=false
StartupNotify=true
StartupWMClass=Simple Transcriber
Categories=AudioVideo;Audio;Recorder;Utility;
Keywords=transcribe;transcription;meeting;recorder;audio;openai;whisper;
EOF
chmod +x "${DESKTOP_DEST}"

echo "→ Refreshing desktop / icon caches"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APP_DIR}" 2>/dev/null || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "${HICOLOR_ROOT}" 2>/dev/null || true
fi

echo
echo "✓ Installed."
echo "  Search 'Simple Transcriber' in your launcher."
echo "  If the icon still shows as generic after install:"
echo "    • GNOME: log out and back in (Wayland doesn't refresh shell icons live)"
echo "    • X11: 'killall -HUP gnome-shell' to force a reload"
echo "    • Both: 'xdg-icon-resource forceupdate' as a last resort"
