# Meridian

Online Catan implementation (original name/art): full base-game rules —
snake-draft setup, dice production, robber/discards, building, trades, dev
cards — on a painted-miniature 3D board. Hyper-stylized R3F client,
authoritative Colyseus server, pure rules engine with per-seat redaction so
clients only ever see what their player may know.

Docs: `docs/BRIEF.md` (pillars) · `docs/superpowers/specs/` (designs) ·
`docs/PLAN.md` (roadmap).

## Monorepo

- `packages/rules` — pure TypeScript rules engine (no colyseus/three/react):
  hex math, zod-validated declarative rulesets, `applyIntent` reducer, win
  detection. The placeholder hex-tactics ruleset lives in
  `src/rulesets/placeholder.json`.
- `packages/protocol` — zod schemas for client↔server messages.
- `apps/server` — Colyseus authoritative server: 4-letter join codes,
  engine-validated intents, per-seat redacted snapshots (secrets never leave
  the server), caretaker pilot for absent seats, reconnect-reclaim until game
  end.
- `apps/client` — Vite + React Three Fiber client: Catan lobby (pick player
  count, share the join code, host early start), painted-miniature 3D board,
  click-to-build with legality glow, HUD/discard/steal/win UI. E2E
  (3-browser full match + perf snapshot): `pnpm --filter client test:e2e`
  (requires `playwright install chromium`, and its two ports free — the
  suite starts its own servers rather than reusing whatever is listening;
  either run it on spare ports (see Ports below) or stop your dev servers
  first: `lsof -ti:5173,2567 | xargs kill -9`).

## Development

Requirements: Node 20+, pnpm 10.

    pnpm install
    pnpm test                  # all package tests
    pnpm --filter server dev   # ws://localhost:2567
    pnpm --filter client dev   # http://localhost:5173

To play: open http://localhost:5173, pick a player count and Create — share
the 4-letter code; friends Join with it in their own browsers. The match
starts when every seat fills (or the host starts early; empty seats get the
caretaker pilot). Short on friends? Pick a bot count in the lobby — native
server-side bots fill the empty seats and play a competent greedy game (works
for solo play too; no script needed). Dev extras: `/board`
renders a full board without a server; `/dice` cycles the HUD dice through
every face; `?tier=low` drops the ambient-occlusion pass on weak GPUs.

The server owns all game state: clients send intents, receive per-seat
redacted snapshots.

### Deploy

Server on Fly, client on Vercel: `docs/DEPLOY.md` (runbook, env, smoke
test, rollback). `GET /healthz` reports the deployed version.

### Ports

Defaults are 2567 (server) and 5173 (client). Both are overridable so a
second checkout, an agent's E2E run, and your own playtest can share one
machine without fighting over ports:

| env var       | applies to                      | default |
| ------------- | ------------------------------- | ------- |
| `PORT`        | server listen port; the dev client also dials `ws://localhost:$PORT` when set | 2567 |
| `CLIENT_PORT` | Vite dev-server port (strict when set: a busy port fails, never drifts) | 5173 |
| `VITE_SERVER_URL` | explicit client→server URL; wins over the `PORT`-derived one | `ws://localhost:2567` |

    PORT=2568 pnpm --filter server dev                 # server on a spare port
    PORT=2568 CLIENT_PORT=5174 pnpm --filter client dev  # client on 5174, dialing 2568
    PORT=2568 CLIENT_PORT=5174 pnpm --filter client test:e2e   # E2E on spare ports

The E2E config threads both values into the servers it spawns (and sets the
server's `CLIENT_ORIGIN` to match), so one command line moves the whole run.

## Notes

Two things here look like cleanup opportunities but aren't — please don't
"fix" them without re-checking first:

- The root `pnpm.overrides` pins `@colyseus/core` to `0.16.24`. `0.16.25`'s
  published tarball ships an unresolvable `@colyseus/greeting-banner:
  workspace:^` dependency, which breaks install. Revisit the pin once
  `>= 0.16.26` is out and confirmed clean.
- The root `test` script runs `turbo run test --concurrency=1`. This is
  required, not a leftover: `apps/server`'s reconnection tests use real
  grace-window timers, and running packages in parallel under turbo starves
  those timers and makes the tests flaky.
