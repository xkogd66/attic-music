# attic-music

A responsive Vue 3 music player webapp that connects to a Subsonic-compatible server (Gonic) for music library browsing and playback, with optional Last.fm scrobbling.

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
artist-images/
  main.go         # Go sidecar — serves artist cover.jpg from NFS
  Dockerfile      # multi-stage build → minimal Alpine image
src/
  api/
    subsonic.js   # Subsonic REST API client
    lastfm.js     # Last.fm scrobbling integration
    lyrics.js     # LRCLIB lyrics fetching + manual lyrics
    genres.js     # 40 curated standard genre names
  stores/
    config.js     # user config (server URL, credentials, lastfm)
    player.js     # playback state, queue, shuffle/repeat
    playlist.js   # playlist list cache + addTrack action
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
  components/
    Player.vue       # desktop footer player + queue
    MiniPlayer.vue   # mobile mini player
    FullPlayer.vue   # mobile full-screen player
    BottomNav.vue    # mobile bottom nav (5 tabs)
    SideBar.vue      # desktop sidebar (nav + last.fm scrobbles)
    FolderNode.vue   # expandable folder tree node
    TrackItem.vue    # track list item
    ArtistCard.vue   # artist grid card with circular avatar
  App.vue           # root layout + auth check
  main.js           # entry point
  style.css         # Tailwind import + root styles
```

## Architecture Notes

### Auth & Config
- On load, the app fetches `/config.json` for server-provisioned settings (Last.fm API key, optional pre-configured server)
- User credentials are persisted to `localStorage` under key `attic_cfg`
- Route guards block all routes until `config.loggedIn` is true
- In CI, the GHA workflow writes `public/config.json` (including `lastfmKey` from the `LASTFM_API_KEY` GitHub Actions secret) before the Docker image is built, so the key is baked into the image as a static file served by Nginx

### Routing
- Default route `/` redirects to `/home`
- `/home` → `Home.vue` (mobile discovery landing page)
- `/artists`, `/artists/:id` → `Artists.vue`
- `/albums`, `/albums/:id` → `Albums.vue`
- `/playlists`, `/playlists/:id` → `Playlists.vue`
- `/search` → `Search.vue`

### Subsonic API
- All music data comes from `src/api/subsonic.js`, which wraps the Subsonic REST API
- Auth uses hex-encoded password per Subsonic spec; client ID is `atticweb`, API version `1.16.1`
- Dev server proxies `/rest` → `https://gonic.ekskog.net` (see `vite.config.js`)
- Production traffic hits the server the user logs into directly from the browser
- `search3` returns artists (5), albums (8), and songs (8); `getArtistGenreMap()` uses plain arrays (not Sets) for Vue reactivity
- `getRandomAlbums(n)` is used for discovery carousels

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

### Mobile Navigation (BottomNav)
- 5 tabs: Home (House), Artists (Mic2), Albums (Disc3), Playlists (ListMusic), Search (Search) — all lucide icons
- Active tab: amber; inactive: stone-400
- `isActive(path)` uses `route.path.startsWith(path)`

### Mobile Home Page (Home.vue)
- Landing page for mobile; loads on app start (`/` redirects to `/home`)
- Three horizontal swipe carousels: **Recently Added** (artists from newest albums), **Discover Artists** (random shuffle of all artists), **Discover Albums** (`getRandomAlbums(20)`)
- Clicking an artist navigates to `/artists/:id`; clicking an album navigates to `/albums/:id`
- Carousel card sizing: `w-full flex` on the scroll container + `width: calc(100% / 3 - 8px)` on each card. The `w-full` gives the flex container a definite width so `100%` in children resolves against the container's content width (not the sum of all items). The `-8px` deducts the proportional gap cost (2 × 12px ÷ 3).

### Mobile Artists Page (Artists.vue)
- **Header** (mobile): search input + Genre dropdown + Year dropdown in one row. Genre/year filter data comes from `getArtistGenreMap()` (loaded async, uses plain arrays for Vue reactivity).
- **Browse mode** (no search query and no filter active): shows Recently Added Artists carousel + Discover Artists carousel (no Discover Albums)
- **Search/filter mode** (query or filter applied): alphabetical contact list with letter-group headers and avatar thumbnails
- Desktop: unchanged — letter nav + genre/year filters + expandable letter groups + carousels

### Albums Page (Albums.vue)
- Genre and year filter dropdowns in the header (both mobile and desktop)
- **Recently Added** carousel (swipe on mobile; arrow buttons desktop-only via `hidden md:flex`)
- **Discover** carousel (random albums)
- Full infinite-scroll album grid below (loaded in pages of 100 via `getAlbumPage`)
- Clicking an artist name navigates to that artist in the Artists view

### Last.fm
- Optional; polls `https://ws.audioscrobbler.com/2.0/` every 30 seconds to show recent scrobbles in the sidebar
- Requires `LASTFM_API_KEY` (injected at runtime, not build time)

### Search (SideBar + Search.vue)
- Desktop search is in the sidebar (`SideBar.vue`); results show Artists, Albums, and Songs
- Song results in sidebar call `player.playTrack(song, [song], 0)` on click
- Mobile has a dedicated `/search` route

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
- Tailwind utility classes only — no custom CSS beyond root variables in `style.css`
- Keep API calls inside `src/api/`; views and components call store actions, not API methods directly
- Vue reactivity: never use `Set` or `Map` inside plain objects assigned to `ref` — use plain arrays with `.includes()` deduplication
- Carousel cards: always use `w-full` on the flex scroll container and `width: calc(100% / 3 - 8px)` on each card for exact 3-visible-card rows
