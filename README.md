# Meridian

Original online board game. Hyper-stylized R3F client, authoritative
Colyseus server, and a data-driven rules engine — rules are content, not
code, so new games and expansions are JSON drops.

Docs: `docs/BRIEF.md` (pillars) · `docs/superpowers/specs/` (designs) ·
`docs/PLAN.md` (roadmap).

## Monorepo

- `packages/rules` — pure TypeScript rules engine (no colyseus/three/react):
  hex math, zod-validated declarative rulesets, `applyIntent` reducer, win
  detection. The placeholder hex-tactics ruleset lives in
  `src/rulesets/placeholder.json`.
- `packages/protocol` — zod schemas for client↔server messages.
- `apps/server` — Colyseus authoritative server: 4-letter join codes,
  engine-validated intents, schema diff sync, reconnection with forfeit.
- `apps/client` — Vite + React Three Fiber client: lobby with join codes,
  instanced shader-styled hex board, click-to-move vs the authoritative
  server. Two-browser E2E: `pnpm --filter client test:e2e` (requires
  `playwright install chromium`).

## Development

Requirements: Node 20+, pnpm 10.

    pnpm install
    pnpm test                  # all package tests
    pnpm --filter server dev   # ws://localhost:2567
    pnpm --filter client dev   # http://localhost:5173

The server owns all game state: clients send intents, receive state diffs.

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
