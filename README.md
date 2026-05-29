<div align="center">
  <img src="assets/hero.png" alt="Simple Transcriber" width="720" />
</div>

# Simple Transcriber

A desktop app that records your microphone and the audio playing through your speakers at the same time, then transcribes the result via the OpenAI API. Runs on Linux, Windows, and macOS.

Intended use: meeting and call recordings where you want a single text transcript that includes both what you said and what the other participants said, without running a separate recorder app and a separate transcription script.

## Download

Grab a ready-to-run installer from the [Releases page](https://github.com/RomanSlack/simple_transcriber/releases) — no build tools required:

- **Windows:** `Simple Transcriber-Setup-<version>.exe` — double-click, click through the wizard.
- **macOS:** `Simple Transcriber-<version>.dmg` — drag to Applications.
- **Linux:** `Simple Transcriber-<version>.AppImage` (portable) or the `.deb`.

Installers are unsigned, so Windows SmartScreen / macOS Gatekeeper will warn on first launch — see [INSTALL.md](INSTALL.md) for the one-time "open anyway" step.

## Build from source

See [INSTALL.md](INSTALL.md) for per-platform instructions, prerequisites, and packaging commands.

For Linux specifically, after cloning:

```bash
npm install && npx electron-rebuild
npm run package:linux
./scripts/install-linux.sh
```

That puts a searchable "Simple Transcriber" entry in your launcher.

## Usage

1. Launch the app. On first run, onboarding asks for an OpenAI API key (stored in the OS keychain) and your input/output devices.
2. Hit the record button. Both audio sources are captured to a single mixed file.
3. Stop. Transcription runs automatically. The result appears in the session list.
4. Open a session to read, copy, or export the transcript.

You can also drag any audio or video file onto the window to transcribe it.

## How it works

- **Microphone:** `getUserMedia` with WebRTC AGC/noise-suppression/echo-cancellation disabled so the app doesn't fight your call software's processing.
- **System audio:**
  - Linux: native PipeWire capture via `pw-record -P stream.capture.sink=true --target=<sink>`.
  - Windows: WASAPI loopback via Electron's `desktopCapturer`.
  - macOS: BlackHole virtual audio device (onboarding walks through setup).
- **Mix:** each stream is independently loudness-normalized to -16 LUFS, summed with `amix=normalize=0`, limited, and written to a single mp3.
- **Transcription:** the mixed mp3 is chunked (default 10 min, 2 s overlap) and sent in parallel to OpenAI. Default model is `gpt-4o-transcribe`.
- **Storage:** session metadata in a WAL-mode SQLite index, audio and transcripts under your OS app-data directory. Crashed-mid-recording sessions are recovered on next launch.

API keys live in the OS keychain (Keychain on macOS, Credential Manager on Windows, libsecret on Linux). They are never written to disk in plaintext.

## Data location

| OS      | Path                                              |
| ------- | ------------------------------------------------- |
| Linux   | `~/.config/Simple Transcriber/`                   |
| macOS   | `~/Library/Application Support/Simple Transcriber/` |
| Windows | `%APPDATA%\Simple Transcriber\`                   |

Settings → Data → "Open data folder" reveals it.

## Development

```bash
git clone https://github.com/RomanSlack/simple_transcriber.git
cd simple_transcriber
npm install
npx electron-rebuild
npm run dev
```

Stack: Electron + React + TypeScript + Vite. ffmpeg-static for audio, better-sqlite3 for the index, keytar for the key.

See [ISSUES.md](ISSUES.md) for the gotchas hit during development (PipeWire `stream.capture.sink`, ffmpeg `amix normalize=0`, two-pass mixing, etc.). Worth reading before changing the audio pipeline.

## License

MIT
