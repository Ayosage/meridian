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
- `apps/client` — Vite + React Three Fiber (stub; rendering lands next plan).

## Development

Requirements: Node 20+, pnpm 10.

    pnpm install
    pnpm test                  # all package tests
    pnpm --filter server dev   # ws://localhost:2567
    pnpm --filter client dev   # http://localhost:5173

The server owns all game state: clients send intents, receive state diffs.
