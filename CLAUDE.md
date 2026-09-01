do not assume anything. don't brute force running commands. ask questions.

never compile or build anything to test or verify changes — not npm run build/dev/preview, not `go build`/`go vet`, not `docker build`, not any other compiler/linter invocation, including via a container (e.g. the artist-images `docker run golang:... go build` command documented below is for the user to run, not Claude). This applies to every language and every part of this repo. The user will build and test it themselves.

kubectl commands are allowed against the homelab cluster (kubeconfig at
`~/.kube/config-homelab` — set `KUBECONFIG=~/.kube/config-homelab` or pass
`--kubeconfig`). Read-only commands (get, describe, logs, top) can run freely.
State-changing ones (delete, cordon/drain, rollout restart, apply, scale)
still need the user's go-ahead first, same as any other destructive/shared-
state action — this permission is about being able to investigate and act
inside the cluster, not a blanket license to skip confirmation on anything
destructive.

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
`.github/workflows/deploy.yaml` has a `build-chat-server` job that builds and
pushes the image, then `kubectl apply -f k8s/chat-server.yaml` + rollout —
**but only when the push changed a file under `chat-server/`** (it tests
`git diff --name-only HEAD~1 HEAD | grep '^chat-server/'`). A commit touching
only `k8s/chat-server.yaml` — e.g. editing `LLM_PROVIDERS` — changes nothing
in `chat-server/`, so the whole job is skipped and the config is never
applied. Apply it by hand in that case.

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

## artist-images/

`artist-images/` is a single-file Go sidecar (cover art + ID3 tag editing on the
NFS share; see `docs/ARCHITECTURE.md`). It is built by the `build-artist-images`
job in `.github/workflows/deploy.yaml` (context `artist-images`) into
`ghcr.io/xkogd66/artist-images:latest`, deployed via `k8s/artist-images.yaml`.

- **Dependencies are pinned** in committed `artist-images/go.mod` + `go.sum`;
  the Dockerfile builds with `golang:1.22-bookworm` (Go 1.22.12,
  `GOTOOLCHAIN=local`). It used to run `go mod init && go mod tidy` inside the
  image, which floated to latest releases and broke on 2026-08-24 when
  `golang.org/x/image` v0.45.0 declared `go 1.25.0` — see commit(s) fixing that.
- **Keep `golang.org/x/image` ≤ v0.24.0 unless you also bump the builder's Go:**
  v0.25.0+ requires go ≥ 1.23, v0.45.0 requires go ≥ 1.25. v0.24.0 (go 1.18) is
  the newest release compatible with the Go 1.22 image. `id3v2/v2` v2.1.4 is fine
  (go 1.13).
- **Regenerating `go.mod`/`go.sum` after changing imports:** no local Go is
  installed, so use the same container image:
  `docker run --rm -v $PWD/artist-images:/app -w /app golang:1.22-bookworm sh -c "go mod tidy && go build -o /tmp/artist-images ."`
  (`go mod tidy` keeps explicitly-pinned direct requires; it will not silently
  bump `x/image` back to an incompatible latest).
- **Moving to a newer Go:** bump the `FROM golang:...` line in the Dockerfile
  **and** the `go` directive in `go.mod` together, then run the tidy command
  above.

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