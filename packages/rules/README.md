# @meridian/rules

Pure TypeScript game rules — no rendering, network, or Node APIs. Exported
directly from `src/` (no build step).

## Catan engine (`src/catan/`)

Headless Settlers implementation per `docs/superpowers/specs/2026-08-19-catan-pivot-design.md`.

- `createCatanGame({ playerCount, layout }, rng)` → `CatanState` (secrets included — the server redacts per-seat).
- `applyCatanIntent(state, intent, rng)` → `CatanState | CatanRuleError`. All randomness via the injected `Rng` (`createRng(seed)`), so games replay deterministically.
- Client helpers: `legalRoadEdges`, `legalSettlementVertices`, `legalCityVertices`, `affordable`, `bankTradeRate`, `victoryPoints`, `longestRoadLength`.
- Rules-as-data in `src/catan/data.ts`; board/topology facts in `src/catan/topology.ts` (54 vertices / 72 edges).
- The legacy hex-tactics engine (`applyIntent`/`GameState`) is untouched and still exported.

## Testing

`pnpm --filter @meridian/rules test` — unit tests per mechanic, fast-check
property tests (topology, longest road), and a seeded auto-player harness
that plays full 4-player games to a win while asserting resource-conservation
invariants on every step (`test/catan/full-game.test.ts`).
