# Meridian — Task Plan

Rules: work top to bottom, one task per PR, tests pass before PR. The rules
engine (`packages/rules`) must never import three/react — it runs on the
server and in unit tests headlessly.

> **2026-08-19 — superseded by the Catan pivot.** Meridian is now a Catan
> implementation (see `docs/BRIEF.md`); the remaining placeholder-ruleset
> tasks below stay checked/unchecked as a historical record only. The Catan
> work is planned per-phase in `docs/superpowers/plans/`:
> phase 2 engine + phase 3 server (merged), phase 4 board client
> (`2026-08-19-board-client.md` — lobby, full board scene, pick layer/HUD,
> 3-browser E2E to a win overlay, perf snapshot in `docs/PERF.md`), phase 5
> trade/dev-card UX (`2026-08-19-trade-devcard-ux.md` — trade panel, bank/port
> trades, dev-card buy/play, bought-this-turn restrictions — merged).
> Remaining after phase 5: polish (phase 6).

- [ ] Scaffold Turborepo: `apps/client` (Vite + R3F + TypeScript), `apps/server` (Node + ws + TypeScript), `packages/rules`, `packages/protocol` (zod message schemas); Vitest wired in all packages; README
- [ ] `packages/rules`: core types — `GameState`, `PlayerId`, hex-grid `Coord` with neighbor/distance helpers; property tests on hex math
- [ ] `packages/rules`: declarative ruleset format (piece defs: movement pattern, capture rule) + placeholder ruleset JSON; loader with zod validation
- [ ] `packages/rules`: `applyIntent(state, intent) -> state | RuleError` — pure reducer for move/capture/end-turn; exhaustive unit tests incl. illegal intents
- [ ] `packages/rules`: win detection (last player standing) + turn rotation; tests
- [ ] `packages/protocol`: client↔server message schemas (join, intent, state-sync, error, reconnect) shared by both apps
- [ ] `apps/server`: lobby with join codes; two clients join a room, receive initial state; integration test with two ws clients
- [ ] `apps/server`: authoritative loop — validate intent via rules engine, broadcast resulting state; reject out-of-turn intents; tests
- [ ] `apps/server`: reconnection — client rejoins with token, receives full state snapshot; test covering drop mid-turn
- [x] `apps/client`: R3F board rendering from `GameState` (instanced hex tiles, placeholder piece meshes), zustand store fed by ws messages
- [x] `apps/client`: raycast tile/piece selection → intent sending; legal-move highlighting from rules engine
- [x] `apps/client`: first custom shader — board surface material (animated, stylized); document shader approach in `docs/SHADERS.md`
- [x] Milestone 1 check: two-browser full match E2E script; perf snapshot (draw calls, fps) recorded in `docs/PERF.md`
