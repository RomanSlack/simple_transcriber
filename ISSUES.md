# Issues, Gotchas & Lessons Learned

Stuff that broke during development and isn't obvious from reading the code.

## Audio capture

### Linux: Chromium doesn't expose PipeWire monitor sources reliably
On Ubuntu 24.04 with PipeWire 1.0.5, `navigator.mediaDevices.enumerateDevices()`
returns 0 monitor sources, no matter what the user grants. The "G430 Mono"
input the user might pick is the *headset's microphone*, not its speaker
monitor — capturing it gives only their voice (or their voice + room
acoustics), not what's playing through their headphones.

**Fix:** native path. `src/main/linux-loopback.ts` shells out to `pw-dump`
for sink enumeration and `pw-record` for capture, writing PCM to a
session-local file.

### CRITICAL: `pw-record --target=<sink>` captures NOISE, not the monitor
This was the single hardest bug. By default, `pw-record --target=<sink>`
connects to the sink's *input* ports — what's being fed *into* the sink —
which on most setups is silence with a constant ~0.013 RMS noise floor.
The user thinks their app is broken because the level meter barely moves.

**Fix:** add `-P stream.capture.sink=true` to every `pw-record` invocation.
This tells WirePlumber to link the recording stream to the sink's *monitor*
ports (mirroring playback). RMS during loud audio jumps from 0.013 to 0.077+.

### `pw-dump` sometimes emits multiple JSON arrays back-to-back
We saw `Unexpected non-whitespace character after JSON at position 388961`
in `JSON.parse(stdout)` even though the same invocation from bash worked.
`pw-dump` occasionally appends a second array of partial updates after
the primary snapshot.

**Fix:** `parseFirstJsonArray()` walks brackets and parses only the first
balanced array.

### macOS needs BlackHole or ScreenCaptureKit (not implemented yet)
macOS doesn't expose system audio at all without help. Onboarding walks
users through installing BlackHole 2ch and creating a Multi-Output Device.
Untested in production — flagged for first-Mac install.

### Windows uses `desktopCapturer` (untested)
The Windows path uses Electron's `desktopCapturer.getSources({types: ['screen']})`
plus `chromeMediaSource: 'desktop'` to tap WASAPI loopback. Should work
out of the box but hasn't been driven by a real Windows user yet.

## Audio mixing

### Default `amix=normalize=1` is the muddiness culprit
`amix` defaults to `normalize=1`, which halves the amplitude of every input
before summing. With two streams loudnorm'd to -16 LUFS, the result was
muddy and the mic got buried under loud playback.

**Fix:** `amix=...:normalize=0` so each input contributes at full level.

### `amix=duration=longest` + truncated WebM → assertion crash
ffmpeg has an assertion `best_input >= 0 failed at src/fftools/ffmpeg_filter.c:1923`
that fires when amix is configured with `duration=longest` and one input ends
before the other. MediaRecorder commonly finalizes its WebM trailer a few
hundred ms before `pw-record` stops the PCM, triggering the assertion.

**Fix:** `duration=shortest`. Lose at most a few hundred ms at the end.

### `apad` with no params pads infinitely (runaway output)
While trying to work around the assertion above, I tried `apad` on both inputs
to keep them flowing. `apad` with no `whole_dur` pads forever, and with
`duration=shortest` ffmpeg never stops because neither stream "ends." Output
file grew unboundedly during testing.

**Don't add `apad` unless you set `whole_dur` or `pad_dur`.**

### One-pass `filter_complex` with a malformed WebM still crashes
Feeding the raw WebM directly into `filter_complex` triggers the same
`best_input >= 0` assertion even with `duration=shortest`, because ffmpeg's
matroska demuxer fails partway through reading a half-closed cluster.

**Fix:** two-pass mix. Transcode each source to a clean intermediate mp3
in isolation (where bad demux errors stay local), then `amix` two clean
mp3s. See `obsStyleMix` in `src/main/ffmpeg.ts`.

### Per-source compression / sidechain ducking is overkill for meetings
We tried an OBS-style chain (highpass + denoiser + gate + compressor +
ducking + limiter). Verdict: meetings have people taking turns, so just
loudnorm + sum is fine. Roman's call — simpler is better.

## OpenAI API

### `gpt-4o-transcribe` doesn't support `verbose_json` / timestamps
Only `whisper-1` supports `response_format: 'verbose_json'` with
`timestamp_granularities: ['segment'|'word']`. If you need per-segment
timestamps for multi-stream interleaving, you must use whisper-1.

This is why we went with single-file mixing instead of per-stream
transcription + segment merging — the latter requires whisper-1, which
is older and less accurate.

### `p-limit` v6+ is ESM-only and breaks CommonJS Electron main
Electron's main process compiles to CommonJS. `p-limit@^6.0.0` is pure
ESM and `require()` throws `ERR_REQUIRE_ESM` at runtime. Pinned to
`p-limit@^3.1.0`.

## Electron / TypeScript

### tsc output layout matters for the main entry point
With `rootDir: "src"` and `outDir: "dist"`, tsc preserves the path
under `src/`, so `src/main/index.ts` compiles to `dist/main/index.js`
(not `dist/index.js`). `package.json` `"main"` must point at the
correct nested path, and relative `loadFile()` paths in main must use
`../renderer/index.html` since `__dirname` is `dist/main`.

### Electron 32+ removed `File.path` for drag-dropped files
The renderer used to read `file.path` directly. Now we expose
`webUtils.getPathForFile(file)` via the preload bridge.

### Linux dev needs `--no-sandbox` (until chrome-sandbox is setuid root)
Out of the box, electron-dev fails with
`The SUID sandbox helper binary was found, but is not configured correctly`.
`package.json`'s `dev:electron` script appends `--no-sandbox`. Packaged
builds handle this correctly.

### `nativeTheme.themeSource` is the single source of truth for theme
For the dark-mode toggle, don't try to manage current theme state in two
places. Set `nativeTheme.themeSource = 'system' | 'light' | 'dark'`,
listen for `nativeTheme.on('updated', …)`, and broadcast effective theme
to renderers. The renderer applies `data-theme="dark|light"` on
`document.documentElement`.

## Storage

### SQLite WAL mode is required for crash durability
Default `journal_mode=DELETE` means a crash mid-write can corrupt the DB.
We use `journal_mode=WAL, synchronous=NORMAL` for durable commits without
fsyncing every write. This survives `pkill -9 electron` cleanly.

### Per-session files left around on crash
After a hard crash, you can have:
- `audio.webm` (mic, with a half-finalized trailer)
- `system.pcm` (raw loopback)
- `audio.mp3` (possibly 0 bytes)
- `meta.json`
- `transcript.txt` (possibly missing)

The startup recovery scan (`src/main/recovery.ts`) finds sessions whose
status is not in {done, error} and re-runs the transcription pipeline.
For zero-byte `audio.mp3` left over from a failed mix, the new run
overwrites it.

## To-do / known limitations

- macOS BlackHole + Multi-Output Device flow has never been driven on
  real hardware.
- Windows path is untested end-to-end.
- No code signing on macOS / Windows — packaged builds show the standard
  "unidentified developer" warnings.
- App icon is a single 1024×1024 PNG — electron-builder generates ICO
  and ICNS from it at package time. If quality at small sizes (16×16 in
  Windows taskbar) is bad, swap in a hand-tuned 16/24/32px PNG.
- For recordings over ~25 minutes per chunk, OpenAI's 25 MB upload limit
  becomes the binding constraint. Default chunk = 600 s (10 min), which
  keeps each chunk well under 25 MB at our mp3 -q:a 4 setting.
