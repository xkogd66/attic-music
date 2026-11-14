# attic-music

A responsive Vue 3 music player webapp that connects to a Subsonic-compatible server (Gonic) for music library browsing and playback, with optional Last.fm scrobbling.

> 📖 Codebase architecture: see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

> 🖥️ macOS desktop app: see [docs/STANDALONE-ELECTRON-APP.md](docs/STANDALONE-ELECTRON-APP.md).

## Tech Stack

- **Vue 3** — Composition API with `<script setup>` SFCs throughout
- **Pinia** — state management (player queue/state, user config)
- **Vue Router v5** — SPA routing with auth guards
- **Tailwind CSS v4** — via `@tailwindcss/vite`; accent color `--accent: #B85C38`
- **Vite** — dev server and build tool
- **No test framework** — none configured

## Commands

```bash
npm install       # install dependencies
npm run dev       # start dev server (http://localhost:5173)
npm run build     # production build → dist/
npm run preview   # serve production build locally
```

## Project Structure

```
mcp-server/      # gonic MCP server for Claude Code (merged in, see below) — NOT part of the Vite app
electron/        # macOS desktop wrapper around the live site (see electron/README.md) — NOT part of the Vite app
chat-server/     # Ask AI backend — Node HTTP + LLM tool loop (see below) — NOT part of the Vite app
  index.js        # the server: POST /chat, GET /providers, Subsonic search tool
  Dockerfile      # → ghcr.io/xkogd66/chat-server:latest
k8s/
  deployment.yaml            # the Vite app
  artist-images.yaml         # Go sidecar
  chat-server.yaml           # Ask AI backend + LLM_PROVIDERS config
  chat-server-secret.example.yaml  # template for chat-server-secret — fill in, never commit
artist-images/
  main.go         # Go sidecar — serves artist cover.jpg from NFS
  Dockerfile      # multi-stage build → minimal Alpine image
src/
  api/
    subsonic.js   # Subsonic REST API client
    chat.js       # Ask AI backend client (askAI + fetchProviders)
    lastfm.js     # Last.fm scrobbling integration
    lyrics.js     # LRCLIB lyrics fetching + manual lyrics
    genres.js     # 40 curated standard genre names
    tags.js       # album/track tag writes via the artist-images sidecar
    maintenance.js # library maintenance ops (audit/cleanup/convert/enrich) via the sidecar
  stores/
    config.js     # user config (server URL, credentials, lastfm)
    player.js     # playback state, queue, shuffle/repeat
    playlist.js   # playlist list cache + addTrack action
    filters.js    # genre/year filter state shared by the views and the sidebar
  router/
    index.js      # route definitions + auth guards
  views/
    Login.vue     # auth form
    Folders.vue   # folder-based library browsing
    Home.vue      # mobile landing: 3 discovery carousels
    Artists.vue   # artist/album/track browsing
    Albums.vue    # album grid with genre/year filters + carousels
    Playlists.vue # playlist list + detail
    Search.vue    # search view
    Tools.vue     # library maintenance: audit / tag cleanup / artwork / convert / enrich
  components/
    Player.vue       # desktop footer player + queue
    MiniPlayer.vue   # mobile mini player
    FullPlayer.vue   # mobile full-screen player
    BottomNav.vue    # mobile bottom nav (6 tabs)
    SideBar.vue      # desktop sidebar (search + nav + filters + last.fm scrobbles), collapsible
    LibraryFilters.vue # desktop genre/year filter dropdowns in the sidebar
    RecentPlays.vue  # last.fm recent scrobbles; album name opens the album
    AskAiModal.vue   # desktop Ask AI overlay (opened by "✨ Ask" in the sidebar search field)
    FolderNode.vue   # expandable folder tree node
    TrackItem.vue    # track list item
    ArtistCard.vue   # artist grid card with circular avatar
  App.vue           # root layout + auth check
  main.js           # entry point
  style.css         # Tailwind import + root styles + dark-mode palette
```

## Architecture Notes

### Auth & Config
- On load, the app fetches `/config.json` for server-provisioned settings (Last.fm API key, optional pre-configured server)
- **Credentials are never persisted.** They live in the Pinia store in memory
  only, so every reload and every new tab requires logging in again. There is
  deliberately no "remember me" — an earlier build stored the password in
  plaintext under `localStorage.attic_cfg`, and `load()` now deletes that key
  on startup to clear it from machines that still have one.
  **Exception — the Electron wrapper** (`electron/`): the login form offers
  "Remember on this Mac", and the credentials are stored encrypted with
  Electron `safeStorage` (Keychain-backed), never as plaintext. On launch
  `App.vue` logs in silently from them; Sign out forgets them. Nothing stored
  or a failed ping → the login form, pre-filled
- `Login.vue` verifies credentials with a real `ping()` against the server
  before `saveSession()` sets `loggedIn`; a failed ping never logs you in
- Route guards block all routes until `config.loggedIn` is true, and `App.vue`
  renders the library layout only when `loggedIn` — logged out, the login
  screen is the entire component tree, so nothing behind it can mount or fetch
- In CI, the GHA workflow writes `public/config.json` (including `lastfmKey` from the `LASTFM_API_KEY` GitHub Actions secret) before the Docker image is built, so the key is baked into the image as a static file served by Nginx

### Routing
- Default route `/` redirects to `/home`
- `/home` → `Home.vue` (mobile discovery landing page)
- `/artists`, `/artists/:id` → `Artists.vue`
- `/albums`, `/albums/:id` → `Albums.vue`
- `/playlists`, `/playlists/:id` → `Playlists.vue`
- `/search` → `Search.vue`
- `/tools` → `Tools.vue` (library maintenance: audit / cleanup / artwork / convert / enrich)

### Subsonic API
- All music data comes from `src/api/subsonic.js`, which wraps the Subsonic REST API
- Auth uses hex-encoded password per Subsonic spec; client ID is `atticweb`, API version `1.16.1`
- Dev server proxies `/rest` → `https://gonic.ekskog.net` (see `vite.config.js`)
- Production traffic hits the server the user logs into directly from the browser
- `search3` returns artists (5), albums (8), and songs (8); `getArtistGenreMap()` uses plain arrays (not Sets) for Vue reactivity
- `getRandomAlbums(n)` is used for the desktop discovery carousels and the Home page
- `getAlbumPage(size, offset, type)` wraps `getAlbumList2`. `type` defaults to
  `alphabeticalByName` and is what the mobile Albums sort chips switch between
  (`alphabeticalByName` | `newest` | `random`)

### NFS File Structure
- Subsonic indexes media from an NFS Share. The structure of the share is:
./mp3/<first letter in artist name>/YYYY-album_name_with_underscore, as below:
/var/lib/media/music/mp3 $ tree | more
.
├── 1
│   ├── !!!
│   │   ├── 2013-thr_er
│   │   │   ├── 01-01-even_when_the_water's_cold.mp3
│   │   │   ├── 01-02-get_that_rhythm_right.mp3
│   │   │   └── cover.jpg
│   │   └── cover.jpg
│   ├── 10,000_maniacs
│   │   ├── 1983-unplugged_on_mtv_preshow
│   │   │   ├── 01-01-how_you've_grown_take_1.mp3
│   │   │   ├── 01-09-how_you've_grown_take_3.mp3
│   │   │   └── cover.jpg
│   │   └── cover.jpg
├── a
│   ├── abba
│   │   ├── 1993-gold
│   │   │   ├── 01-01-dancing_queen.mp3
│   │   │   ├── 01-06-super_trooper.mp3
│   │   │   └── cover.jpg
│   │   └── cover.jpg

### Artist Images
- **Artist avatars are stored as 150×150 JPEGs.** `/upload-avatar` centre-crops and scales down every upload (never up), and `POST /artist-images/resize-avatars` does the same to the existing library (preview by default; `?apply=1` overwrites the originals — no undo; re-runnable, skips files already done). The artists grid requests every avatar, so full-size files (100–840 KB) saturated the single Cloudflare tunnel and stalled audio/uploads/Home. Album covers are not resized.
- All artist folders on the NFS share have a `cover.jpg` (pre-fetched externally)
- Gonic does **not** populate `artist.coverArt` in `getArtists` — the field is always empty regardless of indexing
- A dedicated Go sidecar (`artist-images/`) serves images directly from the NFS volume, bypassing the Subsonic API entirely
- Gonic does **not** serve standalone `cover.jpg` files via `getCoverArt` — it only returns embedded ID3 art; the sidecar is the authoritative source for both artist and album cover art
- `ArtistCard` image fallback chain: sidecar (`/artist-images/avatar?name=<artist>`) → Subsonic `getCoverArt?id=<artistId>` → letter placeholder
- Artist avatars are always rendered circular (`rounded-full`) everywhere they appear (grid cards, carousels on Home/Artists, artist-detail hero, mobile contact-list, avatar-picker modal); album covers stay square/`rounded-lg`/`rounded-xl` and are never circular. The avatar-picker modal is shared between avatar and album-cover search, so its thumbnail shape is conditional on `coverSearchTarget === 'avatar'`
- Album cover fallback chain (carousel, grid, detail): Subsonic `getCoverArt?id=<albumId>` → sidecar (`/artist-images/album?artist=<artist>&album=<album>`) → "Add cover" upload button → 💿 placeholder
- Album detail views (`Artists.vue`, `Albums.vue`) use reactive `albumDetailCoverSrc`/`albumDetailCoverState` refs (`'loading'` → `'sidecar'` → `'failed'`) to drive the fallback chain; when both sources fail, an "Add cover" label/file-input is shown
- Album grid cards (artist detail view) use the DOM-based `onAlbumCoverError(e, album)` pattern (same as Albums.vue carousel/grid) — tries sidecar via `dataset.triedSidecar`, then hides
- The sidecar builds three maps at startup and rescans every 5 minutes: artist covers (`normalize(artist)` → path), album covers (`normalize(artist)|normalize(album)` → path), and album dirs (`normalize(artist)|normalize(album)` → directory path, regardless of whether a cover exists)
- `/album`, `/upload`, `/album-tags` and `/track-tags` take an optional `dir` param — the album folder relative to the music root, from gonic's track `path` (what the "On-disk location" box shows). The album views always send it, and the sidecar then uses that folder directly instead of matching names; `albumDirMap` is only the fallback when `dir` is absent. This fixed "album directory not found" for albums whose tags and folder name disagree (e.g. tag `beet, maize & corn` vs folder `2003-beet_maize__corn`). The maintenance/Tools endpoints still use only the name lookup
- `albumDirMap` enables the `/upload` POST endpoint: accepts `artist` + `album` query params and a `cover` multipart file, writes it as `cover.jpg` into the album directory on the NFS share, and updates `albumCoverMap` immediately; after upload the frontend requests the sidecar URL with `?t=<timestamp>` to bust browser cache
- Album folders are named `YYYY-album_name_with_underscores`; the sidecar strips the leading `YYYY-` before normalizing so it matches the API album name
- The artist folder name corresponds to the **Album Artist** mp3 tag (e.g. `bob_seger`), not the track Artist tag (e.g. `bob seger & the silver bullet band`); the frontend uses `album.albumArtist || album.artist` when building the sidecar URL
- Directory structure scanned: `<root>/<letter>/<artist_folder>/cover.jpg` (artist) and `<root>/<letter>/<artist_folder>/YYYY-album_folder/cover.jpg` (album)
- Request logging (HIT/MISS with latency) is controlled by the `LOG_REQUESTS` env var, set via ConfigMap `artist-images-config` in namespace `webapps`
- In dev, Vite proxies `/artist-images` → `http://localhost:8081`; in production, Nginx proxies it to the `artist-images` ClusterIP service
- Manifest: `k8s/artist-images.yaml` (ConfigMap + Deployment + Service); image: `ghcr.io/xkogd66/artist-images:latest`

### Player
- HTML5 `<audio>` element handles actual playback; Pinia store (`player.js`) manages reactive state
- Stream URLs are authenticated Subsonic `/stream` endpoints
- Queue, shuffle, repeat, seek, and progress are all store-managed

### Playlists
- Playlists are fully server-side (Gonic); `getPlaylists`, `getPlaylist`, `updatePlaylist`, `deletePlaylist` are all in `subsonic.js`
- `playlist.js` store caches the playlist list (fetched once on first use); `addTrack(playlistId, trackId)` calls `updatePlaylist` to append a song
- `TrackItem`'s `+` button opens an inline dropdown listing playlists plus an "Add to queue" option — no view changes required; the dropdown is self-contained in the component

### TrackItem
- `TrackItem.vue` is used in both album detail (`Artists.vue`) and playlist detail (`Playlists.vue`)
- On mobile: artist shown as a subtitle line below the track title
- On desktop (`md:`): artist shown in a dedicated second column; grid is `28px 1fr 1fr 44px 28px` (# / Title / Artist / Time / action)
- Header rows in `Artists.vue` and `Playlists.vue` use the same responsive grid template to stay aligned

### Artist Detail
- Album cards show year and track count (`album.songCount` from the `getArtist` response) as `1967 · 13 tracks`
- Breadcrumb letter (e.g. `t` for The Beatles) is stored and displayed lowercase; do not apply `uppercase` CSS to it

### Album Genre Editing
- Users can override the genre of any album in the album detail panel
- Overrides are stored in `localStorage` under key `attic_genre_<albumId>`
- The genre editor is a combobox using `src/api/genres.js` (40 curated standard genres); `@mousedown.prevent` prevents blur before click
- `genreVersion` ref is incremented on save to force the `albumGenre` computed to re-evaluate (localStorage is not reactive)

### Responsive Layout
- Desktop: sidebar + main content + footer player
- Mobile: full-width content + mini player + full-screen player modal + bottom nav (5 tabs)
- Breakpoint is Tailwind's `md:` (768px)

### Desktop Sidebar (SideBar.vue)
- Top to bottom: title (server URL is its tooltip) + collapse button → search
  field with **"✨ Ask"** inside it (opens `AskAiModal`) → Library nav →
  `LibraryFilters` (Artists/Albums routes only) → Recent plays → footer
  (Sign out · dark-mode toggle · rescan · mini player)
- Layout rules: every section is `px-4` with `px-2` inside, so all text sits on
  one 24px left edge; sections are separated by spacing, **no divider lines**;
  every section heading uses the same `text-xs font-medium uppercase
  tracking-widest text-stone-600`
- **Collapsible**: `«` next to the title shrinks it to a `w-14` strip of nav
  icons (labels as tooltips) with a `»` to expand. Not persisted — a reload
  expands it. The collapsed strip has no footer actions
- Rescan (`startScan`, polls `getScanStatus` every 30s) lives in the footer; the
  icon spins while a scan runs

### Dark Mode
- Toggled by the moon/sun button (sidebar footer on desktop, Home top bar on
  mobile) via `ui.toggleDark()`; sets the `dark` class on `<html>`
- Choice saved in `localStorage.attic_ui_theme` (`dark` | `light`); until one is
  picked, the app starts in the system's `prefers-color-scheme`
- **It is a palette swap, not `dark:` classes**: `src/style.css` redefines the
  Tailwind v4 colour variables under `.dark` — the stone scale is reversed,
  `white` becomes the dark panel colour, amber tints go dark for backgrounds and
  light for text. Existing light/dark pairs (e.g. `bg-stone-900 text-white`)
  stay readable without touching components. Fix any spot that looks wrong
  individually rather than adding `dark:` everywhere
- Known/likely rough spots (unverified): `text-white` over `bg-black/…`
  overlays turns dark; the 1px black `img` hairline is invisible on dark; a
  light flash on load before the class is applied; the collapsed sidebar has
  no toggle; on mobile the toggle is on Home only

#### iOS rules — do not "simplify" these away
- The app root in `App.vue` is `h-[100dvh]`, **not** `h-screen` / `100vh`. On iOS
  `100vh` is the viewport *without* the browser chrome, so the app lays out taller
  than the visible area and the bottom nav ends up under Safari's toolbar.
- `src/style.css` forces `input, select, textarea` to `font-size: 16px !important`
  below the `md` breakpoint. WebKit zooms the page in whenever a focused control is
  under 16px, and it does not zoom back out — every iOS browser is WebKit, so this
  affects Safari, DDG and Edge alike. The `!important` is load-bearing: Vue scoped
  styles are unlayered, so `Login.vue`'s `.input[data-v-…]` (specificity 0,2,0)
  beats a bare `input` rule without it.

### Mobile Navigation (BottomNav)
- 5 tabs: Home (House), Artists (Mic2), Albums (Disc3), Playlists (ListMusic), Search (Search) — all lucide icons
- Active tab: amber; inactive: stone-400
- `isActive(path)` uses `route.path.startsWith(path)`

### Mobile Home Page (Home.vue)
- Landing page for mobile; loads on app start (`/` redirects to `/home`)
- Top bar is the app identity — `public/favicon.svg` (the record mark) + "attic music"
  in the serif face — not a breadcrumb of the current route
- **Three static rows of four, no horizontal scrolling anywhere**: **Recently Added
  Artists** (distinct artists derived from `getNewestAlbums`), **Recently Added
  Albums**, **Discover Albums** (`getRandomAlbums`)
- Each row header carries a `Show all ›` link → `/artists` or `/albums`
- Rows are `px-4 grid grid-cols-4 gap-2`; the views slice with `.slice(0, 4)`
- All three rows are fed by the same three requests fired on mount — the carousels
  were replaced without adding an API call
- Desktop shows the same three rows as single-row grids (`auto-fill minmax(7.5rem,1fr)`
  with `grid-auto-rows:0`, so only the first row is visible and nothing is cut off
  at narrow widths), wrapped in `hidden md:block`; the mobile rows are `md:hidden`.
  Keep those desktop rows free of bottom padding — collapsed rows overflow into it.
- Desktop footer player (`Player.vue`): below `lg` the track info narrows and the
  volume slider is hidden so Lyrics/Queue always fit
- Desktop footer player can be **minimized** to `CompactPlayer.vue`, an
  iTunes-MiniPlayer-style `h-12` strip (cover + title/artist + prev/play/next +
  thumbnail scrubber). Chevrons-down in the full footer minimizes, any of the
  strip's cover/chevrons-up expands. State is `attic_player_minimized` in
  `localStorage`; minimizing closes the Queue/Lyrics panels. Mobile is
  unaffected — `MiniPlayer`/`FullPlayer` stay the mobile path, and both desktop
  players are `hidden md:flex`

### Mini-player mode (desktop PWA)
- The sidebar footer's `PanelLeftClose` button turns the whole app into a mini
  player (`MiniWindow.vue`: cover, title/artist, scrubber, prev/play/next). The
  sidebar and every view are unmounted; playback is untouched (audio lives in
  the `player` store). The `PanelLeftOpen` button in the window exits. State is
  `attic_ui_minimal` in `localStorage` via the `ui` store (`src/stores/ui.js`),
  so the PWA/browser reopens in mini mode (the Electron wrapper always starts
  in full mode)
- **The page cannot resize its own window** (Safari web apps ignore
  `window.resizeTo`): shrink the PWA window by hand once. The layout fills any
  size and ignores the `md` breakpoint, so a small window does not flip to the
  mobile UI. Independent of the `minimized` footer strip above
- Carousels were dropped on mobile because they were never used — three visible
  items and a teasing sliver of a fourth, with everything else behind a swipe

### Mobile Artists Page (Artists.vue)
- **Header** (mobile): search input + Genre dropdown + Year dropdown in one row, with
  a sort-chip row beneath it. Genre/year filter data comes from `getArtistGenreMap()`
  (loaded async, uses plain arrays for Vue reactivity).
- **Sort chips**: `A–Z` | `Added` | `Discover`. `getArtists()` offers no server-side
  ordering beyond alphabetical, so all three are ordered client-side over the full
  in-memory index:
  - `A–Z` — index order, already alphabetical
  - `Added` — ranked via a `Map` built from the `getNewestAlbums(100)` artist order
    (`addedOrder` / `addedRank`). Artists outside that window sort last, alphabetically.
    Only artists appearing in the newest 100 albums have a real position.
  - `Discover` — random sort keys re-rolled by a `watch` each time the chip is picked.
    Rolling them inside the computed instead would reshuffle on every reactive read.
- A single `mobileArtists` computed feeds one `grid-cols-4` grid: every artist,
  filtered by the search box and genre/year, in the chosen order
- Avatars carry `loading="lazy"` — the grid can render the entire library at once
- The mobile grid is mounted only when `isMobile` (`matchMedia('(max-width: 767px)')`) — a CSS-hidden copy on desktop still made the browser fetch every avatar. Don't revert it to a plain `md:hidden`.
- `getArtistGenreMap()` is cached for the session (a reload refreshes it), and the view starts it only after the grid has loaded
- **Gone on mobile**: the alphabetical contact list with letter-group headers, and the
  two browse carousels. Searching now filters the grid in place.
- Desktop: unchanged — letter nav + genre/year filters + expandable letter groups + carousels

### Albums Page (Albums.vue)
- Genre and year filters. **Mobile**: native dropdowns in the page header.
  **Desktop**: dropdowns in the sidebar (`LibraryFilters.vue`), shown only on the
  Artists/Albums routes, with a single `Clear` pill next to the FILTER heading.
  Both write the same `filters` store (`src/stores/filters.js`)
- The filter options and results cover only the albums paged in so far (pages
  of 100); picking a filter that matches nothing yet keeps paging until it does
- **Mobile sort chips**: `A–Z` | `Added` | `Discover`. Their ids *are* the
  `getAlbumList2` types, so changing sort re-pages from the server (`loadAlbums()`
  resets and refetches) rather than re-sorting on the client. Infinite scroll keeps
  working in every mode.
  - `Discover` (`random`) hands back a fresh sample per request, so paging it would
    repeat albums. It loads one page and sets `allLoaded`. Marked with a `ponytail:`
    comment in `loadMore()` — raise `pageSize` if one page is too few.
- The album grid is always visible now (no show/hide juggling): `grid-cols-4` on
  mobile, `auto-fill minmax(100px, 1fr)` at `md`
- **Desktop only** (`hidden md:block`): the Recently Added carousel (with its arrow
  buttons) and the Discover carousel
- Full album list loads in pages of 100 via `getAlbumPage` + an IntersectionObserver
  on a sentinel div
- Clicking an artist name navigates to that artist in the Artists view

### Last.fm
- Optional; polls `https://ws.audioscrobbler.com/2.0/` every 30 seconds to show recent scrobbles in the sidebar
- Requires `LASTFM_API_KEY` (injected at runtime, not build time)
- The app never scrobbles to Last.fm itself: it calls gonic's Subsonic `scrobble`
  with the song id, and gonic submits it with the file's tags (album included)
- Recent plays (`RecentPlays.vue`) shows track, artist and album; **only the album
  name is clickable**. A scrobble carries no Subsonic id, so the click resolves it
  with `findLibraryAlbum()` (`src/api/lastfm.js`: `search3` on the album name,
  prefer name + artist match, fall back to name-only for compilations) and opens
  the `album-detail` route. No match → "not in library"

### Search (SideBar + Search.vue)
- Desktop search is in the sidebar (`SideBar.vue`); results show Artists, Albums, and Songs
- Song results in sidebar call `player.playTrack(song, [song], 0)` on click
- Mobile has a dedicated `/search` route
- **Ask AI is separate from search on desktop** — the sidebar box is plain
  search only. The "✨ Ask" button inside it opens `AskAiModal.vue`. On mobile the
  two still share one view via the ✨ toggle in `Search.vue`. See
  [Chat Server](#chat-server) for the backend.

## MCP Server

`mcp-server/` is a standalone Node MCP (Model Context Protocol) server that
lets Claude Code query and manage this app's gonic backend directly
(search, artists/albums/playlists, trigger library scans, check scan
status). It merged into this repo on 2026-08-18 — it started as its own
project (`~/Repos/mcp/gonic-mcp`) but talks to the exact same gonic instance
(`https://gonic.ekskog.net`) this app's frontend uses, so it lives here now
instead of a separate repo.

It is **independent of the Vite app**: its own `package.json`, own
`node_modules`, not built or deployed by anything in this README's
Commands/Deployment sections. See `mcp-server/README.md` for what it does,
its tools, and setup. Its credentials file (`mcp-server/gonic.env`) is
gitignored — never commit it.

## Chat Server

`chat-server/` is the backend for natural-language music search — the thing
the app's chat box talks to. It is **not** the MCP server and shares no code
with it: separate `package.json`, separate image, separate deployment. Do not
confuse the two.

**What it does.** Single file, `chat-server/index.js`, ~200 lines, no
framework. Plain `node:http` server exposing two routes — `POST /chat`, taking
`{ message, provider }` and returning `{ reply, songs, albums, artists }`, and
`GET /providers`, returning `[{ id, label }]` for the client's picker. Nginx
proxies both at `/chat-api/`.

It runs a small agentic loop (`runChat`, max 5 turns) with two tools:

- `search_music` — a Subsonic `search3` call against gonic (same token auth as
  everywhere else, `md5(password + salt)` per request). Callable repeatedly;
  results accumulate into deduped maps keyed by id.
- `show_songs` — takes the ids the model wants displayed. **This is what the
  app renders.**

`show_songs` exists because `search3` matches loosely: asking for David
Bowie's "Let's Dance" also returns Chris Rea, Ramones and Blondie tracks.
Without a selection step the model would summarise the relevant subset in
prose while the UI listed every raw hit, so the reply and the list disagreed.
Now the model states a count and passes exactly those ids. Ids it passes that
weren't in any search result are dropped, and if it never calls `show_songs`
at all, the server falls back to returning everything found.

The loop ends when the model replies with no tool call. Its prose reply is
deliberately a sentence or two — the app renders the tracks itself.

**Providers.** A list, not a single choice — the user picks one per request
from a dropdown in the chat UI. Two kinds are supported: `anthropic` (the
Anthropic SDK) and `openai` (any OpenAI-compatible `/chat/completions`
endpoint — OpenAI, Groq, Together, OpenRouter, Ollama, vLLM). Anthropic's
block format is the internal shape; the OpenAI path is translated at the edge
in `callModel` — tool schemas (`input_schema` ↔ `function.parameters`),
assistant tool calls, and `tool_result` → `tool` messages. Only
`@anthropic-ai/sdk` is a dependency; the OpenAI path is a plain `fetch`.

The list comes from `LLM_PROVIDERS`, a JSON array. The **first entry is the
default** when a request names no provider. Each entry needs `id`, `model`
and `kind`; `label` (defaults to `id`) is what the dropdown shows; `baseUrl`
(default `https://api.openai.com/v1`) and `apiKeyEnv` (default
`OPENAI_API_KEY`) apply to `openai` entries, so several providers can each
carry their own key.

```json
[
  { "id": "claude", "label": "Claude Sonnet", "kind": "anthropic", "model": "claude-sonnet-4-5" },
  { "id": "gpt",    "label": "GPT-4o mini",  "kind": "openai",    "model": "gpt-4o-mini" },
  { "id": "llama",  "label": "Llama 3 (local)", "kind": "openai", "model": "llama3",
    "baseUrl": "http://ollama:11434/v1", "apiKeyEnv": "OLLAMA_API_KEY" }
]
```

Unset `LLM_PROVIDERS` falls back to a single Claude Sonnet entry, so the
default deployment behaves as it always did. Startup fails fast on malformed
JSON, a bad entry, or a missing key for any listed provider — a provider you
can pick in the UI is one the server has already proved it can authenticate.

| Env var | Default | Notes |
|---|---|---|
| `LLM_PROVIDERS` | one Claude Sonnet entry | JSON array, first entry is the default |
| `ANTHROPIC_API_KEY` | — | Required if any entry is `kind: "anthropic"` |
| `OPENAI_API_KEY` | — | Required for `openai` entries with no `apiKeyEnv` |
| `GONIC_URL`, `GONIC_USERNAME`, `GONIC_PASSWORD` | — | Always required |
| `PORT` | `8090` | |

**Client.** `src/api/chat.js` exports `askAI(message)`. The app is
single-provider (DeepSeek): it never asks the user to choose, and the server
falls back to its default (first) provider when no `provider` is named. To add
a picker back, configure several entries in `LLM_PROVIDERS` and render the
`/providers` list again.

Desktop and mobile split here deliberately:

- **Desktop** — Ask AI is separate from search. The "✨ Ask" button inside the sidebar search field opens
  `AskAiModal.vue`, a centered overlay with its own input and full-width
  `TrackItem` rows. The sidebar search box is plain search only — no AI mode,
  no toggle. The 224px column was too narrow to show a reply and a track list
  at once.
- **Mobile** — `Search.vue` keeps the inline ✨ toggle that flips the existing
  full-screen search view into AI mode. There is no sidebar to escape, so a
  modal would buy nothing.

**Deployment.** `k8s/chat-server.yaml` — Deployment + Service in namespace
`webapps`, image `ghcr.io/xkogd66/chat-server:latest`, port 8090, env pulled
from the `chat-server-secret` secret.

**Discogs ratings.** `GET /ratings` returns every stored rating; `POST
/ratings?artist=&album=[&force=1]` fetches one from Discogs and stores it in
`/data/ratings.json` (PVC `chat-server-data`, so ratings survive restarts and
are shared by every device). Discogs rates *releases*, not albums, so an album's
rating is the vote-weighted mean over the 5 most-collected releases of its
master (~7 API calls; limit 60/min). Fetches are explicit only — the Tools
page ("Discogs rating") and the MCP `get_album_rating` tool; the album views
just display what's stored. Needs `DISCOGS_TOKEN` in `chat-server-secret`; the
`discogs_rating` LLM tool is only offered when it is set.

`LLM_PROVIDERS` there lists a single provider — **DeepSeek**
(`kind: "openai"`, so no code change is needed, only a model and a key). With
one entry the frontend shows no picker and every request uses this default.
Startup validation refuses to offer a provider it cannot authenticate, so the
listed provider's key (`DEEPSEEK_API_KEY`) must exist in the secret or the pod
crashloops — drop a provider from the list rather than leaving its key blank.

`k8s/chat-server-secret.example.yaml` is the template for that secret: copy it
to `chat-server-secret.yaml`, fill it in, apply. **Never commit the filled
copy** — attic-music is a public repo with CI.

## Deployment

### Docker
```bash
docker build -t attic-music .
docker run -p 80:8080 attic-music
```
Multi-stage build: Node 22-Alpine compiles the app, Nginx Alpine serves `dist/`.

### Kubernetes
Manifests live in `k8s/`. The deployment runs in namespace `webapps` and pulls from `ghcr.io/xkogd66/attic-music:latest`. An init container generates `/config.json` from the `lastfm-secret` K8s secret before the Nginx container starts.

### Lyrics
- Source: **LRCLIB** (`https://lrclib.net/api/get`) — free, no auth, CORS-enabled; no proxy needed
- `src/api/lyrics.js` exports `fetchLyrics(track)`: queries by artist + title + album + duration; returns `{ plain, synced }` or `null` if not found
- Synced lyrics are parsed from LRC format (`[mm:ss.xx] text`) into `[{ time, text }]` arrays; active line is derived from `player.currentTime`
- In-memory cache keyed by track ID — fetched on demand, never proactively
- Manual lyrics can be pasted in FullPlayer and are saved via `saveManualLyrics(trackId, text)` to a local store
- **Mobile (FullPlayer)**: Art / Lyrics pill toggle below the album art; lyrics panel scrolls with current line auto-centered
- **Desktop (Player)**: "Lyrics" button next to "Queue" opens a `w-72` panel; mutually exclusive with the queue panel

## TODO

- [ ] Lyrics: test with a broad range of tracks; consider adding a "not instrumental" check (`data.instrumental === false` from LRCLIB response)

## Conventions

- All components use `<script setup>` — no Options API
- Composables and stores are imported directly; no global registration
- Tailwind utility classes only — no custom CSS beyond root variables and the `.dark` palette in `style.css`
- Keep API calls inside `src/api/`; views and components call store actions, not API methods directly
- Vue reactivity: never use `Set` or `Map` inside plain objects assigned to `ref` — use plain arrays with `.includes()` deduplication
- Carousel cards: always use `w-full` on the flex scroll container and `width: calc(100% / 3 - 8px)` on each card for exact 3-visible-card rows
