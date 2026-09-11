# Meridian

Online Catan implementation (original name/art): full base-game rules —
snake-draft setup, dice production, robber/discards, building, trades, dev
cards — on a painted-miniature 3D board. Hyper-stylized R3F client, one
Cloudflare Durable Object per match as the authoritative server, pure rules
engine with per-seat redaction so clients only ever see what their player may
know.

Docs: `docs/BRIEF.md` (pillars) · `docs/superpowers/specs/` (designs) ·
`docs/PLAN.md` (roadmap).

## Monorepo

- `packages/rules` — pure TypeScript rules engine (no three/react/workers):
  hex math, zod-validated declarative rulesets, `applyIntent` reducer, win
  detection, native bots. The placeholder hex-tactics ruleset lives in
  `src/rulesets/placeholder.json`.
- `packages/protocol` — zod schemas for client↔server messages: the Catan
  intents, the action-log events, and the transport envelope
  (`hello`/`welcome`/`lobby`/`snapshot`/`error`/`ended`).
- `packages/match-core` — game-agnostic match object for Cloudflare Durable
  Objects: seats and reconnect tokens, hibernating WebSockets, the intent
  loop with SQLite-persisted state, one alarm driving pilots, bots, trade
  windows, abandonment and expiry, and the result webhook. Parameterised by
  a `GameAdapter`, so another game is another adapter.
- `apps/worker` — Meridian's Worker: the Catan adapter (rules + caretaker
  pilot + event derivation) bound to `match-core`, `POST /matches` for
  launchers (bearer token), `POST /matches/open` for the browser's Create
  button, lobby lookup, and the per-match WebSocket route. 4-letter join
  codes, engine-validated intents, per-seat redacted snapshots (secrets never
  leave the object), reconnect-reclaim until game end.
- `apps/client` — Vite + React Three Fiber client: Catan lobby (pick player
  count, share the join code, the host sets the table and starts), painted-miniature 3D board,
  click-to-build with legality glow, HUD/discard/steal/win UI. E2E
  (3-browser full match + perf snapshot): `pnpm --filter client test:e2e`
  (requires `playwright install chromium`, and its two ports free — the
  suite starts its own servers rather than reusing whatever is listening;
  either run it on spare ports (see Ports below) or stop your dev servers
  first: `lsof -ti:5173,8787 | xargs kill -9`).

## Development

Requirements: Node 20+, pnpm 10.

    pnpm install
    pnpm test                  # all package tests (the worker's run inside the Workers runtime)
    pnpm --filter worker dev   # http://localhost:8787 (wrangler dev)
    pnpm --filter client dev   # http://localhost:5173

Copy `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` first: it sets
the launch token and `TEST_KNOBS=1`, which lets `?seed=` / `?vp=` / `?bots=`
on the client shape a match for tests.

To play: open http://localhost:5173, pick a player count and Create — share
the 4-letter code; friends Join with it in their own browsers. The match
starts when every seat fills, or when the host presses Start now: bots take
every empty seat and play a competent greedy game (works for solo play too;
no script needed). The host can change the player count and bots from the
waiting room while people arrive. Dev extras: `/board` renders a full board
without a server; `/dice` cycles the HUD dice through every face; `?tier=low`
drops the ambient-occlusion pass on weak GPUs.

The match object owns all game state: clients send intents, receive per-seat
redacted snapshots. A dropped socket reconnects with its stored token; a
deploy keeps every match's state.

### Deploy

Worker on Cloudflare (`wrangler deploy` from `apps/worker`), client on
Vercel: `docs/DEPLOY.md` (runbook, env, smoke test, rollback). `GET /healthz`
reports the deployed version.

### Ports

Defaults are 8787 (worker) and 5173 (client). Both are overridable so a
second checkout, an agent's E2E run, and your own playtest can share one
machine without fighting over ports:

| env var       | applies to                      | default |
| ------------- | ------------------------------- | ------- |
| `PORT`        | wrangler dev listen port; the dev client also dials `http://localhost:$PORT` when set | 8787 |
| `CLIENT_PORT` | Vite dev-server port (strict when set: a busy port fails, never drifts) | 5173 |
| `VITE_SERVER_URL` | explicit client→worker origin; wins over the `PORT`-derived one | `http://localhost:8787` |

    pnpm --filter worker dev -- --port 8788                  # worker on a spare port
    PORT=8788 CLIENT_PORT=5174 pnpm --filter client dev       # client on 5174, dialing 8788
    PORT=8788 CLIENT_PORT=5174 pnpm --filter client test:e2e  # E2E on spare ports

The E2E config threads both values into the servers it spawns (and sets the
worker's `CLIENT_ORIGIN` to match), so one command line moves the whole run.

## Notes

- The root `test` script runs `turbo run test --concurrency=1`. This is
  required, not a leftover: the worker's tests boot the Workers runtime and
  the client's touch real timers; running packages in parallel under turbo
  starves them and makes the runs flaky.
- `apps/worker` runs vitest 4 with `@cloudflare/vitest-pool-workers`; the
  other packages are on vitest 2. Both versions install side by side; keep
  `wrangler` in `apps/worker` at the version the pool pins.
