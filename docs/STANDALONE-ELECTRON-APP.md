# Stand Alone Electron App

A macOS desktop app for Attic Music, installed from a `.dmg` and launched from the
Dock. It lives in [`electron/`](../electron) and is **not** part of the Vite app or
the Docker/k8s deploy. The PWA and the browser keep working unchanged for other
computers.

See also: [ARCHITECTURE.md](ARCHITECTURE.md) §3.1–3.2 (auth) and the README
"Mini-player mode" section.

## 1. What it is

A thin Electron shell that **loads the live site** (`https://music.ekskog.me`,
overridable with the `ATTIC_URL` env var). There is no bundled copy of the web app,
so every web deploy reaches the desktop app on its next launch with no rebuild.
Rebuild the app only when something in `electron/` changes.

It exists because a PWA/browser page cannot resize or float its own window, and
because the web build deliberately never stores a login. The shell adds exactly
two native features:

1. **Mini-player window** — the page can shrink and float the window.
2. **Remembered login** — credentials stored encrypted in the macOS Keychain, with
   a silent login on launch.

Everything else (library, playback, Last.fm, Ask AI…) is the normal web app.

## 2. Files

| File | Role |
|---|---|
| `electron/main.js` | Main process: window, external links, mini-window IPC, encrypted credential store |
| `electron/preload.js` | Exposes `window.attic` to the page via `contextBridge` (nothing else) |
| `electron/package.json` | Scripts (`start`, `dist`) and the `electron-builder` config |
| `electron/build/icon.png` | App icon (copy of `pwa-icons/icon-512.png`) |
| `electron/README.md` | Short build/run notes |

Web-side files that talk to the shell: `src/stores/ui.js` (mini mode),
`src/App.vue` (`autoLogin`), `src/views/Login.vue` ("Remember on this Mac"),
`src/stores/config.js` (`logout` clears the stored login).

## 3. The bridge — `window.attic`

Defined by `preload.js`; **undefined in a browser or the PWA**, which is how the web
code detects Electron (`window.attic?.…`).

| Call | Does |
|---|---|
| `setMini(on)` | `on`: remember the window size, shrink to 380×160 and float on top. Off: restore the previous size |
| `getCredentials()` | Promise → `{server, username, password}` or `null` |
| `saveCredentials({server, username, password})` | Promise → `true`/`false` |
| `clearCredentials()` | Promise → `true`/`false` |

Security model: `contextIsolation` on, `nodeIntegration` off, `sandbox` on. Every
IPC handler in `main.js` checks that the calling frame's origin equals the app's
origin (`fromApp`), so only the site itself can use the bridge. Links to any other
origin open in the default browser instead of inside the app.

## 4. Mini-player mode

Toggled by the `PanelLeftClose` button at the bottom of the sidebar (exit with
`PanelLeftOpen` in the mini window). The web app (`ui.minimal`) replaces the whole
UI with `MiniWindow.vue` and calls `window.attic.setMini(...)`; the shell resizes
the window.

- **Size** is `MINI_SIZE = 380×160` in `main.js`. It is the *outer* size, so it
  includes the ~28px macOS title bar — 120 clipped the content, 160 fits.
- **The Electron app always starts in full mode.** `ui.js` ignores the saved
  `attic_ui_minimal` flag when `window.attic` exists, otherwise quitting in mini
  mode would reopen a tiny window. (The PWA/browser still restore the flag.)
- The footer's chevrons-down button is a *different*, older feature (a thin strip,
  `CompactPlayer`). It never calls `setMini`, so it does not resize the window.
- The toggle lives in the desktop sidebar, which only exists at ≥768px wide
  (`md`). In a narrower window the app shows the mobile layout without it — keep
  the window wide, or toggle from the DevTools console with `window.attic.setMini(true)`.

## 5. Remembered login

The web build never persists credentials. The Electron app is the only exception:

- First run: the login form shows a **Remember on this Mac** checkbox (ticked by
  default). It appears only when `window.attic` exists.
- Credentials are stored in `credentials.bin` in the app's data folder, encrypted
  with Electron `safeStorage` (the key is held in the macOS Keychain). **Never
  plaintext:** if encryption is unavailable, saving is refused.
- On launch `App.vue` runs `autoLogin()` after `config.load()` and before the
  first render: it reads the credentials, verifies them with `ping()`, then logs in
  and skips `/login`. No credentials, or the ping fails (offline, changed
  password) → the normal login form, pre-filled.
- **Sign out** deletes the stored credentials.
- The Cloudflare Turnstile widget is client-side only and is not shown on a silent
  login.
- Each Mac keeps its own credentials. macOS may ask for Keychain access the first
  time — choose **Always Allow**. The dev app (`npm start`) and the packaged app
  have different data folders and Keychain entries, so you log in once in each.
- Any script running on the site's origin can call `getCredentials()`. This equals
  the exposure of a password held in memory, which is why the calls are
  origin-gated.

## 6. Run it (development)

```
cd electron
npm install
npm approve-scripts electron     # npm blocks Electron's postinstall otherwise
npm rebuild electron
npm start
```

To test web changes before deploying: run the Vite dev server and start with
`ATTIC_URL=http://localhost:5173 npm start`.

Startup noise such as `Failed parsing key usage` (Chromium reading an odd
certificate in the macOS keychain) and `stun.*` resolution errors is harmless.

## 7. Build and install

```
cd electron
npm run dist
```

Output in `electron/dist/`:

- `Attic Music-1.0.0-arm64.dmg` — the installer
- `mac-arm64/Attic Music.app` — the app itself

Install: open the `.dmg`, drag **Attic Music** to **Applications**, launch it,
then right-click its Dock icon → **Options → Keep in Dock**.

The build targets the architecture of the Mac it runs on (arm64 here). For a Mac
of another architecture, build for it (`--x64`, `--arm64` or universal) — not yet
tried. For a second Mac of the same architecture, copy the `.dmg` over.

### Unsigned app

There is no Apple Developer certificate, so the app is unsigned. On first launch
macOS Gatekeeper blocks it: right-click → **Open** → **Open**, or

```
xattr -cr "/Applications/Attic Music.app"
```

If the app still won't open, its inherited ad-hoc signature may be invalid
(`codesign --verify` reported `code has no resources but signature indicates they
must be present` on the first build). Re-sign it ad-hoc, which needs no
certificate:

```
codesign --force --deep --sign - "/Applications/Attic Music.app"
```

Signing and notarization (a paid developer account) would only be needed for
distributing to other people or for auto-update.

## 8. Troubleshooting (things hit while building this)

| Symptom | Cause / fix |
|---|---|
| `Electron failed to install correctly` on `npm start` | npm blocked Electron's postinstall (`allow-scripts` warning). `npm approve-scripts electron` then `npm rebuild electron` |
| Still failing; `node_modules/electron/path.txt` missing, `dist/Electron.app` half-extracted, installer exits 0 | The installer's unzip library silently stopped on **Node 26**. Unpack the cached zip by hand: `cd node_modules/electron && rm -rf dist && unzip -q ~/Library/Caches/electron/*/electron-v33.4.11-darwin-arm64.zip -d dist && printf 'Electron.app/Contents/MacOS/Electron' > path.txt`. Using Node 22/24 LTS is the likely lasting fix (untested) |
| Toggle does nothing in the Electron app | The deployed web build doesn't contain the `window.attic` calls yet — commit **and deploy** `src/stores/ui.js`. Remember `git add .` from `electron/` stages only that folder |
| Toggle button missing | Window narrower than 768px → mobile layout. Widen the window (a docked DevTools counts) |
| Mini window clips the title | Height is the outer size incl. the title bar; keep `MINI_SIZE.height` ≈ 160 |
| `hdiutil … failed, retrying` during `npm run dist` | Retries only; the `.dmg` was still written |
| `Cannot read properties of null (reading 'provider')` at the end of `npm run dist` | electron-builder tried to write auto-update info with no publish target. `build.dmg.writeUpdateInfo: false` skips it (fix applied; not yet re-run). The `.dmg` and `.app` were already built |
| `author is missed` / `Cannot detect repository` | Harmless warnings; no author/repository set in `electron/package.json` |

## 9. Limits and open items

- macOS only; unsigned; no auto-update (not needed — the site updates itself).
- ~100–230 MB per install (it bundles Chromium).
- No draggable title area or global media-key handling has been added or verified.
- The Node-LTS fix, the other-architecture build and the `writeUpdateInfo` fix are
  untested at the time of writing.
