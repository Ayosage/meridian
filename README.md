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
  (requires `playwright install chromium`).

## Development

Requirements: Node 20+, pnpm 10.

    pnpm install
    pnpm test                  # all package tests
    pnpm --filter server dev   # ws://localhost:2567
    pnpm --filter client dev   # http://localhost:5173

To play: open http://localhost:5173, pick a player count and Create — share
the 4-letter code; friends Join with it in their own browsers. The match
starts when every seat fills (or the host starts early; empty seats get the
caretaker pilot). Short on friends? Companion bots can take the empty seats:
`cd apps/client && node tools/bots.mjs <CODE> [count]` (default 2 bots; they
play a competent greedy game through the real UI). Solo play: pick a bot
count in the lobby (native bots; no script needed). Dev extras: `/board`
renders a full board without a server; `?tier=low` drops the
ambient-occlusion pass on weak GPUs.

The server owns all game state: clients send intents, receive per-seat
redacted snapshots.

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
