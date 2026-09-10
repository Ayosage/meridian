# Deploying Meridian

Two deployables: the Colyseus **server** (WebSockets + `POST /matches`) on
Fly, and the static Vite **client** on Vercel. Both are free-tier. Nothing
here costs money; if Fly or Vercel asks for a paid plan, stop and ask.

Status 2026-09-10: **client LIVE** at https://meridian-client-fawn.vercel.app
(Vercel project `meridian-client`, team ayo-b-dev, root directory `apps/client`,
GitHub repo connected so pushes to `main` redeploy; `VITE_SERVER_URL` set for
Production and Preview). **Server not yet deployed**: needs `fly auth login`
(interactive) and the steps in section 1. Until then the lobby renders but
Create/Join cannot connect.

## 1. Server on Fly

Prereqs: `flyctl` (`brew install flyctl`), Docker not required (Fly builds
remotely). One-time:

```bash
fly auth login                         # opens the browser
fly apps create meridian-server        # name is in apps/server/fly.toml
fly secrets set -a meridian-server \
  LAUNCH_TOKEN="$(openssl rand -hex 32)" \
  CLIENT_ORIGIN="https://meridian-client-fawn.vercel.app"
```

Keep the generated `LAUNCH_TOKEN`: steward needs the same value as
`MERIDIAN_LAUNCH_TOKEN`. Rotate it with another `fly secrets set`.

Every deploy, from the repo root:

```bash
fly deploy -c apps/server/fly.toml --build-arg GIT_SHA=$(git rev-parse HEAD)
```

Verify:

```bash
curl -s https://meridian-server.fly.dev/healthz
# {"ok":true,"version":"<sha>","region":"ewr","uptime":12}
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://meridian-server.fly.dev/matches \
  -H 'Content-Type: application/json' -d '{"players":4}'     # 401 without the token
curl -s -X POST https://meridian-server.fly.dev/matches \
  -H "Authorization: Bearer $LAUNCH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"players":4,"bots":3}'                                # 201 + joinUrl
```

What `fly.toml` pins: one machine always running (`auto_stop_machines =
false`, live matches must not be reaped), TLS on 443 with HTTP→HTTPS, a TCP
check and an HTTP check on `/healthz`, 512 MB shared-cpu-1x.

Known limit: room state lives in memory. A deploy or crash mid-match loses
every room (BACKLOG "Server-side room-state persistence"). Deploy between
game nights.

## 2. Client on Vercel

Done 2026-09-10 from the CLI (project `meridian-client`, root directory
`apps/client`, framework Vite, GitHub repo connected). `apps/client/vercel.json`
supplies the install/build commands (they run `pnpm` from the repo root so
workspace packages resolve) and the headers. The public URL is
https://meridian-client-fawn.vercel.app (`meridian-client.vercel.app` belongs
to someone else). Manual redeploy: `vercel deploy --prod --scope ayo-b-dev`
from the repo root (the checkout is linked; `.vercel/` is gitignored).

Environment variables (Production and Preview):

| Variable          | Value                              |
| ----------------- | ---------------------------------- |
| `VITE_SERVER_URL` | `wss://meridian-server.fly.dev`    |

Vite inlines it at build time, so changing it means a redeploy.

The server's `CLIENT_ORIGIN` secret must be `https://meridian-client-fawn.vercel.app`
so `POST /matches` returns join links on the right host.

## 3. Smoke test after both are up

1. Open the client URL in two browsers, Create a 3-player game with 1 bot in
   one, Join with the code in the other. Play to the first roll.
2. `POST /matches` with the token, open the `joinUrl`; the lobby should open
   with the code prefilled.
3. `fly logs -a meridian-server` shows the room create/dispose lines.

## 4. Wiring steward

In steward's environment: `MERIDIAN_API_URL=https://meridian-server.fly.dev`
and `MERIDIAN_LAUNCH_TOKEN=<the token>`. Contract: `docs/DISCORD-LAUNCH.md`.

## 5. Rollback

```bash
fly releases -a meridian-server
fly deploy -a meridian-server --image <previous image ref>
```

Vercel: Deployments → previous → Promote to Production.

## CI

`.github/workflows/ci.yml` runs tests, typecheck and the client build on
every PR, and builds the server image, boots it, and probes `/healthz` and
`POST /matches` (expects 401).
