#!/usr/bin/env node
// Minimal MCP server wrapping the Subsonic API (works against gonic, Navidrome, Airsonic, ...).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createHash, randomBytes } from "node:crypto";

const BASE_URL = process.env.NAVIDROME_URL;
const USERNAME = process.env.NAVIDROME_USERNAME;
const PASSWORD = process.env.NAVIDROME_PASSWORD;

if (!BASE_URL || !USERNAME || !PASSWORD) {
  console.error("[ERROR] NAVIDROME_URL, NAVIDROME_USERNAME, NAVIDROME_PASSWORD must be set");
  process.exit(1);
}

async function subsonic(endpoint, params = {}) {
  const salt = randomBytes(6).toString("hex");
  const token = createHash("md5").update(PASSWORD + salt).digest("hex");
  const query = new URLSearchParams({
    u: USERNAME,
    t: token,
    s: salt,
    v: "1.16.1",
    c: "gonic-mcp",
    f: "json",
    ...params,
  });
  const res = await fetch(`${BASE_URL}/rest/${endpoint}.view?${query}`);
  const body = await res.json();
  const r = body["subsonic-response"];
  if (r.status !== "ok") {
    throw new Error(r.error?.message || `Subsonic error (code ${r.error?.code})`);
  }
  return r;
}

// gonic-specific admin API (not part of Subsonic) — session cookie auth, separate from the token auth above.
// ponytail: incremental only — full scans are single-threaded and can run 10x+ longer (see README); add a `full` option back if a real need for it shows up.
async function adminScan() {
  const login = await fetch(`${BASE_URL}/admin/login_do`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: USERNAME, password: PASSWORD }),
    redirect: "manual",
  });
  const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie")])
    .filter(Boolean)[0]
    ?.split(";")[0];
  if (!cookie) throw new Error("gonic admin login failed (no session cookie returned)");

  const scan = await fetch(`${BASE_URL}/admin/start_scan_inc_do`, {
    method: "POST",
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  if (scan.status >= 400) throw new Error(`scan trigger failed: HTTP ${scan.status}`);
  return { started: true };
}

const TOOLS = [
  {
    name: "ping",
    description: "Check connectivity to the music server",
    inputSchema: { type: "object", properties: {} },
    run: () => subsonic("ping"),
  },
  {
    name: "search",
    description: "Search artists, albums and songs by free text query",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    run: ({ query }) => subsonic("search3", { query }).then((r) => r.searchResult3),
  },
  {
    name: "list_artists",
    description: "List all artists in the library",
    inputSchema: { type: "object", properties: {} },
    run: () => subsonic("getArtists").then((r) => r.artists),
  },
  {
    name: "get_artist",
    description: "List albums for a given artist id",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    run: ({ id }) => subsonic("getArtist", { id }).then((r) => r.artist),
  },
  {
    name: "get_album",
    description: "List songs for a given album id",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    run: ({ id }) => subsonic("getAlbum", { id }).then((r) => r.album),
  },
  {
    name: "list_playlists",
    description: "List all playlists",
    inputSchema: { type: "object", properties: {} },
    run: () => subsonic("getPlaylists").then((r) => r.playlists),
  },
  {
    name: "get_playlist",
    description: "Get the songs in a playlist by id",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    run: ({ id }) => subsonic("getPlaylist", { id }).then((r) => r.playlist),
  },
  {
    name: "create_playlist",
    description: "Create a playlist from a name and a list of song ids",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        songIds: { type: "array", items: { type: "string" } },
      },
      required: ["name", "songIds"],
    },
    run: ({ name, songIds }) =>
      subsonic("createPlaylist", { name, songId: songIds }).then((r) => r.playlist),
  },
  {
    name: "start_scan",
    description: "Trigger an incremental gonic library scan (admin-only, gonic-specific — not standard Subsonic). Full rescans aren't exposed here; they're much slower on this server.",
    inputSchema: { type: "object", properties: {} },
    run: () => adminScan(),
  },
  {
    name: "scan_status",
    description: "Check whether a library scan is currently in progress, and the current track count",
    inputSchema: { type: "object", properties: {} },
    run: () => subsonic("getScanStatus").then((r) => r.scanStatus),
  },
];

const server = new Server(
  { name: "gonic-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);
  try {
    const result = await tool.run(req.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
