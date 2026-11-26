# attic-music — Design Document

> Written 2026-11-26 from a full read of the source. It describes what the code
> **does today**, feature by feature: which files implement it, where its state
> lives, how data flows, and the non-obvious rules. Where README.md or
> ARCHITECTURE.md disagree with this file, this file reflects the code — see
> §14 for the known drift. `scripts/musiclib.py` is not re-documented here;
> ARCHITECTURE.md §7 covers it.
>
> **Keep this file true.** Any change that adds a feature, moves state, or
> changes a flow updates the matching section in the same commit.

---

## 1. System map

```
Browser / PWA / Electron  ── https://music.ekskog.me (Cloudflare tunnel → nginx pod "attic-music", ns webapps)
   │
   ├── /                → static Vite build (nginx, SPA fallback to index.html)
   ├── /rest/*          → NOT proxied in prod: the browser calls gonic directly at the
   │                      server URL the user logs in with (default https://gonic.ekskog.net)
   ├── /artist-images/* → artist-images:8080   (Go sidecar, NFS share mounted)
   ├── /chat-api/*      → chat-server:8090     (Node: Ask AI, scrobbles, Discogs ratings)
   └── /deezer-api/*    → https://api.deezer.com/ (CORS shim for cover/avatar search only)

gonic            192.168.1.8:4747 (plain Linux process, outside k8s) — indexes NFS
NFS share        192.168.1.8:/var/lib/media/music/mp3 — mounted by the sidecar (nfsvers=4.1)
ClickHouse       http://clickhouse.data:8123, table music.scrobbles — used by chat-server
External APIs    LRCLIB (browser + sidecar), MusicBrainz/CAA (browser + sidecar),
                 Wikipedia (browser), Deezer (browser via proxy), Discogs (chat-server),
                 LLM provider (chat-server; DeepSeek in prod)
```

Dev: `vite.config.js` proxies `/rest` → gonic, `/artist-images` → `localhost:8081`,
`/chat-api` → `localhost:8090` (prefix stripped). No dev proxy for `/deezer-api`.

| Piece | Path | Runtime | Image / deploy |
|---|---|---|---|
| Frontend | `src/`, `index.html`, `public/` | Vue 3 + Pinia + Vue Router 5 + Tailwind 4, Vite 8 | `ghcr.io/xkogd66/attic-music`, `k8s/deployment.yaml` |
| Sidecar | `artist-images/main.go` (single file) | Go 1.22, `id3v2/v2`, `x/image` (≤ v0.24.0), ffmpeg | `ghcr.io/xkogd66/artist-images`, `k8s/artist-images.yaml` |
| chat-server | `chat-server/index.js` (single file) | Node 22, `node:http`, `@anthropic-ai/sdk` | `ghcr.io/xkogd66/chat-server`, `k8s/chat-server.yaml` |
| MCP server | `mcp-server/index.js` | Node, `@modelcontextprotocol/sdk`, stdio | local only (`run.sh`) |
| Electron | `electron/main.js`, `preload.js` | Electron, loads the live site | local `.dmg` |
| Scripts | `scripts/*.py`, `tools/set-album-artist.py` | Python, mutagen | run by hand on the NFS host |

---

## 2. Feature → file index

Use this to find code without searching.

| Feature | Files |
|---|---|
| Login, Turnstile, Electron remembered login | `views/Login.vue`, `stores/config.js`, `App.vue` (`autoLogin`), `electron/main.js`, `electron/preload.js` |
| Route guard | `router/index.js` |
| Layout (desktop sidebar / mobile nav / player modes) | `App.vue`, `components/SideBar.vue`, `components/BottomNav.vue`, `components/Player.vue` |
| Subsonic client (every gonic call) | `api/subsonic.js` |
| Playback, queue, media keys, scrobble trigger | `stores/player.js` |
| Desktop footer player, queue panel, lyrics panel, save queue as playlist | `components/Player.vue` |
| Minimized footer strip | `components/CompactPlayer.vue` |
| Mini-player mode (whole window) | `components/MiniWindow.vue`, `stores/ui.js`, Electron `attic:set-mini` |
| Mobile mini/full player | `components/MiniPlayer.vue`, `components/FullPlayer.vue` |
| Home | `views/Home.vue` |
| Artists grid / artist detail / album detail (inside Artists) | `views/Artists.vue`, `components/ArtistCard.vue` |
| Albums grid / album detail | `views/Albums.vue` |
| Genre/year filters | `stores/filters.js`, `components/LibraryFilters.vue`, `views/Artists.vue`, `views/Albums.vue`, `App.vue` (scope) |
| Album/track tag editing | `views/Albums.vue`, `views/Artists.vue` (duplicated code), `api/tags.js`, `api/genres.js`, sidecar `/album-tags`, `/track-tags` |
| Album covers & artist avatars (display) | `api/covers.js` (`albumCover`, `onAlbumCoverError`, `trackCover`), sidecar `/album`, `/avatar` |
| Cover/avatar search + upload | `composables/useCoverSearch.js`, `api/covers.js` (`searchAlbumCovers`, `searchArtistImages`, `sidecarAlbumCover`), sidecar `/upload`, `/upload-avatar`, nginx `/deezer-api/` |
| Playlists | `views/Playlists.vue`, `stores/playlist.js`, `components/TrackItem.vue` (+ menu), `components/Player.vue` (save queue) |
| Downloads (track / zip) | `api/subsonic.js` (`downloadTrack`, `downloadZip`, `makeZip`), `TrackItem.vue`, `Player.vue`, album/playlist views |
| Search (sidebar + mobile) | `components/SideBar.vue`, `views/Search.vue` |
| Ask AI | `components/AskAiModal.vue` (desktop), `views/Search.vue` (mobile toggle), `api/chat.js`, `chat-server/index.js` |
| Lyrics | `api/lyrics.js`, `Player.vue`, `FullPlayer.vue` |
| Scrobbling + recent plays + stats | `stores/player.js`, `api/scrobbles.js`, `components/RecentPlays.vue`, `views/Stats.vue`, `components/BarChart.vue`, chat-server `/scrobbles*` |
| Discogs ratings | `api/chat.js` (`ratingKey`, `fetchRatings`, `fetchRating`), `stores/ratings.js`, `components/AlbumRating.vue`, `views/Tools.vue`, chat-server `/ratings`, MCP rating tools |
| Library maintenance (Tools page) | `views/Tools.vue`, `stores/jobs.js`, `api/maintenance.js`, sidecar job endpoints |
| gonic rescan | `SideBar.vue` footer, `Tools.vue` header, `api/covers.js` (after cover upload), MCP `start_scan` |
| Dark mode | `stores/ui.js`, `src/style.css` |
| PWA | `public/manifest.webmanifest`, `public/sw.js` (no-op), `index.html` |

---

## 3. Frontend foundations

### 3.1 Boot and auth
1. `main.js` mounts `App.vue` with Pinia + router. (Line 1 is a stale "force rebuild" comment.)
2. `App.vue` `onMounted`: `config.load()` → `autoLogin()` → `ready = true`. Nothing renders before `ready`.
3. `config.load()` fetches `/config.json` (written by CI: `server`, `username`, `turnstileSiteKey`) and deletes the legacy `localStorage.attic_cfg`.
4. **Credentials are memory-only** (`config` store: `server`, `username`, `password`, `loggedIn`). Every reload/new tab re-logs in.
5. `Login.vue`: optional Cloudflare Turnstile widget (script loaded on demand when `turnstileSiteKey` is set; the token is client-side only, never sent anywhere). `login()` sets config, runs `ping()`, then `saveSession()` (`loggedIn = true`) and pushes `/`. Failure → message + Turnstile reset.
6. `router.beforeEach`: anything but `login` redirects to `login` while `!loggedIn`.
7. `App.vue` renders the library layout only when `loggedIn`; logged out, the `<RouterView>` (Login) is the whole tree.
8. **Electron**: `window.attic` exists → Login shows "Remember on this Mac" (default on) and saves via `attic.saveCredentials`; `autoLogin()` reads `attic.getCredentials()`, pings, logs in, replaces `/login` with `/home`. `config.logout()` calls `attic.clearCredentials()`.

### 3.2 Subsonic client (`api/subsonic.js`)
- `buildUrl(endpoint, params)` — `<server>/rest/<endpoint>?u=…&p=enc:<hex(password)>&v=1.16.1&c=atticweb&f=json`; array params repeat the key.
- `request()` — `fetch(…, {cache:'no-store'})`, unwraps `subsonic-response`, throws on `status !== 'ok'`.
- Calls: `ping`, `getArtists` (all artists, sorted ignoring articles `the|a|an|los|las|le|les|el|la|die|das|der|gli|il`, grouped by first letter, non-letters under `#`), `getArtist(id)` → `{info, albums}`, `getAlbum(id)` → `{info, tracks}`, `getSong`, `getAlbumPage(size, offset, type)`, `getNewestAlbums(n)`, `getRandomAlbums(n)`, playlists CRUD (`getPlaylists`, `getPlaylist`, `createPlaylist(name, songIds)`, `updatePlaylist(id, {name, songIdsToAdd, songIndexesToRemove})`, `deletePlaylist`), `startScan`, `getScanStatus`, `search(query)` (search3: 5 artists / 8 albums / 8 songs), `getArtistGenreMap()`.
- `getArtistGenreMap()` — pages **every** album (`getAlbumList2` alphabetical, 500/page, first page alone then batches of 6 in parallel) into `{artistId: {genres[], years[]}}` (plain arrays). **Cached as a promise for the whole session**; a failure clears the cache. Never invalidated (ponytail comment) — only a reload refreshes it.
- URL builders: `coverUrl(id, size)` (gonic `getCoverArt`), `streamUrl`, `downloadUrl`.
- Downloads: `downloadTrack(track)` fetches a blob and saves `Artist - Title.ext`; `downloadZip(tracks, name)` fetches each track and builds a **store-only zip** in the browser (`makeZip` + `crc32`); one track → `downloadTrack`.
- Unused in the current UI: `getIndexes`, `getDirectory` (only `FolderNode.vue`, itself unmounted), `download`, `getArtistCoverMap`, `getArtistInfo`, `scrobble` (gonic scrobble — superseded by `api/scrobbles.js`).

### 3.3 Stores (Pinia, all setup-style)
| Store | State | Persistence |
|---|---|---|
| `config` | server, username, password, turnstileSiteKey, loggedIn | none (memory) |
| `player` | queue, currentIndex, currentTrack, isPlaying, shuffle, repeat, currentTime, duration, volume | `attic_volume` only |
| `playlist` | playlists (for TrackItem's + menu) | none; `load()` refetches every time the menu opens |
| `filters` | genre, year, scope, opts `{scope, genres, years}`, yearsExpanded | none |
| `ui` | minimal, dark | `attic_ui_minimal`, `attic_ui_theme` |
| `jobs` | activeJobs, result, busy | none (survives route changes, not reloads) |
| `ratings` | byKey | none; loaded once per session, `load(true)` forces |

### 3.4 localStorage keys (complete list)
| Key | Written by | Meaning |
|---|---|---|
| `attic_volume` | player store | 0–1 |
| `attic_ui_minimal` | ui store | `'1'` = mini-player mode (ignored on launch inside Electron) |
| `attic_ui_theme` | ui store | `dark` / `light`; absent = follow system |
| `attic_player_minimized` | `Player.vue` | `'1'` = compact footer strip |
| `attic_tags_<albumId>` | `saveTagEdits` in Albums.vue / Artists.vue | JSON overrides: `title`, `artist`, `albumArtist`, `year`, `genre`, `_diskArtist`, `_diskAlbum` |
| `attic_genre_<albumId>` | **nothing writes it any more** | legacy genre override, still read as a fallback by `displayGenre` |
| `attic_lyrics_<trackId>` | `api/lyrics.js` | manual lyrics text |
| `attic_cfg` | nothing | legacy plaintext creds — deleted on every boot |

---

## 4. Layout and navigation

### 4.1 Routes (`router/index.js`)
`/login`, `/home`, `/artists`, `/artists/:id` (`artist-detail`), `/albums`, `/albums/:id` (`album-detail`), `/playlists`, `/playlists/:id`, `/search`, `/tools`, `/stats`, `/` → `/home`. Views are eagerly imported.

### 4.2 Desktop (`md` ≥ 768px)
- `App.vue`: `SideBar` + `<main><RouterView/></main>`, then `<Player/>`. In mini-player mode (`ui.minimal`) neither layout wrapper renders; only `Player` → `MiniWindow`.
- `SideBar.vue` (`w-56`, collapsible to a `w-14` icon strip via a local, unpersisted `collapsed` ref): title "attic player" (server URL tooltip) + collapse button → search field with **✨ Ask** button → Library nav (**Home, Artists, Albums, Playlists, Stats, Tools**) → `LibraryFilters` (only when `App.vue` passes `showFilters`, i.e. route is artists/artist-detail/albums/album-detail) → `RecentPlays` → footer (sign out · dark toggle · rescan · mini-player). Collapsed strip shows nav icons only.
- Sidebar search: 300 ms debounce → `search()`; dropdown of artists/albums/tracks; track click plays that single song; outside click closes.
- Layout rules (enforced by convention): sections `px-4` with `px-2` inside (one 24 px text edge), no divider lines, headings `text-xs font-medium uppercase tracking-widest text-stone-600`.

### 4.3 Mobile (< 768px)
- Full-width `<RouterView/>`; `Player` renders `MiniPlayer` (fixed `bottom:64px`, only when a track is loaded), `FullPlayer` (slide-up modal) and `BottomNav`.
- `BottomNav.vue` has **6** tabs: Home, Artists, Albums, Playlists, Search, Tools. **Stats has no mobile entry.**
- iOS rules (`style.css`, `App.vue`): root is `h-[100dvh]` on mobile; inputs/selects/textareas forced to 16 px `!important` below `md` (prevents WebKit zoom). Desktop sizes from `html, body, #app {height:100%}` instead of dvh.

### 4.4 Global styling
- `style.css`: Tailwind import, `--accent: #B85C38`, every `img` gets a 1 px black hairline with `border-radius: inherit`, `.dark` palette swap (redefines `--color-white`, `--color-stone-*`, some `--color-amber-*`). Components carry **no** `dark:` classes.

---

## 5. Playback

### 5.1 Player store (`stores/player.js`)
- One module-level `Audio` (`preload='auto'`). Stream URL: `<server>/rest/stream?…&id=<id>&format=raw` (builds its own URL; same auth as `buildUrl`).
- `playTrack(track, list?, index)` replaces the queue when a list is given; `playFromQueue(i)`; `togglePlay`; `nextTrack` (shuffle = random index; no wrap at end); `prevTrack` (restarts if > 3 s in); `addToQueue`; `clearQueue`; `jumpToQueue`; `seek(event, el)` (click position on a bar); `setVolume`/`toggleMute`; `fmt(secs)`.
- `ended` → repeat replays the same track, else `nextTrack()`.
- **Scrobble**: threshold `max(30, min(duration/2, 240))` s, set on `durationchange`; once crossed, `scrobble(track)` from `api/scrobbles.js` (once per track). See §10.
- Media Session: metadata (artwork = `trackCover(track)`), position state on every `timeupdate`, handlers play/pause/next/prev/seekto.
- Views add whole albums with `player.queue.push(...)` directly (no store action).

### 5.2 Player UIs
| Component | Where | Notes |
|---|---|---|
| `Player.vue` footer | desktop, `hidden md:flex`, `h-20` | track info (cover via `trackCover`), shuffle/prev/play/next/repeat, click-to-seek bar, download current track, mute + volume (slider hidden below `lg`), **Lyrics** and **Queue** panels (mutually exclusive, fixed `bottom-20 right-0 w-72`), chevrons-down → minimize |
| `CompactPlayer.vue` | desktop when `attic_player_minimized` | `h-12` strip; cover/chevrons-up expand. Minimizing closes the panels |
| `MiniWindow.vue` | `ui.minimal` | whole window = cover, title, scrubber, prev/play/next, exit. No `md:` gating. Electron resizes the window to 380×160 always-on-top |
| `MiniPlayer.vue` | mobile | thin progress strip, prev/play/next, tap → FullPlayer |
| `FullPlayer.vue` | mobile | queue view toggle, Art/Lyrics toggle, synced lyrics auto-center, manual lyrics paste, seek, volume, transport |

Queue panel: "+ Playlist" saves the whole queue via `createPlaylist(name, ids)`; "Clear" empties it.

### 5.3 Lyrics (`api/lyrics.js`)
Order: manual (`attic_lyrics_<id>`) → in-memory cache by track id → `https://lrclib.net/api/get` (artist, title, album, rounded duration). Returns `{plain, synced}` (synced = `[{time, text}]` parsed from LRC) or `null` (cached too). Fetched only when a lyrics panel is open. Active line = last line whose time ≤ `currentTime`, scrolled into view.

---

## 6. Library views

### 6.1 Home (`views/Home.vue`)
On mount, in parallel: `getArtists()`, `getNewestAlbums(100)`, `getRandomAlbums(20)`.
- Recent artists = first 20 distinct `artistId`s from newest albums (name = `albumArtist || artist`).
- Discover artists = 20 random from the full index (client shuffle).
- **Desktop** (`hidden md:block`): Recently Added (artists), Discover Artists, Discover Albums — each a one-row grid (`auto-fill minmax(7.5rem,1fr)`, `grid-auto-rows:0`, no bottom padding).
- **Mobile** (`md:hidden`): Recently Added Artists, Recently Added Albums, Discover Albums — 4 each, `Show all ›` links. Top bar: favicon + "attic music" + dark toggle.

### 6.2 Artists (`views/Artists.vue`)
Internal `view` state machine: `grid` → `artist` → `album`. Only `artist-detail` is a route; **album detail inside Artists is not routed** (no URL, the back button leaves Artists).
- Mount: `filters.setScope('artists')`; `loadArtists()` + `getNewestAlbums(100)` in parallel; **then** `getArtistGenreMap()` (after the grid loads, so its paging doesn't compete). Recent artists = first 20 distinct from newest albums; `addedOrder` for mobile sort.
- **Desktop grid**: letter bar (`# a…z`, toggles + scrolls a collapsed letter group), Recently Added + Discover Artists rows (wrap, `max-height:124px` until "Show more" when >10), then expanded letter groups of `ArtistCard`s.
- **Mobile grid**: mounted only when `isMobile` (`matchMedia('(max-width: 767px)')`) — **do not convert to CSS-hidden**, it made desktop fetch ~4,600 avatars. Search box, native genre/year `<select>`s (lists = `filters.opts`), sort chips A–Z / Added (rank from newest-100) / Discover (random keys re-rolled by a `watch`, not in the computed). Avatars `loading="lazy"`.
- **Filters**: `distinctGenres/Years` from `artistGenreMap`; published to the filters store once non-empty. An artist matches when any of its albums has the genre/year.
- **Artist detail**: avatar button (opens avatar search), album grid split by `artistId`: **main albums** (album's `artistId` = this artist; fallback compares names) vs **"also appears on…"** (everything else). Both sorted by year then name. Cards show year · tracks · genre and the rating.
- **Album detail**: same machinery as Albums.vue (§6.3) — duplicated code.

### 6.3 Albums (`views/Albums.vue`)
- Mount: `filters.setScope('albums')`, `loadRecent()` (newest 20 + random 20, desktop carousels), `loadAlbums()`; if the route has `:id`, open it (from the loaded page or by id).
- Paging: `getAlbumPage(100, offset, sort)`; IntersectionObserver on a sentinel; `fillUntilOffscreen()` keeps paging while the sentinel is visible. `random` loads one page then sets `allLoaded` (ponytail).
- Mobile sort chips ids **are** `getAlbumList2` types (`alphabeticalByName` / `newest` / `random`); changing sort publishes empty filter lists and re-pages.
- **Filters**: options and matching come from `album.genre` / `album.year` of the **paged-in albums only**. A filter matching nothing loaded yet keeps paging. Mobile has its own `<select>`s; desktop uses the sidebar.
- Desktop-only: Recently Added carousel (‹ › buttons) and a one-row Discover grid.
- Grid: `grid-cols-4` mobile, `auto-fill minmax(100px,1fr)` desktop. Artist name click → `openArtistByName` (scans `getArtists()` for an exact name, else `/artists`).
- **Album detail**: cover with fallback (§7.1), Edit / Location buttons, `AlbumRating full`, Play / + Queue / Download, "On-disk location" box (`albumPath`), `TrackItem` rows (editable, selectable).

### 6.4 Shared album-detail mechanics (Albums.vue **and** Artists.vue)
- `albumPath` = first track's gonic `path` minus filename (e.g. `h/the_high_llamas/2003-beet_maize__corn`). Sent as `dir` on every album-level sidecar call.
- `albumDiskIdentity()` = `_diskArtist`/`_diskAlbum` from `attic_tags_<id>` if saved, else `albumArtist || artist` and `name`. Sent as `artist`/`album`; the sidecar only uses it when `dir` is empty.
- `display{Title,Artist,Year,Genre}` = localStorage override → (genre only: legacy `attic_genre_<id>`) → server value. `tagsVersion` bump forces recompute.
- Selection: `selectedIds` (reset when tracks change); Download zips the selection or the whole album.

### 6.5 Search (`views/Search.vue`, mobile)
300 ms debounced `search()`; shows artists + albums (no songs). ✨ toggle switches to AI mode (submit on Enter/Send → `askAI`), renders reply + `TrackItem`s.

### 6.6 Playlists (`views/Playlists.vue`)
List grid (cover via gonic `coverUrl(pl.coverArt)`), "+ New" (create, then refresh both the view list and the store), detail with Play / Queue / Download (selected or all) / Delete (`confirm()`), `TrackItem removable` → `updatePlaylist(songIndexesToRemove)` then splice locally. Route `/playlists/:id` only resolves playlists already in the list.

### 6.7 `TrackItem.vue`
Grid `28px 1fr [1fr md] 44px 56px`. # column = checkbox when `selectable` (hover-revealed), ♪ when playing, else track number (playlist index when `removable`). Optional edit-tags button (`editable` → emits `edit`). `+` menu: playlists (store `load()` on every open) → `addTrack`; Add to queue; Download; Remove from playlist (`removable`). Click row → emits `play`.

---

## 7. Covers and avatars

### 7.1 Display
- **Album covers come from the sidecar, not gonic.** `albumCover(album, dir?)` → `/artist-images/album?artist=<albumArtist||artist>&album=<name>[&dir=]`. The sidecar stats `cover.jpg` per request and answers `Cache-Control: no-cache` (304 via Last-Modified), so a replaced cover shows at once.
- Grid tiles: `onAlbumCoverError(e, album)` — first miss fetches `getAlbum(id)` to learn the folder from the first track's path and retries with `dir`; second miss hides the img (💿 placeholder behind it).
- Album detail: `albumDetailCoverSrc = albumCover(album, albumPath)`; error → state `failed` → "Add cover" button.
- Now-playing artwork (footer, compact, mini, mobile, Media Session): `trackCover(track)` = same endpoint with `dir` from the track path.
- gonic `getCoverArt` is only used by Playlists and the Tools album picker.
- **Artist avatars**: `/artist-images/avatar?name=<name>` (sidecar, `max-age=86400`) → on error the letter placeholder. Always circular (`rounded-full`); album covers never circular.

### 7.2 Search and upload (`useCoverSearch` + `api/covers.js`)
- One modal per view, `target` = `'album'` or `'avatar'` (avatar candidates render round).
- Album candidates, in parallel, streamed into the grid as each answers (8 s timeout each):
  - **Cover Art Archive** — MusicBrainz release search (`release:"…" AND artist:"…"`, retried up to 3× on 503), releases with score ≥ 80 → `coverartarchive.org/release/<id>/front-1200`.
  - **Deezer** — `/deezer-api/search/album` → `cover_xl`.
  - **Wikipedia** — top search hit for `"<album>" <artist> album`, its JPEG/PNG images ≥ 200 px (1000 px thumbs).
- Artist candidates: Wikipedia (lead image + up to 15 embedded photos, logos/icons/svg filtered) and Deezer (exact-name matches only, placeholder `/artist//` URLs dropped).
- Deezer is only ever a **manual pick** here. It previously wrote wrong-album covers across the library when used for automatic matching — never use it as an automatic cover source.
- Pick → `uploadFromUrl` fetches the bytes (`cache:'reload'`, `Accept: image/jpeg,image/png` to avoid WebP) and POSTs them as multipart `cover`; or "Upload from device".
- Album upload → `POST /artist-images/upload?artist=&album=&dir=`; on success `sidecarAlbumCover()` returns the URL with `&t=<now>` **and schedules `startScan()` after 6 s** (so gonic picks up the embedded art).
- Avatar upload → `POST /artist-images/upload-avatar?name=`; URL refreshed with `&t=`.

---

## 8. Genre/year filters

- **Store** (`stores/filters.js`): `genre`, `year` (number), `scope` (`artists`|`albums`), `opts` (option lists of the active scope). `publish(scope, genres, years)` sorts and stores them. Watchers **drop a picked genre/year that is not in the current `opts`** — that is why a value must be in the published list to stay selected.
- `App.vue` sets `scope` from the route name; `setScope` clears picks and options when the scope changes.
- `LibraryFilters.vue` (desktop sidebar): Genre/Year dropdowns that open upward, `Clear` pill, "Albums in X from Y" note; "Filters load with the library…" until the active scope has published.
- **Data sources differ by view:**
  - Artists → `getArtistGenreMap()` (whole library, session-cached).
  - Albums → the albums paged in so far.
- **Freshness after a tag edit** (the 2026-11-26 bug):
  - Albums.vue `saveTagEdits` now also writes the new genre onto the album object in the loaded `albums` list, so the dropdown and filter update immediately. Only `genre` is patched — title/year/artist edits are not reflected in the grid or filters until reload.
  - Artists.vue: no such patch; the artist filter uses the session-cached genre map and does **not** see edits until a page reload, and then only after a gonic rescan.
  - After any reload, all genres come from gonic again, so they are correct only once a gonic scan has run (none is triggered by saving tags).

---

## 9. Tag editing

Flow (both album views, `saveTagEdits`):
1. Modal fields: Title, Artist, Album Artist, Year (4 digits), Genre (free text input with a filtered dropdown of the 40 names in `api/genres.js`; `@mousedown.prevent` keeps focus). Free text is **not** rejected — the list is a suggestion.
2. `saveAlbumTags(diskArtist, diskAlbum, albumPath, {title, artist, albumArtist, year, genre})` → `POST /artist-images/album-tags` (multipart). Sidecar maps to `TALB`, `TPE1`, `TPE2`, `TCON`, `TDRC`+`TYER` and writes **every .mp3 in the folder in a background goroutine** (~3.5 s/track over NFS), answering **202 immediately**. Write failures only reach the sidecar log.
3. On 2xx: write `attic_tags_<id>` (fields that differ from the server value; genre always when non-empty; `_diskArtist`/`_diskAlbum` recorded), bump `tagsVersion`, close.
4. **No gonic scan is triggered.** The user runs a rescan (sidebar footer or Tools). The localStorage override keeps the detail view correct meanwhile.

Track edits: `saveTrackTags(diskArtist, diskAlbum, albumPath, <file basename>, {title, artist, track})` → `POST /artist-images/track-tags` → `TIT2`/`TPE1`/`TRCK` on one file (synchronous, 200). The in-memory track object is patched; nothing is stored in localStorage.

---

## 10. Scrobbles, recent plays, stats

**Last.fm is gone.** The app is its own scrobbler; gonic's `scrobble` is no longer called.
- `stores/player.js` → `api/scrobbles.js scrobble(track)` → `POST /chat-api/scrobbles {artist, album, track}` → chat-server lowercases them and inserts `{ts (server time), artist, album, track}` into ClickHouse `music.scrobbles` (HTTP interface, `JSONEachRow`).
- `RecentPlays.vue` (sidebar, collapsible, open by default): `getRecentScrobbles(5)` every 30 s (`GET /chat-api/scrobbles?limit=5`, newest first) showing track / artist / album / "Xm ago". Only the album is a button: `findLibraryAlbum({artist, album})` (search3 on the album name; exact name + artist match, else exact name only; memoized per session, failures not cached) → `album-detail`, or "not in library" (carried across polls). The `nowplaying` styling never triggers — the API does not return that field.
- `Stats.vue` (`/stats`, desktop nav only): plays-per-year bar chart (click a bar to filter by that year), plays-per-month (12 bars, selected year or all time), top artists/albums/tracks (50) for the selected year. All via `GET /chat-api/scrobbles/stats?by=artist|album|track|year|month[&year][&artist][&limit]` (limit 1–200, fixed SQL shapes, values bound as ClickHouse query params).

---

## 11. Discogs ratings

- chat-server owns them: `GET /ratings` → the whole map; `POST /ratings?artist=&album=[&force=1]` → stored value or fetch-and-store. Stored in `/data/ratings.json` (PVC `chat-server-data`, written via tmp + rename; a corrupt file stops the server from starting). A "no votes" result is stored too.
- Algorithm: Discogs search by master (most-owned hit; avoids same-titled singles) → top 5 most-collected versions → each release's rating → vote-weighted mean (2 dp). No master → single most-owned release. ~7 calls per album, Discogs limit 60/min.
- Key: `ratingKey(artist, album)` — NFKD, strip marks, lowercase, drop non-alphanumerics, `artist|album`. **Defined twice — `chat-server/index.js` and `src/api/chat.js` — keep identical.**
- Frontend: `ratings` store loads the map once; `AlbumRating.vue` shows ` · ★ 4.3` on cards (`bare` drops the dot) and, with `full`, the detail line with a "Fetch Discogs rating" / ↻ button. Keyed by `albumArtist || artist` + `name`.
- Tools page "Discogs rating" fetches sequentially for the selection, stops at the first error, then `ratings.load(true)`.
- Needs `DISCOGS_TOKEN` (optional secret key); without it stored ratings are still served and the LLM tool is not offered.

---

## 12. Library maintenance (Tools page)

### 12.1 UI (`views/Tools.vue` + `stores/jobs.js` + `api/maintenance.js`)
- Header: **↻ Rescan sidecar index** (`POST /rescan` job) and **↻ Rescan library** (gonic `startScan`, polls `getScanStatus` every 30 s).
- Picker modes: **Album** (search3 albums), **Artist** (search3 artists → `getArtist` albums), **Letter** (a–z, `1`; audit only).
- `targets()` → `[{artist, album}]`: album mode uses `albumArtist || artist` + name; **artist mode uses the picked artist's name for every album** (the physical artist folder).
- Sections (shown once an album/artist is picked): Audit, Tag cleanup (sort-tags / golden-set / lowercase / from-filename; Preview + Apply with `confirm()`), Artwork (normalize / re-embed), Convert (mp3 from flac/m4a/mp4 at a bitrate, or wav→flac; delete originals default **on**), Enrich (genre+year from MusicBrainz, optional overwrite year; lyrics from LRCLIB), Discogs rating.
- One job per target album. `jobs` store: `launchJob(startFn, label)` → push `{id,…}` → poll `GET /job?id=` every 1.5 s → when a job finishes, `result` = the last finished job mapped to `{ok, data}` (audit report or `{changes, applied, op}`). State survives navigating away from `/tools`.
- Footer reminder: tag changes need a gonic rescan.

### 12.2 Sidecar job model
- Every maintenance POST returns **202 `{id}`** and runs `fn` in a goroutine (panic → job error). Jobs touching the same album dir are serialized by a per-dir mutex; different albums run in parallel. Last 50 jobs kept in memory (`GET /jobs` newest first). Job shape: `{id, op, applied, status running|done|error, message, progress, total, error, changes[{file,detail}], data, startedAt, finishedAt}`.
- **These endpoints locate albums by name only** (`albumDirOf(normalize(artist)|normalize(album))`) — they do not accept `dir`. Albums whose tags and folder disagree may 404 ("album directory not found").

---

## 13. Backends

### 13.1 artist-images sidecar (`artist-images/main.go`)
**Index** (`buildMap(root, withTags)`): walks `<root>/<letter>/<artist>/<YYYY-album>/` and builds
`coverMap` (normalize(artist folder) → artist `cover.jpg`), `albumCoverMap` (artist|album → album `cover.jpg`), `albumDirMap` (artist|album → album dir — keyed **both** by folder names and, on the tag pass, by the first mp3's `TPE2`-or-`TPE1` | `TALB`), `artistDirMap`. Startup builds without tags (fatal if no artist covers: "NFS not ready?"), then a tag pass in the background; full rebuild every **30 minutes** and on `POST /rescan`.

`normalize(s)`: accent fold, lowercase, `&`→`and`, split on non-alphanumerics, drop a leading article (`the los las le les el la die das der gli il`) only if more words follow, join.

**Album lookup** (`albumDirFor`): `dir` query param → `filepath.Join(root, Clean("/"+dir))` (cannot escape root; must be an existing dir); else `albumDirOf` name lookup.

| Endpoint | Method | Behaviour |
|---|---|---|
| `/album?artist=&album=[&dir=]` | GET | serve album `cover.jpg`, stat per request, `no-cache` |
| `/avatar?name=` | GET | serve artist `cover.jpg` from `coverMap`, `max-age=86400` |
| `/upload?artist=&album=[&dir=]` | POST multipart `cover` (≤10 MB) | `toJPEG` (JPEG/PNG/GIF untouched, anything else e.g. WebP re-encoded q90) → write `cover.jpg` → **202**, then background `embedCover` (APIC front cover into every mp3; fire-and-forget) |
| `/upload-avatar?name=` | POST multipart `cover` | `squareJPEG` (centre crop, scale **down** to ≤150 px, q88) → artist `cover.jpg` → 200 |
| `/album-tags?artist=&album=[&dir=]` | POST multipart | TALB/TPE1/TPE2/TCON/TDRC+TYER to every mp3, **background**, 202 |
| `/track-tags?artist=&album=[&dir=]` | POST multipart (`file` basename) | TIT2/TPE1/TRCK to one file, synchronous, 200 |
| `/audit` (`scope=all|letter&letter=` or `artist&album`) | POST | job; report `{folder, trackCount, conflicts, junkTags, missing}`; library/letter mode returns only problem albums |
| `/cleanup?op=sort-tags|golden-set|lowercase|from-filename[&apply=1]` | POST | job |
| `/normalize-cover` | POST | job: first of `cover.jpg, cover.jpeg, cover.png, folder.jpg, folder.jpeg, front.jpg` → `toJPEG` → `cover.jpg` |
| `/re-embed-cover` | POST | job: synchronous `embedCover` |
| `/convert?to=mp3|flac&bitrate&deleteOriginal=1[&apply=1]` | POST | job: ffmpeg per file |
| `/enrich?fields=genre,year[&overwriteYear=1][&apply=1]` | POST | job: MusicBrainz (search by folder-derived names, 1 req/s, retry once on 5xx); genre = most-counted non-generic genre/tag, title-cased; year = earliest found |
| `/enrich-lyrics[?apply=1]` | POST | job: LRCLIB → USLT (+ `.lrc` when synced lyrics exist) |
| `/resize-avatars[?apply=1]` | POST | job: shrink every artist `cover.jpg` to ≤150 px square (tmp + rename; skips already-done) |
| `/rescan` | POST | job: rebuild index now |
| `/job?id=`, `/jobs` | GET | job state |

Tag rules: golden set `TIT2 TALB TPE1 TPE2 TRCK TDRC TPOS TCOM TPE3 APIC TCMP`; grouping tags aligned to the first file `TALB TPE2 TDRC TPOS TCMP`; audit-critical `TALB TPE2 TDRC`. `writeFrames` preserves file mode (id3v2 recreates files 0644). **mp3 only** — FLAC etc. are never tag-edited by the sidecar.

All endpoints are **unauthenticated** and reachable publicly through nginx at `https://music.ekskog.me/artist-images/…`.

### 13.2 chat-server (`chat-server/index.js`)
| Route | Purpose |
|---|---|
| `POST /chat {message, provider?}` | LLM tool loop → `{reply, songs, albums, artists}` |
| `GET /providers` | `[{id, label}]` |
| `GET /scrobbles?limit=` (1–100, default 5) | recent plays |
| `POST /scrobbles {artist, album?, track}` | insert (lowercased, server timestamp) → 201 |
| `GET /scrobbles/stats?by=&year=&artist=&limit=` | play counts |
| `GET /ratings`, `POST /ratings?artist=&album=[&force=1]` | Discogs ratings |

- Upstream failures answer **424** (not 5xx — Cloudflare would replace a 502 body). `/chat` errors are 500.
- Loop (`runChat`, max 5 turns): tools `search_music` (gonic search3, results accumulated by id), `show_songs` (the ids the UI renders; unknown ids dropped; never called → all found songs), `scrobble_stats`, `discogs_rating` (only when `DISCOGS_TOKEN`). Ends on a turn without tool calls. System prompt demands plain prose, 1–2 sentences.
- Providers from `LLM_PROVIDERS` (JSON array, first = default; `kind` `anthropic` via SDK or `openai` via fetch to `<baseUrl>/chat/completions`, key from `apiKeyEnv`). Startup exits on bad JSON, a bad entry, a missing provider key, missing `GONIC_*`, or a corrupt ratings file.
- Prod: single DeepSeek provider (`deepseek-v4-flash`). Frontend never sends a provider.
- gonic auth: token (`md5(password+salt)`), client `chat-server`.

### 13.3 MCP server (`mcp-server/`)
12 tools: `ping`, `search`, `list_artists`, `get_artist`, `get_album`, `list_playlists`, `get_playlist`, `create_playlist`, `get_album_rating`, `list_album_ratings` (both via chat-server at `CHAT_API_URL`, default the public `/chat-api`), `start_scan` (gonic admin form login → `/admin/start_scan_inc_do`, incremental only), `scan_status`. Creds in gitignored `gonic.env` (`NAVIDROME_*` names), loaded by `run.sh`.

### 13.4 Electron (`electron/`)
Loads `ATTIC_URL` (default the live site), single instance, external links → default browser. IPC (only from the app origin): `attic:set-mini` (380×160 always-on-top ↔ restore previous bounds), `attic:get|save|clear-credentials` (`userData/credentials.bin`, `safeStorage`-encrypted, refuses without encryption). Unsigned `.dmg` via `npm run dist`.

### 13.5 Scripts (run by hand, never call gonic)
- `scripts/musiclib.py` — interactive library manager (ARCHITECTURE.md §7).
- `scripts/check_covers.py` — read-only, run from the library root: interactively reports artist folders without `cover.jpg`, album folders without `cover.jpg`, and album folders whose name/artist folder won't match their tags under the sidecar's normalization (prints the `mv` that would fix it). Needs mutagen.
- `scripts/artist-setup.py`, `tools/set-album-artist.py` — see ARCHITECTURE.md §7.

---

## 14. Deployment

- **CI** (`.github/workflows/deploy.yaml`, on push to `main`):
  1. `build-attic-music` — writes `public/config.json` (`server`, `username`, `turnstileSiteKey` from secret), builds/pushes `:latest` + `:<sha>`, then `kubectl set image deployment/attic-music attic=…:<sha>` + rollout status (immutable tag, not a restart).
  2. `build-artist-images` — only if `git diff HEAD~1 HEAD` touches `artist-images/`: build, push, `kubectl apply -f k8s/artist-images.yaml`, rollout restart.
  3. `build-chat-server` — same, path filter `chat-server/`. Editing only `k8s/chat-server.yaml` skips the job → apply by hand.
- **Images**: frontend = node:22 build → `nginx:alpine` with `nginx.conf` (`index.html` and `manifest.webmanifest` no-cache; SPA fallback; gzip). Sidecar = golang:1.22 build → `debian:bookworm-slim` **with ffmpeg**. chat-server = node:22-slim `npm ci --omit=dev`.
- **k8s** (ns `webapps`): `attic-music` (1 replica, `imagePullPolicy: Always`, no init container). `artist-images` (ConfigMap `LOG_REQUESTS=false`; init container fails if the NFS mount is empty; static PV/PVC `artist-images-music` with `nfsvers=4.1` — on 4.2 id3v2 saves hang in an async server-side COPY). `chat-server` (`strategy: Recreate` because of the RWO PVC `chat-server-data` 10Mi; env from `chat-server-secret`; `CLICKHOUSE_URL=http://clickhouse.data:8123`).
- `k8s/chat-server-secret.example.yaml` is a template — but it currently contains what looks like a real gonic password and a DeepSeek key placeholder; never commit a filled copy.
- PWA: `manifest.webmanifest` (standalone, dark theme colour), `sw.js` registers but does nothing (no offline cache).

---

## 15. Known gaps and quirks (observed, not fixed)

- Album detail inside **Artists** is not a route.
- Artists genre filter never reflects tag edits within a session (§8).
- Tag saves never trigger a gonic scan; cover uploads do (after 6 s).
- `/album-tags` write failures are invisible to the UI (background goroutine, log only).
- Maintenance endpoints ignore `dir` (name lookup only).
- `RecentPlays` `nowplaying` branch is dead (API never returns it).
- Mobile has no way to reach `/stats`.
- `TrackItem`'s + menu refetches playlists on every open.
- Dead code: `components/FolderNode.vue` (never mounted), `getIndexes`, `getDirectory`, `download`, `getArtistCoverMap`, `getArtistInfo`, gonic `scrobble` in `api/subsonic.js`; `public/icons.svg`; the `id` param of `sidecarAlbumCover`; legacy `attic_genre_<id>` read path.
- Albums.vue and Artists.vue duplicate the whole album-detail / tag-edit / cover-search block — a fix in one must be mirrored in the other.

## 16. Drift in README.md / ARCHITECTURE.md (as of this writing)

They still say, incorrectly:
- Last.fm scrobbling / `src/api/lastfm.js` / `lastfmKey` in config / gonic `scrobble` — replaced by chat-server + ClickHouse (§10).
- Album cover chain starts at gonic `getCoverArt` — it starts at the sidecar (§7.1).
- Sidecar rescans every 5 minutes; `LOG_REQUESTS=true` — it is 30 minutes and `false`.
- Genre overrides live in `attic_genre_<id>` with a `genreVersion` ref — it is `attic_tags_<id>` + `tagsVersion` (§9).
- BottomNav has 5 tabs — it has 6 (adds Tools); Stats/Tools pages not described.
- k8s init container generates `/config.json` — CI bakes it into the image; no init container.
- MCP server has 10 tools — it has 12.
- `Folders.vue` exists — it does not.
