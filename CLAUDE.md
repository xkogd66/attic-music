do not assume anything. don't brute force running commands. ask questions.

never run the build (npm run build, npm run dev, npm run preview, etc.) to test or verify changes. the user will test it themselves.

never run kubectl commands.

## mcp-server/

`mcp-server/` is a separate Node MCP server (merged in 2026-08-18 from a
standalone project at `~/Repos/mcp/gonic-mcp`) that lets Claude Code talk to
this app's gonic backend directly. It is NOT part of the Vite app — own
`package.json`, not touched by `npm run build`/`dev`/`preview`, not in the
Docker/k8s deploy path described below. See `mcp-server/README.md`. Its
`gonic.env` credentials file is gitignored — never commit it.

## chat-server/

`chat-server/` is the **Ask AI backend** — a separate Node HTTP service, not
the MCP server and not part of the Vite app (own `package.json`, own image
`ghcr.io/xkogd66/chat-server:latest`, own manifest `k8s/chat-server.yaml`).
It is NOT built or deployed by `.github/workflows/deploy.yaml` — that workflow
only handles the Vite app, so pushing to `main` does not update it.

It runs an LLM tool-calling loop over one tool (Subsonic `search3` against
gonic) and serves `POST /chat` + `GET /providers`, proxied by nginx at
`/chat-api/`. Providers are selectable per request by the user; the list is
`LLM_PROVIDERS`, a JSON array in the deployment env, and the server refuses to
start if a listed provider's key env var is missing. Two provider kinds:
`anthropic` (SDK) and `openai` (any OpenAI-compatible endpoint). Full details
in the root [README.md](README.md#chat-server).

`k8s/chat-server-secret.example.yaml` is a template — the filled-in
`chat-server-secret.yaml` holds live API keys and must never be committed.
**This is a public repo.**

## how this app is served

- push to `main` triggers `.github/workflows/deploy.yaml`: builds the Vite app into an
  nginx image, pushes `ghcr.io/xkogd66/attic-music:latest`, and `kubectl rollout restart
  deployment/attic-music -n webapps`.
- public URL is `https://music.ekskog.me`. DNS is Cloudflare; a **Cloudflare tunnel**
  (cloudflared pod in the cluster) terminates the traffic and routes it to a service in
  the cluster. There is no public ingress/LoadBalancer.
- the tunnel is **remotely managed** — its hostname→service routing lives in the
  Cloudflare Zero Trust dashboard (Networks → Tunnels → Public Hostnames), NOT in any
  in-cluster configmap. Do not look for the routing in the repo or the cluster.
- so "I deployed but still see old code" is a routing/rollout question, not a browser
  cache one: check that the dashboard routes `music.ekskog.me` to the same
  service/deployment CI restarts (`attic-music` in `webapps`), and that that deployment's
  pods actually pulled the new image.