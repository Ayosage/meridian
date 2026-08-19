# Meridian — Client Rendering Design (Plan 2 scope)

**Date:** 2026-08-18
**Status:** Approved design, pre-implementation
**Parent docs:** `docs/BRIEF.md` (pillars), `docs/PLAN.md` (tasks 10–13), plan-1 spec
`docs/superpowers/specs/2026-08-18-meridian-engine-server-design.md` (engine + server, built).

## 1. Scope

Turn the `apps/client` stub into a playable web client for the placeholder
hex-tactics ruleset: lobby (create / join by 4-letter code / reconnect),
instanced 3D hex board rendered from server state, click-to-move with
legal-move highlighting, a first custom board shader, and the Milestone-1
two-browser E2E + perf snapshot.

Everything in this plan is **placeholder-art-safe**: it survives the future
game-design cycle (theme, roster, final art direction) untouched, except the
shader's palette and piece geometry, which are deliberately neutral
stand-ins. Out of scope: sound, mobile apps, matchmaking, optimistic
client-side prediction, post-processing effects, adaptive quality tiers
(one shader uniform is reserved as the future hook).

## 2. Ruleset delivery (the gap plan 1 left)

The Colyseus schema mirror never syncs the ruleset, and `MSG.SNAPSHOT` only
reaches reconnecting clients. Decision: the client **bundles the ruleset**
by importing `placeholderRuleset` from `@meridian/rules` (a pure TS package,
browser-safe), and reconstructs a plain engine `GameState` from the synced
schema via a client-side adapter:

```
toGameState(schema: ClientMatchState, ruleset: Ruleset): GameState
```

`ClientMatchState` is a minimal structural (duck) type declared in the
client — the client never imports server code. With a reconstructed
`GameState`, the engine's existing `legalMoves(state, pieceId)` is reused
verbatim for highlighting; no rules logic is duplicated client-side.

## 3. State: one zustand store, Colyseus room outside it

- `src/net/connection.ts` owns the non-serializable Colyseus objects
  (module-level `Client`/`Room`), exposes `createMatch()`,
  `joinMatch(code)`, `reconnectMatch()` (token persisted in sessionStorage
  keyed by room id, enabling refresh-during-grace reconnects), and
  `sendIntent(intent)`. It wires room events into the store:
  `onStateChange` → adapter → `game`, `MSG.RULE_ERROR` → transient error,
  `MSG.MATCH_ENDED` → result, `MSG.SNAPSHOT` → accepted as authoritative.
- `src/store.ts` (zustand): connection slice (status, joinCode, seat,
  error) + match slice (`game: GameState | null`, `matchResult`) + ephemeral
  selection slice (`selectedPieceId`, `legalTargets: Set<coordKey>`).
  Selection derives highlights via the engine's `legalMoves`.
- React never re-renders per frame from this store; per-frame work happens
  in refs/`useFrame` (pillar 2).

## 4. Rendering (pillar 2 non-negotiables baked in)

- **Tiles:** one `InstancedMesh` (hex-prism geometry, 6-segment cylinder),
  instance count derived from `ruleset.board.radius` via the engine's own
  `inRadius` (never hardcoded 37). Pointy-top axial→world layout is a pure
  client function with unit tests. Per-instance visual state (none / hover /
  legal / selected) flows through a single choke point (`setTileState`)
  writing per-instance data — `instanceColor` first, upgraded in place by
  the shader task.
- **Pieces:** one `InstancedMesh` for all pieces (placeholder geometry),
  team color via `instanceColor`, transforms written only when `game`
  changes (not per frame); captured pieces hidden via zero-scale matrices.
  Designed for N piece types even though the placeholder has one.
- **Interaction:** R3F pointer events on the instanced meshes
  (`event.instanceId` → coord/piece via lookup tables built at
  board-construction time). Click own piece → select + highlight
  `legalMoves`; click highlighted tile → send intent; `RULE_ERROR` or any
  state change clears/refreshes selection. No client prediction — the
  authoritative patch moves the piece.
- **Perf rules:** no `setState` inside `useFrame`; no per-frame object
  allocation (scratch `Matrix4`/`Color` reused); draw calls stay single-digit
  (2 instanced meshes + HUD); budgets recorded in `docs/PERF.md`.

## 5. First shader (task 12 of the roadmap)

`ShaderMaterial` on the tile `InstancedMesh`: animated procedural surface
(time-based noise shimmer + radial gradient) with the per-instance state
attribute driving hover/legal/selected tinting. Deliberately neutral
palette — final art direction arrives with the game-design cycle; this task
establishes the **plumbing contract** (uniforms: `uTime`, reserved
`uQualityTier`; per-instance `aState`), documented in `docs/SHADERS.md` so
later piece/VFX shaders share it.

## 6. HUD (DOM, not 3D)

Minimal DOM overlay: create/join lobby form, join-code display for the
host, turn/seat indicator, END TURN button, transient rule-error toast,
match-ended banner (win/forfeit), reconnecting indicator. Styling minimal —
this is not the art pass.

## 7. Milestone-1 gate: E2E + perf snapshot

Playwright script drives **two real browser contexts**: create → read code
from the HUD → join by code in context 2 → play a scripted full match to
`lastPlayerStanding` via genuine canvas pointer events (a dev-only
`window.__meridianDebug.worldToScreen(coordKey)` helper — exposed only under
`import.meta.env.DEV` — converts board coords to screen points so clicks go
through the real raycasting path) → both pages show the winner banner.
Perf snapshot (renderer draw calls, triangle count, measured fps) via a
dev-only stats hook, recorded in `docs/PERF.md`.

## 8. Testing

- Pure logic (layout math, adapter, store transitions, lookup tables):
  vitest, node env, TDD.
- React/R3F components: smoke-level only (construction), plus the E2E —
  no per-component 3D render assertions.
- Server is not modified by this plan. Existing 58 tests stay green.

## 9. Error handling

- Join failures (bad/full/expired code) surface in the lobby form.
- `RULE_ERROR` → transient toast + selection cleared; state untouched by
  design (server-authoritative).
- Disconnect mid-match → reconnect attempt via stored token; failure →
  lobby with an explanatory message. Opponent forfeit → banner.
