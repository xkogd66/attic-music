# attic-music — Architecture

> Codebase walkthrough generated from a full read of the repo. Covers the Vue
> frontend, the artist-images Go sidecar, the chat-server, the MCP server, and
> the deployment infrastructure.

## 1. What this project is

**attic-music** is a personal, self-hosted, responsive web music player. It is a
thin Vue 3 client for a **Subsonic-compatible server** (specifically **Gonic**
at `https://gonic.ekskog.net`), backed by an **NFS share** of MP3 files. It is
deployed to a private Kubernetes cluster and reachable at
`https://music.ekskog.me` via a Cloudflare tunnel.

The repo is a monorepo containing **four independent pieces**:

| Piece | Location | Tech | Role |
|---|---|---|---|
| Frontend (SPA) | `src/`, `index.html`, `vite.config.js` | Vue 3 + Pinia + Vue Router + Tailwind 4 + Vite | The player app itself |
| Artist-images sidecar | `artist-images/main.go` | Go | Serves/edits cover art & ID3 tags directly on the NFS share |
| Ask-AI backend | `chat-server/index.js` | Node (no framework) | LLM tool-calling loop over Subsonic `search3` |
| MCP server | `mcp-server/` | Node (`@modelcontextprotocol/sdk`) | Lets Claude Code query the gonic backend |

Each backend has its own `package.json` / build / image and is deliberately
**not** part of the Vite build.

## 2. Architecture overview

```
Browser (music.ekskog.me)
   │  Cloudflare tunnel ──> cluster service ──> nginx (attic-music pod)
   │
   ├── /rest/*            ──> gonic (Subsonic API)          [music data, streaming, scrobbling]
   │                            └── indexes NFS share: /var/lib/media/music/mp3
   │
   ├── /artist-images/*   ──> artist-images (Go sidecar)    [cover.jpg on NFS, tag writes]
   │                            └── mounts the same NFS share
   │
   └── /chat-api/*        ──> chat-server (Node)            [Ask AI: POST /chat, GET /providers]
                                  └── talks to gonic search3 + an LLM (anthropic/openai)
```

In development, `vite.config.js` proxies the same three paths to
`https://gonic.ekskog.net`, `http://localhost:8081`, and
`http://localhost:8090`. In production, `nginx.conf` proxies them to in-cluster
ClusterIP services.

## 3. Frontend (the Vite app)

### 3.1 Boot sequence

1. `index.html` → `src/main.js`: `createApp(App)`, installs Pinia and the
   router, mounts.
2. `App.vue` on mount calls `config.load()`:
   - fetches `/config.json` (server-provisioned: `server`, `username`,
     `lastfmUser`, `lastfmKey`, `turnstileSiteKey`) — baked into the Docker
     image by CI,
   - deletes `localStorage.attic_cfg` (a plaintext password key an *older*
     build used — deliberate cleanup).
3. **Credentials live in memory only.** `loggedIn` starts false; until login,
   `App.vue` renders *only* the Login view (nothing behind it can mount or
   fetch), and the router guard redirects every non-`/login` route to
   `/login`.

### 3.2 Auth & config (`src/stores/config.js`, `src/views/Login.vue`)

- The Pinia `config` store holds `server`, `username`, `password`, `lastfmUser`,
  `lastfmKey`, `turnstileSiteKey`, `loggedIn`.
- `Login.vue` pre-fills server/username from the server config, optionally
  renders a **Cloudflare Turnstile** widget (loaded on demand, site key from
  config.json), and verifies credentials with a real `ping()` against the
  Subsonic server *before* calling `saveSession()`.
- There is deliberately **no "remember me"** — every reload/tab requires
  re-login.
- Password auth to gonic uses the Subsonic **hex-encoded password** scheme:
  `p=enc:<hex>` with `v=1.16.1&c=atticweb&f=json`.

### 3.3 Routing (`src/router/index.js`)

Auth-guarded SPA routes:

| Route | View | Notes |
|---|---|---|
| `/` | → redirect `/home` | |
| `/home` | Home.vue | Mobile landing with discovery carousels |
| `/artists`, `/artists/:id` | Artists.vue | Grid/detail (artist + album detail are internal views) |
| `/albums`, `/albums/:id` | Albums.vue | Paged album grid / album detail |
| `/playlists`, `/playlists/:id` | Playlists.vue | Playlist list / detail |
| `/search` | Search.vue | Mobile search + Ask AI |
| `/login` | Login.vue | Only route accessible while logged out |

### 3.4 API layer (`src/api/`)

- **`subsonic.js`** — the single wrapper around the Subsonic REST API. Every
  call goes through `buildUrl()` (auth params + query building) and `request()`
  (parses the `subsonic-response` envelope, throws on non-`ok`). Exposes:
  `ping`, `getIndexes`, `getDirectory`, `getArtists` (alphabetized, grouped by
  letter, article-stripping via `sortableName`), `getArtistCoverMap`,
  `getArtistGenreMap` (paginates all albums in 500s), `getArtist`, `getAlbum`,
  `getAlbumPage`/`getNewestAlbums`/`getRandomAlbums` (wrap `getAlbumList2`),
  playlist CRUD, `getArtistInfo2`, `scrobble`, `startScan`/`getScanStatus`,
  `search` (`search3`), plus URL builders `coverUrl`/`streamUrl`.
- **`chat.js`** — `askAI(message, provider)` → `POST /chat-api/chat`;
  `fetchProviders()` → `GET /chat-api/providers`.
- **`lastfm.js`** — polls `user.getrecenttracks`; marks *permanent* errors (bad
  key/forbidden) so the poller can stop.
- **`lyrics.js`** — LRCLIB (`lrclib.net/api/get`) with an in-memory cache keyed
  by track id, LRC parsing into `[{time, text}]`, and manual lyrics stored in
  `localStorage` (`attic_lyrics_<id>`).
- **`covers.js`** — Last.fm cover/artist-image candidate search
  (`album.getinfo` + `album.search` / `artist.getinfo` + `artist.search`),
  deduped, placeholder URLs filtered out.
- **`tags.js`** — writes ID3 tags via the sidecar's
  `/artist-images/album-tags` and `/track-tags` endpoints (Subsonic has no
  tag-write API). Callers follow up with `subsonic.startScan()`.
- **`genres.js`** — a fixed curated list of 40 genres used to constrain genre
  editing ("no free-text bullshit genres").

### 3.5 Stores

- **`config`** — as above.
- **`player`** (`src/stores/player.js`) — the heart of playback:
  - A **single module-level `Audio` element**; all state is reactive refs
    (`queue`, `currentIndex`, `currentTrack`, `isPlaying`, `shuffle`, `repeat`,
    `currentTime`, `duration`, `volume`).
  - `streamUrl()` builds authenticated `/rest/stream` URLs (`format=raw`).
  - Audio event wiring: `timeupdate` (updates position, fires **Last.fm
    scrobble** once past a threshold — `max(30, min(duration*0.5, 240))` — and
    updates Media Session position state), `durationchange`, `play`/`pause`
    (Media Session), `ended` (repeat → replay, else `nextTrack`).
  - Media Session API: metadata + play/pause/next/prev/seek handlers
    (lock-screen / hardware media keys).
  - Volume persisted to `localStorage.attic_volume`; mute toggling remembers
    the pre-mute level.
  - Controls: `playTrack`, `playFromQueue`, `togglePlay`, `nextTrack` (shuffle
    picks random), `prevTrack` (restart if >3s in), `addToQueue`, `clearQueue`,
    `jumpToQueue`, `seek`, `setVolume`, `toggleMute`, `fmt`.
- **`playlist`** — caches the playlist list (`load()` once on first use) and
  `addTrack(playlistId, trackId)`.


### 3.6 Views

- **Home.vue** — carousels (desktop) / compact grids (mobile): "Recently Added"
  artists (first 20 distinct artists from newest 100 albums), "Discover
  Artists" (20 random), "Discover Albums" (20 random, 4 on mobile).
- **Artists.vue** (~1000 lines — the most complex view):
  - Desktop: letter-nav bar, expandable letter-group grids of `ArtistCard`s,
    genre/year filter dropdowns, two browse carousels.
  - Mobile: one `grid-cols-4` of **every** artist (lazy-loaded circular
    avatars), search box + genre/year dropdowns, sort chips **A–Z / Added /
    Discover** — all three sorts are client-side over the full in-memory index
    (server only offers alphabetical): "Added" uses a rank Map from the
    newest-100-albums order; "Discover" re-rolls random keys via a `watch`
    (rolled in a computed instead, it'd reshuffle on every read).
  - `view` state machine: `grid` → `artist` → `album` (artist detail shows
    album grid with hover-play; album detail shows `TrackItem`s).
  - **Album tag editing**: `displayTitle/Artist/Year/Genre` computed values
    overlay *local* overrides stored in `localStorage` (`attic_tags_<albumId>`,
    `attic_genre_<albumId>`) on top of server values, so edited tags survive a
    gonic rescan; saving writes to the mp3s via the sidecar (`saveAlbumTags`)
    then triggers a scan.
  - **Track tag editing**: per-track title/artist/track-number via
    `saveTrackTags`.
  - **Cover search modal** (shared for album covers *and* artist avatars via
    `coverSearchTarget`): Last.fm candidates → pick → downloads bytes (with
    `Accept: image/jpeg,image/png` to avoid WebP, and `cache: reload` to bypass
    the CDN's cached WebP) → re-uploads to the sidecar; device-upload also
    supported. After upload, the URL gets `?t=<timestamp>` to bust the browser
    cache.
  - Artist detail hero has a click-to-change circular avatar (opens the same
    modal in avatar mode).
- **Albums.vue** (~850 lines):
  - Header filters (genre/year dropdowns), mobile search, **mobile sort chips
    whose ids ARE the Subsonic `getAlbumList2` types**
    (`alphabeticalByName`/`newest`/`random`) — changing sort re-pages from the
    server (no client-side re-sorting). `random` deliberately loads one page
    then stops (paging random would repeat albums; marked `ponytail:`).
  - Desktop-only: Recently Added + Discover carousels. Grid is `grid-cols-4`
    mobile / `auto-fill minmax(100px,1fr)` desktop. Infinite scroll via
    IntersectionObserver on a sentinel (pages of 100).
  - Album detail: cover fallback chain driven by `albumDetailCoverSrc`/
    `albumDetailCoverState` (`loading → sidecar → failed` → "Add cover"
    button), album tag editing, track tag editing, cover search/upload (same
    machinery as Artists.vue).
  - **`albumDiskIdentity()`** — the on-disk folder (album-artist + album name)
    is what the sidecar uses to find the folder; it *doesn't* change when tags
    are edited, and a `_diskArtist`/`_diskAlbum` local override can be recorded.
- **Playlists.vue** — playlist grid with hover-play, detail with removable
  `TrackItem`s, create/rename/delete, "save queue as playlist" lives in the
  desktop Player.
- **Search.vue** — mobile search with 300ms debounce; the **✨ Ask AI toggle**
  flips the same view into AI mode (input → `askAI`, renders `aiReply` +
  `TrackItem` results; provider dropdown only when >1 provider configured).


### 3.7 Components

- **`Player.vue`** (desktop footer, `hidden md:flex`) — track info + cover,
  shuffle/repeat/prev/play/next, click-to-seek progress bar, volume slider +
  mute, and a Queue panel / **Lyrics panel** (mutually exclusive; lyrics
  auto-center the active line via `scrollIntoView`). Also a "Save as playlist"
  flow.
- **`MiniPlayer.vue`** (mobile) — fixed bar above the bottom nav
  (`bottom: 64px`), thin progress strip, prev/play/next, tap to expand the
  FullPlayer.
- **`FullPlayer.vue`** (mobile) — full-screen, slide-up transition; queue view,
  album art, Art/Lyrics toggle, synced-lyrics scroll + manual-lyrics
  paste-and-save, controls + seek + volume.
- **`BottomNav.vue`** (mobile) — 5 tabs: Home / Artists / Albums / Playlists /
  Search.
- **`SideBar.vue`** (desktop) — header w/ server name, nav (with a **library
  rescan** button that calls `startScan` and polls `getScanStatus` every 30s),
  debounced search dropdown, "✨ Ask AI" button opening `AskAiModal`, "Recent
  plays" (Last.fm scrobbles polled every 30s), sign-out.
- **`AskAiModal.vue`** (desktop) — centered overlay; on submit calls `askAI`,
  renders the reply (splitting `**bold**` text into segments rather than
  `v-html` — model output is never treated as HTML) plus `TrackItem` rows.
- **`TrackItem.vue`** — the reusable track row; number/♪ indicator,
  title/artist, duration, edit-tags button, and a `+` dropdown (playlist list +
  "Add to queue" + "Remove from playlist" when `removable`).
- **`ArtistCard.vue`** — circular avatar (sidecar URL first, letter placeholder
  on error) + name + album count.
- **`FolderNode.vue`** — recursive expandable folder tree using Vue
  `provide`/`inject` for accordion behavior (one open child per level); fetches
  `getDirectory` lazily. **Note: no view currently mounts it** (the README's
  `Folders.vue` no longer exists) — currently dead-but-maintained code.
- **`RecentPlays.vue`** — collapsible Last.fm recent-scrobbles panel; stops
  polling on permanent errors.

### 3.8 Image-fallback chains (an important design quirk)

Because **gonic never populates `artist.coverArt`** and does **not** serve
standalone `cover.jpg` files via `getCoverArt` (only embedded ID3 art), this
app has a dedicated sidecar and layered fallbacks:

- **Artist avatar**: sidecar `/artist-images/avatar?name=<artist>` → Subsonic
  `getCoverArt` (rarely set) → letter placeholder. Avatars are *always
  circular*.
- **Album cover**: Subsonic `getCoverArt?id=<albumId>` → sidecar
  `/artist-images/album?artist=&album=` → "Add cover" upload → 💿 placeholder.
  Album covers are *always square/rounded*.


## 4. artist-images sidecar (Go, ~500 lines, single file)

**Purpose:** the authoritative source for on-NFS cover art and the only way to
write ID3 tags.

- **Startup & scan**: reads `MUSIC_ROOT` (default `/media/music`), walks
  `<root>/<letter>/<artist>/<YYYY>-<album>/cover.jpg`, building four in-memory
  maps keyed by a **`normalize()`** function (lowercase, accent-stripping via
  `accentMap`, `&`→`and`, non-alphanumerics collapsed, leading articles
  stripped, `YYYY-` prefix stripped for albums). Re-scans every 5 minutes. Logs
  a fatal error if the NFS isn't ready at boot.
- **Endpoints**:
  - `GET /avatar?name=` / `GET /album?artist=&album=` — `http.ServeFile` with
    `Cache-Control: max-age=86400`; optional HIT/MISS request logging
    (`LOG_REQUESTS`).
  - `POST /upload?artist=&album=` — saves a `cover.jpg` into the album dir
    (returns **202 Accepted** because it kicks off a background goroutine that
    **embeds the cover into every MP3's ID3 APIC frame** via `id3v2`,
    fire-and-forget).
  - `POST /upload-avatar?name=` — same, but into the artist dir (no embedding).
  - `POST /album-tags?artist=&album=` — writes `TALB`/`TPE1`/`TPE2`/`TCON`/
    `TDRC`+`TYER` to every `.mp3` in the album dir.
  - `POST /track-tags?artist=&album=` — writes `TIT2`/`TPE1`/`TRCK` to one file
    (`file` basename, `filepath.Base` guards traversal).
- **`toJPEG()`**: passes JPEG/PNG/GIF through untouched, but re-encodes
  anything else (notably **WebP**) as JPEG — because gonic's Go stdlib image
  decoding can't read WebP, and Last.fm's CDN serves WebP by default.
- **Why it exists**: gonic doesn't expose `artist.coverArt`, doesn't serve
  standalone covers, and Subsonic has no tag-write endpoint. The sidecar closes
  all three gaps with direct NFS access.
- Security note: it's an unauthenticated write endpoint, but it only ever
  writes inside the known NFS tree (path lookups go through the maps, so
  traversal isn't possible).

## 5. chat-server (Node, single file, ~270 lines)

The "Ask AI" natural-language search backend.

- **Endpoints**: `POST /chat` (`{message, provider}` → `{reply, songs, albums,
  artists}`) and `GET /providers` (`[{id, label}]`). Plain `node:http`, no
  framework. Proxied by nginx at `/chat-api/`.
- **Agentic loop** (`runChat`, max 5 turns) with two tools:
  - `search_music` — Subsonic `search3` against gonic (token auth,
    `md5(password + salt)` per request). May be called repeatedly; results
    accumulate in id-keyed Maps.
  - `show_songs` — the model passes the **exact song ids it wants displayed**.
    This exists because `search3` matches loosely (asking for Bowie's "Let's
    Dance" also returns Chris Rea, Ramones, Blondie…). The UI renders exactly
    the model's selection; ids not in any search result are dropped; if the
    model never calls it, the server falls back to everything found.
- **Loop**: ends when the model replies with no tool call; prose reply is
  intentionally 1–2 sentences (the UI renders tracks itself).
- **Provider abstraction**: internal shape is Anthropic's block format; the
  OpenAI-compatible path (`kind: "openai"` — OpenAI, Groq, Together, OpenRouter,
  Ollama, vLLM, Gemini) is translated at the edges in `callModel` (tool schemas
  `input_schema`↔`function.parameters`, assistant tool calls,
  `tool_result`→`tool` messages) and called via plain `fetch`. Only
  `@anthropic-ai/sdk` is a dependency.
- **Config**: `LLM_PROVIDERS` JSON env (first entry = default). Startup
  validation refuses to boot if a provider is missing its key env var or lacks
  `id`/`model`/`kind`; also requires `GONIC_URL/USERNAME/PASSWORD`.

## 6. mcp-server (Node, MCP protocol)

A minimal **MCP server** that gives Claude Code direct tools over the same
gonic instance (merged in from a standalone project; it's tooling for the same
backend, not a product).

- **10 tools**: `ping`, `search`, `list_artists`, `get_artist`, `get_album`,
  `list_playlists`, `get_playlist`, `create_playlist`, `start_scan`,
  `scan_status`.
- **Auth**: token auth (`md5(password + salt)`) for Subsonic endpoints;
  `start_scan` is gonic-specific — it logs in via gonic's admin web form
  (`/admin/login_do`) for a session cookie and POSTs `/admin/start_scan_inc_do`.
  **Incremental only**, deliberately (gonic's scanner is single-threaded; full
  scans run an order of magnitude longer — see issue sentriz/gonic#634).
- Credentials live in a **gitignored** `gonic.env`, loaded by `run.sh` (so they
  never appear in `claude mcp add` or `~/.claude.json`). Env var names are
  legacy `NAVIDROME_*`.
- Runs over stdio, registered with `claude mcp add -s user gonic -- <path>/run.sh`.


## 7. Infrastructure & deployment

### Docker images (3, all pushed to GHCR)
- **attic-music**: multi-stage — Node 22-bookworm-slim builds `dist/`, final
  image is `nginx:alpine` serving it with `nginx.conf`. `index.html` is served
  with `Cache-Control: no-cache` (so deploys are visible without hard refresh);
  hashed assets cache forever. Nginx proxies `/artist-images/` →
  `artist-images:8080` and `/chat-api/` → `chat-server:8090`.
- **chat-server**: `node:22-bookworm-slim`, `npm ci --omit=dev`, runs
  `index.js`.
- **artist-images**: Go multi-stage build (`go mod init` in-Dockerfile) →
  minimal `debian:bookworm-slim`.

### Kubernetes (`k8s/`, namespace `webapps`)
- `deployment.yaml` — the Vite app (replicas 1).
- `artist-images.yaml` — ConfigMap (`LOG_REQUESTS=true`), Deployment with an
  **init container that fails fast if the NFS mount is empty** (`ls
  /media/music`), an **NFS volume** (`192.168.1.8:/var/lib/media/music/mp3`),
  and a ClusterIP Service.
- `chat-server.yaml` — Deployment + Service; env from the `chat-server-secret`
  Secret; ships a 4-provider `LLM_PROVIDERS` example (Claude, Ollama, Gemini,
  DeepSeek — the last three `kind:"openai"`).
- `chat-server-secret.example.yaml` — template for the secret. **⚠ It contains
  a committed-looking gonic password (`GONIC_PASSWORD: 7mileshi`)** — given the
  repo is public with CI, this is a real credential to rotate if it's live.

### CI (`github/workflows/deploy.yaml`)
On push to `main`, three jobs:
1. **build-attic-music** — generates `public/config.json` from GitHub secrets
   (bakes `LASTFM_API_KEY`, `TURNSTILE_SITE_KEY`, server URL, username into the
   image), builds/pushes the image (latest + per-commit-sha tags), then
   **deploys by immutable sha tag** via `kubectl set image` (avoids
   stale-`:latest`-cached-node problems).
2. **build-artist-images** — **path-filtered**: only builds/deploys if `git
   diff` touched `artist-images/`.
3. **build-chat-server** — path-filtered on `chat-server/`. Documented gotcha:
   editing only `k8s/chat-server.yaml` (e.g. `LLM_PROVIDERS`) **skips the job
   entirely** — that config must be applied by hand.

### Routing/traffic
- `music.ekskog.me` is DNS'd through **Cloudflare**, and a **remotely-managed
  Cloudflare tunnel** (cloudflared pod, config in the Zero Trust dashboard,
  *not* in-cluster) routes to the cluster. No public ingress/LoadBalancer.

### Helper scripts & the musiclib CLI (maintenance tooling)

**`scripts/musiclib.py` — interactive music-library manager (v1.0, ~2,300
lines).** A single menu-driven CLI that replaces ~30 one-off scripts. It is a
pure filesystem tool: it edits tags/artwork directly on the NFS library and
talks to online metadata APIs (MusicBrainz, Last.fm, Deezer, LRCLIB, Cover Art
Archive) — it **never calls gonic**. Menu sections:

- **A. Cover Art**
  - *Normalize artwork* — per album, in order: existing `cover.jpg` in the
    folder → extract the embedded APIC frame (and save it back as `cover.jpg`)
    → fetch from Last.fm (`album.getinfo`, largest of mega/extralarge/large) —
    and in every case embed the result into all the album's MP3s.
  - *Fetch artist thumbs* — artist avatars from Deezer (`search/artist`,
    `picture_xl`/`picture_big`) for artists missing a `cover.jpg`. Both
    fetchers run bytes through `_ensure_real_jpeg()`, which re-encodes
    non-JPEG payloads (notably **WebP**) as real JPEG — the same WebP
    constraint the Go sidecar works around for gonic.
- **B. Tags — Cleanup**
  1. *Sanitize to golden set* — two passes: wipe every tag not in the
     `GOLDEN_TAGS` allowlist (`TIT2 TALB TPE1 TPE2 TRCK TDRC TPOS TCOM TPE3
     APIC TCMP`), then force `GROUPING_TAGS` (`TALB TPE2 TDRC TPOS TCMP`) to
     match the first file of each album.
  2. *Delete sort tags* — `TSOP/TSO2/TSOA/TSOT/TSOS/TSOC/TSOO/XSOP`,
     `TXXX:*sort*`, and the vorbis/easy sort keys, on MP3 and non-MP3 alike.
  3. *Lowercase all text frames* — every ID3 text frame lowercased (the
     library stores artist/album/title in lowercase).
  4. *Set TPE2* — prompt for an Album Artist value and write it to all MP3s.
  5. *Nuclear clean + rename* — **destructive** (requires typing `NUCLEAR` to
     confirm): wipe all tags, rewrite the core tags lowercased (`artist title
     album albumartist tracknumber disc date`), hoist `feat. X` out of the
     artist field into the title, rename files to `NN-NN-title.ext`.
  6. *Rename album folders from tags* — majority year + album tag →
     `YYYY-album_slug`.
  7. *Slugify folder names* — `lowercase_underscore`, `(2) foo` → `2-foo`.
  8. *Tag from filename* — parse `Artist - Title.mp3` / `NN - Title.mp3` into
     `TIT2`/`TPE1`.
- **C. Tags — Enrich**
  - *Fill missing genre/year* — MusicBrainz release + release-group lookups
    (genre: highest-count non-`GENERIC_GENRES` tag; year: earliest release
    date), falling back to Last.fm top tags; a second pass fills the remaining
    albums with the artist's majority genre.
  - *Interactive MusicBrainz tagger* — search → pick a release → applies the
    full tag set per track position (`TIT2 TRCK TPE1 TPE2 TALB TDRC` + front
    cover from the Cover Art Archive), then offers to continue with sibling
    albums of the same artist.
  - *Fetch & embed lyrics* — LRCLIB → `USLT` frame + `.lrc` sidecar per track.
- **D. Audit (read-only)** — golden-tag compliance report (junk tags +
  cross-track conflicts on `TALB/TPE2/TDRC`) and side-by-side tag diffs of two
  files/folders.
- **E. Convert (needs ffmpeg)** — FLAC→MP3 320k, WAV→FLAC (lossless),
  M4A/MP4→MP3 320k (the MP3 conversions delete the original by default).
- **F. Utilities** — split a long MP3 by a cue/timestamp file (ffmpeg
  `-c copy`, outputs `NN-title.mp3`, optional deletion of the original); purge
  macOS junk (`.DS_Store`, `._*`, `__MACOSX`, …).
- **G. Configuration** — Last.fm key, Fanart.tv key, MusicBrainz contact email,
  default library path, persisted to `~/.musiclib.json` (env overrides
  `FANART_API_KEY` / `LASTFM_API_KEY`).
- **H. Workflows (onboarding pipeline)** — 1) interactive per-album tag
  consistency (prompts only on missing/conflicting `TALB`/`TPE2`/`TDRC`, and
  knows a varying `TPE1` with a consistent `TPE2` is a compilation) plus a
  cross-album artist check; 2) batch golden-set sanitize; 3) artwork normalize;
  4) full onboarding (1 → 2 → 3 → lowercase).

Shared infrastructure worth noting: automatic library-hierarchy detection
(`root/letter/artist/album` via depth probing) with level-aware iterators;
tab-completed path prompts that remember the last path; a threaded progress
bar; `dry_run_confirm()` (preview + `[y/N]`) before every destructive action;
SIGINT handling; and per-operation timestamped logs under `~/musiclib_logs/`.
It hard-codes a Fanart.tv API key as the default config and brands itself as a
"Navidrome" manager even though this repo's server is gonic (the script is
server-agnostic — it never touches the server). It overlaps with the Go
sidecar (both write ID3 tags and embed artwork on the NFS share) and with
`artist-setup.py` below.

**`scripts/artist-setup.py`** — run from an artist folder: fetches the artist
avatar (`thumbs -d`), then per-album fetches covers from MusicBrainz → Deezer,
saves `cover.jpg`, and embeds them into MP3 tags via mutagen (a precursor to
musiclib's artwork/tagging features).

**`tools/set-album-artist.py`** — batch sets the Album Artist (`TPE2`) across
an artist folder and renames the folder to the sidecar's naming convention
(`lowercase`, spaces/special → underscores), at artist- or letter-directory
level.

## 8. Key domain rules / data model

- **Library layout on NFS**: `<root>/<first-letter>/<artist_folder>/`
  containing `cover.jpg` (avatar) + `YYYY-album_name_with_underscores/` album
  dirs each with `cover.jpg` + `01-01-track_name.mp3`.
- **Artist folder name == the Album Artist MP3 tag** (e.g. `bob_seger`), *not*
  the track artist (`bob seger & the silver bullet band`). The frontend uses
  `album.albumArtist || album.artist` when building sidecar URLs; the sidecar
  normalizes both sides identically so lookups match.
- **Auth styles**:
  - Browser → gonic: hex-encoded password (`p=enc:`), client id `atticweb`.
  - Backends (chat-server, mcp-server) → gonic: token auth
    (`md5(password + salt)` per request), client ids `chat-server` /
    `gonic-mcp`.
- **Scrobbling**: done via Subsonic's `scrobble` endpoint (server-side) at the
  halfway threshold, *plus* the sidebar reads the user's Last.fm profile
  directly with the API key.

## 9. Notable conventions & quirks

- All components use `<script setup>`; no global registration; Tailwind
  utilities only (the accent color is actually unused amber/stone in the code,
  with `--accent: #B85C38` defined in `style.css`).
- Vue-reactivity rule (documented in README): **no `Set`/`Map` inside objects
  assigned to `ref`** — plain arrays with `.includes()` dedup (e.g.
  `getArtistGenreMap`).
- Carousel convention: `w-full` flex container + `width: calc(100% / 3 - 8px)`
  cards for exactly 3 visible.
- `ponytail:` comments mark known trade-offs/deferred work (random-album
  paging, fire-and-forget cover embedding, `max_tokens` vs
  `max_completion_tokens`, full-scan exposure, MAX_TURNS fallback).
- `main.js` has a leftover "force rebuild on 20/4/26 15:50" comment — a
  cache-busting hack.
- `public/icons.svg` (social icons: bluesky, discord, github, x, etc.) is
  **not referenced anywhere** — dead asset.
- `FolderNode.vue` and the README's `Folders.vue` are stale — the folder-browse
  view was removed; the component is self-recursive only and unused.

## 10. Potential issues / observations worth your attention

1. **Committed credential**: `k8s/chat-server-secret.example.yaml` contains a
   gonic password. If it's real, rotate it — this is a public repo with CI.
2. **Dead code**: `FolderNode.vue`, `public/icons.svg`, and the
   `getIndexes`/`getDirectory` API functions appear unused (folder browsing was
   removed).
3. **`main.js` cache-busting comment** is stale and could be removed.
4. **Unauthenticated sidecar write endpoints** are safe from traversal by
   design but are still open POST endpoints on the cluster network (fine inside
   a private cluster, worth knowing).
5. **README drift**: the structure section still lists `Folders.vue` and other
   pieces that no longer match exactly.
6. **Hardcoded Fanart.tv API key** in `scripts/musiclib.py` (default in
   `load_config()`) — a committed key in a public repo; same class of concern
   as item 1.
7. **Planned work**: musiclib's CLI capabilities (tag cleanup/enrich, artwork,
   audit, convert) are intended to be folded into the web app itself, replacing
   the separate filesystem/CLI workflow. Note the overlap it will have with the
   Go sidecar, which already owns ID3 tag writes and cover embedding on the
   NFS share, and with the frontend's per-album tag-editing UI
   (`saveAlbumTags`/`saveTrackTags`).

