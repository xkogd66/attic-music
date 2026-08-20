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

// Selectable providers, as JSON in LLM_PROVIDERS. kind "anthropic" uses the
// SDK (key from ANTHROPIC_API_KEY); kind "openai" is any OpenAI-compatible
// /chat/completions endpoint (OpenAI, Groq, Together, OpenRouter, Ollama, vLLM).
// The first entry is the default when a request names no provider.
const DEFAULT_PROVIDERS = [
  { id: "claude", label: "Claude Haiku", kind: "anthropic", model: "claude-haiku-4-5" },
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
