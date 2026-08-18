# gonic-mcp

> **Merged into attic-music.** This was originally its own standalone project
> at `~/Repos/mcp/gonic-mcp`, developed and tested against attic-music's own
> gonic instance (`https://gonic.ekskog.net` — the same server attic-music's
> frontend talks to via `src/api/subsonic.js`). It moved here on 2026-08-18
> because it's tooling for the same backend this repo already serves, not a
> separate product. See the root [README.md](../README.md#mcp-server) and
> [CLAUDE.md](../CLAUDE.md) for the pointer from this repo's main docs.

A minimal MCP (Model Context Protocol) server that lets Claude Code talk to a
[Subsonic API](http://www.subsonic.org/pages/api.jsp) music server — built
for [gonic](https://github.com/sentriz/gonic), but works against Navidrome,
Airsonic, or anything else that speaks the Subsonic/OpenSubsonic API.

## Why this exists

The published `navidrome-mcp` npm package talks to Navidrome's proprietary
`/auth/login` REST endpoint, not the standard Subsonic API. gonic only
implements Subsonic, so that package fails auth against it. This is a
from-scratch replacement using plain Subsonic calls (token-based auth,
`f=json` responses).

## Tools

| Tool              | Description                                |
|-------------------|---------------------------------------------|
| `ping`            | Check connectivity to the server            |
| `search`          | Free-text search across artists/albums/songs (`search3`) |
| `list_artists`    | List all artists                            |
| `get_artist`      | List albums for an artist id                |
| `get_album`       | List songs for an album id                  |
| `list_playlists`  | List all playlists                          |
| `get_playlist`    | Get the songs in a playlist                 |
| `create_playlist` | Create a playlist from a name + song ids     |
| `start_scan`      | Trigger an incremental gonic library scan   |
| `scan_status`      | Check if a scan is in progress, and current track count |

No streaming/playback, lyrics, or discovery tools — the Subsonic API doesn't
give a natural-language client anything useful for those beyond what's
already listed. Add tools as needed.

`start_scan` is gonic-specific (not part of the Subsonic API) — it logs in
via gonic's admin web form (`/admin/login_do`) to get a session cookie, then
POSTs to `/admin/start_scan_inc_do`. gonic's admin UI has no live
notification when a scan finishes (verified against gonic's source —
`main.js` is 3 lines, no polling/websocket/SSE, status is rendered
server-side on page load); poll `scan_status` instead. That one *is*
standard Subsonic (`getScanStatus`), so it uses normal token auth.

Incremental only, deliberately — gonic's scanner is single-threaded
([sentriz/gonic#634](https://github.com/sentriz/gonic/issues/634)), and a
full scan re-reads tags on every file instead of trusting mtimes, so it can
run an order of magnitude longer than an incremental scan on a large
library. Add a `full` option back only if you have an actual need for it.

## Files

- `index.js` — the server. Single file, no framework beyond
  `@modelcontextprotocol/sdk`. Builds Subsonic auth tokens with
  `md5(password + salt)` per request.
- `run.sh` — loads `./gonic.env` and execs `index.js`. Exists so
  credentials live only in `gonic.env`, never in the `claude mcp add`
  command or in `~/.claude.json`.
- `gonic.env` — `NAVIDROME_URL`, `NAVIDROME_USERNAME`,
  `NAVIDROME_PASSWORD` (names kept as-is; they just point at gonic). This
  file is **gitignored** (see `mcp-server/gonic.env` in the repo's root
  `.gitignore`) — attic-music is a public repo with CI, so it must never be
  committed.

## Setup

```bash
npm install
claude mcp add -s user gonic -- /path/to/attic-music/mcp-server/run.sh
```

Then reconnect with `/mcp` in Claude Code.

## Manual test

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping","arguments":{}}}\n' | ./run.sh
```
