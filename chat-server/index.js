#!/usr/bin/env node
// HTTP backend for natural-language music search: Claude interprets the
// query, calls search_music (Subsonic search3 against gonic), we return the
// raw results plus Claude's short reply. Proxied by nginx at /chat-api/.
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

const PORT = process.env.PORT || 8090;
const GONIC_URL = process.env.GONIC_URL;
const GONIC_USERNAME = process.env.GONIC_USERNAME;
const GONIC_PASSWORD = process.env.GONIC_PASSWORD;

if (!GONIC_URL || !GONIC_USERNAME || !GONIC_PASSWORD || !process.env.ANTHROPIC_API_KEY) {
  console.error("[ERROR] GONIC_URL, GONIC_USERNAME, GONIC_PASSWORD, ANTHROPIC_API_KEY must be set");
  process.exit(1);
}

const anthropic = new Anthropic();

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
];

const SYSTEM_PROMPT =
  "You are a music library search assistant. Use the search_music tool to find what the user is asking " +
  "about (songs, albums, artists) — call it as many times as needed to cover the request. Reply with a " +
  "brief, one or two sentence summary of what you found; do not list every track, the app renders those separately.";

const MAX_TURNS = 4;

async function runChat(message) {
  const messages = [{ role: "user", content: message }];
  const found = { songs: new Map(), albums: new Map(), artists: new Map() };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      const reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      return {
        reply,
        songs: [...found.songs.values()],
        albums: [...found.albums.values()],
        artists: [...found.artists.values()],
      };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const use of toolUses) {
      try {
        const result = await subsonic("search3", { query: use.input.query });
        const r = result.searchResult3 || {};
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
  return {
    reply: "Found some results, but stopped after a few search rounds.",
    songs: [...found.songs.values()],
    albums: [...found.albums.values()],
    artists: [...found.artists.values()],
  };
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/chat") {
    res.writeHead(404).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const { message } = JSON.parse(body);
      if (!message || typeof message !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "message is required" }));
        return;
      }
      const result = await runChat(message);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message }));
    }
  });
});

server.listen(PORT, () => console.log(`chat-server listening on :${PORT}`));
