# Install & Build — Simple Transcriber

How to run the app from source on your machine, and how to produce installable packages for Linux / Windows / macOS.

> **Just want to use the app?** Download a prebuilt installer from the
> [Releases page](https://github.com/RomanSlack/simple_transcriber/releases) and skip this entire
> document — the build toolchain below is **only** needed to compile from source. Releases are
> produced automatically by GitHub Actions (`.github/workflows/release.yml`) on each tagged version.

---

## Prerequisites (all platforms — source builds only)

- **Node.js 20 or 22 LTS** — [nodejs.org](https://nodejs.org) or [nvm](https://github.com/nvm-sh/nvm)
- **Git**
- A working build toolchain for native node modules (`better-sqlite3`, `keytar`):
  - **Linux:** `build-essential libsecret-1-dev python3` (`sudo apt install build-essential libsecret-1-dev python3` on Debian/Ubuntu)
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload

That's it for the cross-platform parts. Platform-specific audio needs are below.

---

## Linux

### Run from source

```bash
git clone https://github.com/RomanSlack/simple_transcriber.git
cd simple_transcriber
npm install
npx electron-rebuild         # rebuild better-sqlite3 + keytar against Electron's node
npm run dev
```

### System audio capture

The app uses **PipeWire's `pw-record`** to capture speaker output. PipeWire ships by default on Ubuntu 22.10+ and most current distros. Confirm with:

```bash
which pw-record    # should print /usr/bin/pw-record
ps aux | grep -i pipewire
```

If PipeWire isn't installed:
```bash
sudo apt install pipewire pipewire-pulse wireplumber
```

No further configuration — the app reads sinks via `pw-dump` and captures their monitor with `pw-record -P stream.capture.sink=true`.

### Build a portable AppImage / .deb

```bash
npm run package:linux
# → release/Simple Transcriber-0.1.0.AppImage
# → release/simple-transcriber_0.1.0_amd64.deb
```

### Install the AppImage system-wide (recommended)

Once `npm run package:linux` has run successfully, the helper script below installs it so you can search for "Simple Transcriber" in your launcher and pin it to favorites:

```bash
./scripts/install-linux.sh
```

What it does:
1. Copies the AppImage to `~/.local/bin/SimpleTranscriber.AppImage` and marks it executable
2. Writes a `.desktop` entry to `~/.local/share/applications/simple-transcriber.desktop`
3. Installs the icon into `~/.local/share/icons/hicolor/256x256/apps/`
4. Refreshes the desktop database

To uninstall:
```bash
./scripts/uninstall-linux.sh
```

### Install the .deb instead

```bash
sudo apt install ./release/simple-transcriber_0.1.0_amd64.deb
```

---

## macOS

### Run from source

```bash
git clone https://github.com/RomanSlack/simple_transcriber.git
cd simple_transcriber
npm install
npx electron-rebuild
npm run dev
```

### System audio capture (one-time setup)

macOS doesn't expose system audio to apps natively — you need a virtual audio driver. We use **BlackHole 2ch** (free, open source).

1. Download and install BlackHole 2ch: https://existential.audio/blackhole/
2. Open **Audio MIDI Setup** (Spotlight → "Audio MIDI Setup")
3. Click `+` (bottom-left) → **Create Multi-Output Device**
4. In the right pane, check **both** your real speakers/headphones **and** BlackHole 2ch
5. Right-click the Multi-Output Device → **Use This Device For Sound Output**

Now anything that plays through your system goes to both your real speakers (so you can hear it) and BlackHole (so the app can capture it).

The app's onboarding wizard auto-detects BlackHole and confirms it's set up.

### Build a .dmg

```bash
npm run package:mac
# → release/Simple Transcriber-0.1.0.dmg
```

### Install the .dmg

Double-click the `.dmg`, drag **Simple Transcriber** to **Applications**, eject the volume.

**First launch:** macOS will show *"Simple Transcriber can't be opened because the developer cannot be verified."* (the build isn't notarized). Right-click the app → **Open** → **Open**. After that, it launches normally.

When you first hit record, macOS will prompt for microphone permission. Allow it.

---

## Windows

### Run from source

```powershell
git clone https://github.com/RomanSlack/simple_transcriber.git
cd simple_transcriber
npm install
npx electron-rebuild
npm run dev
```

> **Note:** If `electron-rebuild` fails with errors about Python or MSBuild, run from a "x64 Native Tools Command Prompt for VS" or `npm config set msvs_version 2022` first.

### System audio capture

Windows exposes system audio natively via **WASAPI loopback** — no extra software needed. The app uses Chromium's `desktopCapturer` API to tap it.

The first time you hit record, Windows will show a screen-capture permission prompt (because the API we use is technically a screen-capture path that also gives us audio). Click **Allow**.

### Build an .exe installer

```powershell
npm run package:win
# → release/Simple Transcriber Setup 0.1.0.exe
```

### Install the .exe

Double-click the installer. Windows SmartScreen will show *"Windows protected your PC"* (the build isn't code-signed). Click **More info** → **Run anyway**.

The installer creates a Start Menu entry and desktop shortcut. To uninstall, use **Settings → Apps**.

---

## API key

On any platform, after install:

1. Launch the app — onboarding starts on first run.
2. Get an OpenAI API key from [platform.openai.com](https://platform.openai.com) → API keys.
3. Paste it into onboarding step 2.

The key is stored in your **OS keychain** (Keychain Access on macOS, Credential Manager on Windows, libsecret/GNOME Keyring on Linux) via `keytar`. It is **never** written to disk in plaintext, never logged, never sent anywhere except the OpenAI API.

To rotate or remove the key later: **Settings → API key**.

---

## Data location

Recordings, transcripts, and the session database live in your OS app-data folder:

| OS | Path |
|---|---|
| Linux | `~/.config/Simple Transcriber/` |
| macOS | `~/Library/Application Support/Simple Transcriber/` |
| Windows | `%APPDATA%\Simple Transcriber\` |

A button in **Settings → Data → Open data folder** opens it in your file manager.

---

## Updating

The app currently has no auto-updater. To update:

1. `git pull` the latest source
2. `npm install` (in case dependencies changed)
3. `npx electron-rebuild`
4. `npm run dev` (or repackage with the platform commands above)

Your settings, API key, and session history are kept in the OS data folder, untouched by re-installs.

---

## Troubleshooting

See [ISSUES.md](ISSUES.md) for the catalog of gotchas we hit during development and the fixes that stuck — especially the PipeWire `stream.capture.sink=true` flag and the ffmpeg `amix normalize=0` setting.
