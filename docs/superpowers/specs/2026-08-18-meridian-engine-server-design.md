# Meridian — Engine + Server Design (Plan 1 scope)

**Date:** 2026-08-18
**Status:** Approved design, pre-implementation
**Supersedes:** the brief's open "Node + ws (or Colyseus)" decision — **Colyseus** is chosen.
**Parent docs:** `docs/BRIEF.md` (pillars locked), `docs/PLAN.md` (task list; this spec covers tasks 1–9, the headless engine + server half).

## 1. Scope

Everything needed for two clients to complete an authoritative full match of the
placeholder hex-tactics ruleset over the network — with no rendering. The R3F
client (tasks 10–13) is plan 2; by then the real game design cycle may have
replaced the placeholder ruleset, which is a content swap, not a code change.

Out of scope here: all rendering/shaders, matchmaking/accounts, sound, AI
(brief non-goals), and the real game design.

## 2. Monorepo

Turborepo + pnpm. Vitest in every package. TypeScript strict everywhere.

- `apps/server` — Node + Colyseus authoritative server.
- `apps/client` — scaffolded Vite + R3F TypeScript app, **stub only this plan**
  (placeholder page); exists so the workspace shape is final from day one.
- `packages/rules` — pure rules engine. **Never imports colyseus, three, or
  react.** Runs headless on server and in unit tests.
- `packages/protocol` — zod schemas + TS types shared by client and server.

## 3. `packages/rules` — pure engine (pillar 4)

- Plain immutable data: `GameState`, `PlayerId`, hex `Coord` (axial) with
  neighbor/distance helpers. Property tests on hex math.
- Declarative ruleset format: piece definitions (movement pattern, capture
  rule), board layout, zod-validated loader. The placeholder ruleset
  (simplified hex tactics: move + capture + last-player-standing) ships as
  JSON and exercises every engine interface.
- `applyIntent(state, intent) → state | RuleError` — pure reducer for
  move / capture / end-turn. Exhaustive unit tests including illegal intents
  (wrong turn, invalid move pattern, occupied destination, nonexistent piece).
- Win detection (last player standing) + turn rotation.

## 4. `apps/server` — Colyseus owns transport, rooms, sync; nothing else

- `MatchRoom` holds the authoritative **plain** `GameState`. Every client
  intent is validated through `applyIntent`; on success the result is mirrored
  into a `@colyseus/schema` state tree so clients receive Colyseus's native
  diff sync (satisfies the brief's "clients send intents, receive state
  diffs" — no hand-rolled diffing). On `RuleError`, the error is sent to the
  offending client on a message channel and state is untouched.
- **Mirror:** one mechanical `syncFromGameState(schema, state)` function,
  unit-tested. Accepted trade-off: double representation of state is the price
  of keeping the engine pure while using Colyseus sync.
- **Lobby:** 4-letter join codes; custom room registration with `filterBy` on
  joinCode, 2 players max. No accounts (brief non-goal).
- **Reconnection:** `allowReconnection` with a grace window. The schema mirror
  converges a rejoining client automatically; a `snapshot` message provides a
  belt-and-braces full-state resend.

## 5. `packages/protocol`

Zod schemas for **intent** messages and error payloads (shared boundary
validation) plus the TS types both apps import. State-sync message schemas are
deliberately absent — Colyseus schema handles state sync.

## 6. Testing

- **rules:** exhaustive unit + property tests, fully headless.
- **protocol:** schema accept/reject tests.
- **server:** `@colyseus/testing` integration tests — two simulated clients
  join by code; scripted full match of the placeholder ruleset to a win;
  out-of-turn intent rejected; mid-turn drop + reconnect converges to
  identical state.

## 7. Error handling

- Illegal/out-of-turn intents: rejected via `RuleError` message, authoritative
  state untouched.
- Malformed messages: rejected at the protocol zod boundary before reaching
  the rules engine.
- Disconnect without reconnect within the grace window: opponent notified,
  match ends (v1: forfeit).
