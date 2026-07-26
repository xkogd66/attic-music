do not assume anything. don't brute force running commands. ask questions.

never run the build (npm run build, npm run dev, npm run preview, etc.) to test or verify changes. the user will test it themselves.

never run kubectl commands.

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