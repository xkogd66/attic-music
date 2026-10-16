#!/usr/bin/env node
// HTTP backend for natural-language music search: Claude interprets the
// query, calls search_music (Subsonic search3 against gonic), we return the
// raw results plus Claude's short reply. Proxied by nginx at /chat-api/.
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const PORT = process.env.PORT || 8090;
const GONIC_URL = process.env.GONIC_URL;
const GONIC_USERNAME = process.env.GONIC_USERNAME;
const GONIC_PASSWORD = process.env.GONIC_PASSWORD;

// Selectable providers, as JSON in LLM_PROVIDERS. kind "anthropic" uses the
// SDK (key from ANTHROPIC_API_KEY); kind "openai" is any OpenAI-compatible
// /chat/completions endpoint (OpenAI, Groq, Together, OpenRouter, Ollama, vLLM).
// The first entry is the default when a request names no provider.
const DEFAULT_PROVIDERS = [
  { id: "claude", label: "Claude Sonnet", kind: "anthropic", model: "claude-sonnet-4-5" },
];

let PROVIDERS;
try {
  PROVIDERS = process.env.LLM_PROVIDERS ? JSON.parse(process.env.LLM_PROVIDERS) : DEFAULT_PROVIDERS;
} catch (err) {
  console.error(`[ERROR] LLM_PROVIDERS is not valid JSON: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(PROVIDERS) || PROVIDERS.length === 0) {
  console.error("[ERROR] LLM_PROVIDERS must be a non-empty JSON array");
  process.exit(1);
}
for (const p of PROVIDERS) {
  if (!p.id || !p.model || !["anthropic", "openai"].includes(p.kind)) {
    console.error(`[ERROR] provider ${JSON.stringify(p)} needs id, model and kind ("anthropic" or "openai")`);
    process.exit(1);
  }
  const key = p.kind === "anthropic" ? "ANTHROPIC_API_KEY" : p.apiKeyEnv || "OPENAI_API_KEY";
  if (!process.env[key]) {
    console.error(`[ERROR] provider "${p.id}" needs ${key} to be set`);
    process.exit(1);
  }
}

if (!GONIC_URL || !GONIC_USERNAME || !GONIC_PASSWORD) {
  console.error("[ERROR] GONIC_URL, GONIC_USERNAME, GONIC_PASSWORD must be set");
  process.exit(1);
}

const anthropic = PROVIDERS.some((p) => p.kind === "anthropic") ? new Anthropic() : null;

async function subsonic(endpoint, params = {}) {
  const salt = randomBytes(6).toString("hex");
  const token = createHash("md5").update(GONIC_PASSWORD + salt).digest("hex");
  const query = new URLSearchParams({
    u: GONIC_USERNAME,
    t: token,
    s: salt,
    v: "1.16.1",
    c: "chat-server",
    f: "json",
    ...params,
  });
  const res = await fetch(`${GONIC_URL}/rest/${endpoint}.view?${query}`);
  const body = await res.json();
  const r = body["subsonic-response"];
  if (r.status !== "ok") {
    throw new Error(r.error?.message || `Subsonic error (code ${r.error?.code})`);
  }
  return r;
}

// ── Discogs album ratings ───────────────────────────────────────────────
// Discogs rates releases (specific pressings), never albums, so an album's
// rating is the vote-weighted mean over the most-collected releases of its
// master. Fetched only on request and stored in RATINGS_FILE (a PVC), so each
// album costs Discogs calls once. Shared by GET/POST /ratings and the
// discogs_rating tool; the MCP server and the Tools page both go through here.
const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN;
const RATINGS_FILE = `${process.env.DATA_DIR || "/data"}/ratings.json`;
const TOP_RELEASES = 5; // ~7 Discogs calls per album; the limit is 60/min

let ratings = {};
try {
  ratings = JSON.parse(readFileSync(RATINGS_FILE, "utf8"));
} catch (err) {
  // Refuse to start on a corrupt file rather than overwrite it on the next save.
  if (err.code !== "ENOENT") {
    console.error(`[ERROR] cannot read ${RATINGS_FILE}: ${err.message}`);
    process.exit(1);
  }
}

// Mirrored in src/api/chat.js (ratingKey) — keep the two identical.
const ratingKey = (artist, album) =>
  [artist, album]
    .map((s) => String(s).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""))
    .join("|");

async function discogs(path, params = {}) {
  const res = await fetch(`https://api.discogs.com${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Discogs token=${DISCOGS_TOKEN}`, "User-Agent": "attic-music/1.0" },
  });
  if (res.status === 429) throw new Error("Discogs rate limit hit (60 requests/min) — wait a minute and retry");
  if (!res.ok) throw new Error(`Discogs ${path}: HTTP ${res.status}`);
  return res.json();
}

async function fetchDiscogsRating(artist, album) {
  const q = { artist, release_title: album, per_page: 10 };
  // The first hit can be a same-titled single (U2's "The Unforgettable Fire");
  // the most-owned hit is the album.
  const mostOwned = ({ results = [] }) =>
    results.sort((a, b) => (b.community?.have ?? 0) - (a.community?.have ?? 0))[0];
  let hit = mostOwned(await discogs("/database/search", { ...q, type: "master" }));
  const isMaster = !!hit;
  // Plenty of releases have no master — rate the single release instead.
  if (!hit) hit = mostOwned(await discogs("/database/search", { ...q, type: "release" }));
  if (!hit) return { rating: null, votes: 0, releases: [] };

  let picked = [hit];
  if (isMaster) {
    const { versions = [] } = await discogs(`/masters/${hit.id}/versions`, { per_page: 100 });
    const collected = (v) => v.stats?.community?.in_collection ?? 0;
    picked = versions.sort((a, b) => collected(b) - collected(a)).slice(0, TOP_RELEASES);
  }

  const releases = [];
  for (const v of picked) {
    const r = (await discogs(`/releases/${v.id}/rating`)).rating;
    if (!r?.count) continue;
    releases.push({
      id: v.id,
      format: [].concat(v.format ?? v.major_formats ?? []).join(", "),
      year: v.released || v.year || "",
      country: v.country || "",
      avg: r.average,
      votes: r.count,
    });
  }

  const votes = releases.reduce((n, r) => n + r.votes, 0);
  const rating = votes ? Math.round((releases.reduce((n, r) => n + r.avg * r.votes, 0) / votes) * 100) / 100 : null;
  return {
    rating,
    votes,
    releases,
    matched: hit.title,
    url: `https://www.discogs.com/${isMaster ? "master" : "release"}/${hit.id}`,
  };
}

// Returns the stored rating, fetching (and storing) only if missing or forced.
// A null rating is stored too: "Discogs has no votes" is also fetched once.
async function getRating(artist, album, force = false) {
  const key = ratingKey(artist, album);
  if (!force && ratings[key]) return ratings[key];
  if (!DISCOGS_TOKEN) throw new Error("DISCOGS_TOKEN is not set");
  const r = { artist, album, ...(await fetchDiscogsRating(artist, album)), fetchedAt: new Date().toISOString() };
  ratings[key] = r;
  writeFileSync(`${RATINGS_FILE}.tmp`, JSON.stringify(ratings));
  renameSync(`${RATINGS_FILE}.tmp`, RATINGS_FILE);
  return r;
}

const TOOLS = [
  {
    name: "search_music",
    description: "Search the music library's artists, albums and songs by free-text query.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Free-text search, e.g. an artist and/or song title" } },
      required: ["query"],
    },
  },
  {
    name: "show_songs",
    description:
      "Show a specific set of songs to the user. Call this once, after searching, passing only the ids of songs " +
      "that actually answer the request — search returns loose matches by other artists, and those must be left " +
      "out. The app displays exactly the songs you list here and nothing else.",
    input_schema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Song ids taken from search results, in the order they should be displayed",
        },
      },
      required: ["ids"],
    },
  },
  ...(DISCOGS_TOKEN
    ? [
        {
          name: "discogs_rating",
          description:
            "Get an album's Discogs community rating (average out of 5, vote count). Only call this when the user " +
            "asks about ratings or reviews. Returns the stored value if this album was fetched before.",
          input_schema: {
            type: "object",
            properties: {
              artist: { type: "string", description: "Album artist" },
              album: { type: "string", description: "Album title" },
            },
            required: ["artist", "album"],
          },
        },
      ]
    : []),
];

const SYSTEM_PROMPT =
  "You are a music library search assistant. Use the search_music tool to find what the user is asking " +
  "about (songs, albums, artists) — call it as many times as needed to cover the request. Search matches " +
  "loosely, so results routinely include songs by other artists that do not answer the request. When you " +
  "have searched enough, call show_songs with the ids of only the songs that genuinely answer it; the app " +
  "displays exactly that list. Then reply with a brief, one or two sentence summary. Do not list every " +
  "track in your reply, and make sure any count you state matches the number of ids you passed to show_songs. " +
  "Write plain prose — no markdown, no bold, no bullet points.";

// One extra turn over the old 4: searching, then show_songs, then the summary.
const MAX_TURNS = 5;

// Anthropic's block format is the internal shape; OpenAI-compatible endpoints
// are translated on the way in and out so runChat stays provider-agnostic.
async function callModel(messages, provider) {
  if (provider.kind === "anthropic") {
    return anthropic.messages.create({
      model: provider.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });
  }

  const oaMessages = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      oaMessages.push({ role: m.role, content: m.content });
    } else if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const toolCalls = m.content
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } }));
      oaMessages.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // a user turn carrying tool_result blocks becomes one "tool" message each
      for (const b of m.content) {
        oaMessages.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
      }
    }
  }

  const baseUrl = provider.baseUrl || "https://api.openai.com/v1";
  const apiKey = process.env[provider.apiKeyEnv || "OPENAI_API_KEY"];
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: provider.model,
      // ponytail: max_tokens, not max_completion_tokens — the older name is the
      // one every OpenAI-compatible clone accepts. Switch if you only target OpenAI.
      max_tokens: 1024,
      messages: oaMessages,
      tools: TOOLS.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
    }),
  });
  if (!res.ok) throw new Error(`LLM API ${res.status}: ${await res.text()}`);

  const msg = (await res.json()).choices[0].message;
  const content = [];
  if (msg.content) content.push({ type: "text", text: msg.content });
  for (const c of msg.tool_calls ?? []) {
    content.push({ type: "tool_use", id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments) });
  }
  return { content };
}

async function runChat(message, provider) {
  const messages = [{ role: "user", content: message }];
  const found = { songs: new Map(), albums: new Map(), artists: new Map() };
  // ids the model picked via show_songs; null means it never called it
  let shown = null;

  // Search results are loose matches — show what the model selected, and only
  // fall back to everything found if it never made a selection.
  const result = (reply) => ({
    reply,
    songs: shown ? shown.map((id) => found.songs.get(id)).filter(Boolean) : [...found.songs.values()],
    albums: [...found.albums.values()],
    artists: [...found.artists.values()],
  });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await callModel(messages, provider);

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      return result(response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"));
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const use of toolUses) {
      if (use.name === "show_songs") {
        shown = [].concat(use.input?.ids ?? []).map(String);
        const kept = shown.filter((id) => found.songs.has(id)).length;
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: `Showing ${kept} song(s).${kept < shown.length ? " Some ids were not in the search results and were dropped." : ""}`,
        });
        continue;
      }
      if (use.name === "discogs_rating") {
        try {
          const r = await getRating(use.input.artist, use.input.album);
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(r) });
        } catch (err) {
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: err.message, is_error: true });
        }
        continue;
      }
      try {
        const r = (await subsonic("search3", { query: use.input.query })).searchResult3 || {};
        for (const s of [].concat(r.song ?? [])) found.songs.set(s.id, s);
        for (const a of [].concat(r.album ?? [])) found.albums.set(a.id, a);
        for (const a of [].concat(r.artist ?? [])) found.artists.set(a.id, a);
        toolResults.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(r) });
      } catch (err) {
        toolResults.push({ type: "tool_result", tool_use_id: use.id, content: err.message, is_error: true });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  // ponytail: MAX_TURNS hit — return whatever we found rather than error out.
  return result("Found some results, but stopped after a few search rounds.");
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/providers") {
    const list = PROVIDERS.map((p) => ({ id: p.id, label: p.label || p.id }));
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(list));
    return;
  }

  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/ratings") {
    const json = (code, body) => res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    if (req.method === "GET") return json(200, ratings);
    if (req.method === "POST") {
      const artist = url.searchParams.get("artist");
      const album = url.searchParams.get("album");
      if (!artist || !album) return json(400, { error: "artist and album are required" });
      getRating(artist, album, url.searchParams.get("force") === "1").then(
        (r) => json(200, r),
        (err) => {
          console.error(err);
          // Not 5xx: Cloudflare replaces 502 bodies with its own page, hiding err.message.
          json(424, { error: err.message });
        },
      );
      return;
    }
  }

  if (req.method !== "POST" || req.url !== "/chat") {
    res.writeHead(404).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const { message, provider: providerId } = JSON.parse(body);
      if (!message || typeof message !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "message is required" }));
        return;
      }
      const provider = providerId ? PROVIDERS.find((p) => p.id === providerId) : PROVIDERS[0];
      if (!provider) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: `unknown provider "${providerId}"` }));
        return;
      }
      const result = await runChat(message, provider);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
    }
  });
});

server.listen(PORT, () => console.log(`chat-server listening on :${PORT}`));
