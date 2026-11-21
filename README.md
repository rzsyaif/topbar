# Island

A Dynamic Island for Windows: a pill at the top of the screen that shows what's playing (Spotify, YouTube Music in Chrome/Edge, anything that uses Windows media controls), time-synced lyrics, prayer times, weather and a Pomodoro timer. Hover to expand.

Built with **Tauri v2** (Rust) and **React + TypeScript**.

## Run it

Requirements (one-time, on Windows 10/11):

1. **Rust:** install from https://rustup.rs (pick the default MSVC toolchain).
2. **Visual Studio C++ Build Tools:** in the installer choose "Desktop development with C++".
3. **Node.js 20+**
4. WebView2 is already on Windows 11. On Windows 10, install the Evergreen runtime if it's missing.

Then:

```bash
npm install
npm run tauri dev      # run with hot reload
npm run tauri build    # makes an installer in src-tauri/target/release/bundle/nsis
```

The first `tauri dev` compiles all the Rust dependencies, so it takes a few minutes. After that it's quick.

### Install it for real (production)

```bash
npm run tauri build
```

This makes an installer at `src-tauri/target/release/bundle/nsis/Island_0.1.0_x64-setup.exe`. Run it; it installs per-user (no admin needed) and adds Island to the Start menu.

- **Start with Windows** is turned on automatically the first time the installed app runs. Toggle it any time from the tray icon (right-click → *Start with Windows*). It shows up in Task Manager → Startup apps too.
- **Updating:** change the code, bump `version` in `src-tauri/tauri.conf.json`, run `npm run tauri build` again and run the new installer over the old one.
- **SmartScreen:** the installer isn't code-signed, so Windows may show "Windows protected your PC". Choose *More info → Run anyway*.
- **Data:** the installed app keeps its own to-dos and notes, separate from the ones you made in `tauri dev`.

## Configure

Weather and prayer times follow your **device location** (Windows location service; turn on *Settings → Privacy & security → Location → Let desktop apps access your location*). If location is off, the island uses the last known place, then the fallback in [`src/config.ts`](src/config.ts).

Also in `src/config.ts`: prayer calculation and minute adjustments, Pomodoro lengths, and 12/24h time.

## How it works

```
┌─────────────── Rust (src-tauri/src) ───────────────┐     ┌──────── React (src) ────────┐
│ media.rs    polls Windows SMTC every 500 ms ──────────────▶ useMedia   "media-update"   │
│             play/pause/next/prev ◀──────────────────────── media_command               │
│ hittest.rs  cursor over pill? → accept clicks ◀──────────── useHitRect (pill rect)      │
│             otherwise → click-through                 │     │ useLyrics  → lrclib.net     │
│ lib.rs      transparent, always-on-top, top-center    │     │ useWeather → open-meteo     │
└───────────────────────────────────────────────────────┘     │ usePrayer  (offline, adhan) │
                                                              │ usePomodoro (local)         │
                                                              └─────────────────────────────┘
```

- **Media (`media.rs`):** reads Windows System Media Transport Controls, the same thing that drives the media popup when you press a volume key. No Spotify or Google sign-in needed. Album art is sent as a data URL when the track changes.
- **Click-through (`hittest.rs`):** the native window (640×420) is bigger than the pill so the pill can animate freely. The whole window ignores the mouse except the pill's rectangle, which the frontend reports on every resize.
- **Lyrics (`useLyrics.ts`):** looks up the track on LRCLIB (free, no key), exact match first, then a fuzzy search. YouTube-style title noise like "(Official Video)" and "- Topic" is stripped. The playback position is extrapolated between SMTC updates so lyrics stay in sync.
- **Tabs (expanded):** *Now* (music, lyrics, time, weather, prayer, Pomodoro), *Today* (daily to-do list), *Notes* (sticky-note board). To-dos and notes are saved locally (`localStorage`). At midnight finished to-dos clear and unfinished ones carry over, tagged "from yesterday". The island stays open while you type or drag a note; Esc or clicking another app folds it.
- **What the collapsed pill shows**, highest priority first: Pomodoro finished → prayer within 10 minutes (or started under 5 minutes ago) → Pomodoro running → music playing (current lyric line) → clock and next prayer.

## Releasing & auto-update

Releases are built by GitHub Actions (`.github/workflows/release.yml`) and
published to https://github.com/rzsyaif/topbar/releases. Installed copies check
`latest.json` there every few hours and offer the update in the clock-section
settings.

One-time setup:

1. Make a signing key (keep the private one safe and never commit it):
   `npx tauri signer generate -w "$env:USERPROFILE\.tauri\island.key"`
2. Paste the **public** key (contents of `island.key.pub`) into
   `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
3. On GitHub, add the secrets `TAURI_SIGNING_PRIVATE_KEY` (contents of
   `island.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. The repo (or at least its releases) must be public so installs can download updates.

Each release: bump `version` in `src-tauri/tauri.conf.json`, commit, then
`git tag v0.4.1` and `git push origin main v0.4.1`.

Without a public key in the config, the updater stays switched off and
everything else works as normal.

## Troubleshooting

- **Didn't start with Windows?** Island writes a short log to `%APPDATA%\com.kiki.island\startup.log`. A line with `(at sign-in)` means Windows launched it at sign-in; if there's none, Windows never started it. Also check Task Manager → Startup apps, where Island should be *Enabled*.

## Known gaps / next steps

- **Fullscreen:** the island still shows over fullscreen games and videos. Next step: detect a fullscreen foreground window (`SHQueryUserNotificationState` or comparing the foreground window to the monitor bounds) and hide.
- **Multiple monitors:** it sits on the primary monitor only.
- **Browser timeline:** some sites don't report song position to Windows. Lyrics will show but won't advance correctly there.
- **Settings UI:** the tray icon only has Quit for now; settings live in `src/config.ts`.
- SMTC follows the *current* session (the one Windows' media popup shows). If both Spotify and a browser are playing, Windows picks one.
