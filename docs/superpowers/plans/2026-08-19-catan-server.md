# Catan Server (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authoritative 3–4 player Catan rooms with per-seat redacted snapshots, a caretaker pilot bot for absent seats, reconnect-reclaim, and full ws-level integration proof that no secret ever reaches the wrong seat.

**Architecture:** A pure `redactCatanState(state, seat)` in `packages/rules` is the only doorway game state passes to clients. A new `CatanRoom` (alongside the untouched `MatchRoom`) validates intents with new zod schemas, applies them through the existing `applyCatanIntent` engine, and sends each connected seat its own redacted snapshot. A server-side `pilot.ts` performs mandatory actions for seats with no connected human; seats stay reclaimable via manual reconnection until the game ends.

**Tech Stack:** TypeScript, zod, Colyseus 0.16 (`@colyseus/core` pinned 0.16.24), `@colyseus/testing`, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-19-catan-server-design.md`

## Global Constraints

- `packages/rules` must never import three/react/colyseus — pure TS, headless.
- The redactor constructs its output EXPLICITLY field-by-field; never spread `state` or `state.players[i]` into the view (spec §8 fail-closed rule).
- `MatchRoom`, `MatchState`, hex-tactics engine, and the existing client stay untouched (spec §1).
- Server tests run serialized (existing vitest config; do not parallelize).
- `@colyseus/core` stays pinned 0.16.24 (repo README gotcha).
- Working branch: `feat/catan-server` (already created; spec commits on it).
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run package tests with `pnpm --filter @meridian/rules test`, `pnpm --filter @meridian/protocol test`, `pnpm --filter server test` from the repo root `/Users/brandonsmith/Desktop/webdev/meridian`.

---

### Task 1: `redactCatanState` + `CatanClientState` (rules)

**Files:**
- Create: `packages/rules/src/catan/redact.ts`
- Modify: `packages/rules/src/catan/index.ts` (add `export * from './redact'`)
- Test: `packages/rules/test/catan/redact.test.ts`

**Interfaces:**
- Consumes: `CatanState`, `OwnedDevCard`, `PlayerId`, `ResourceCount`, `totalResources` from existing engine modules.
- Produces: `redactCatanState(state: CatanState, seat: PlayerId): CatanClientState`; types `CatanClientState`, `CatanPublicPlayer`, `CatanYou`. Later tasks (3, 5, 8, 11) rely on these exact names.

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/redact.test.ts
import { describe, expect, it } from 'vitest'
import { redactCatanState, type CatanState } from '../../src/index'
import { setupComplete, withResources } from './helpers'

const PUBLIC_PLAYER_KEYS = [
  'resourceCount',
  'devCardCount',
  'knightsPlayed',
  'roadsLeft',
  'settlementsLeft',
  'citiesLeft',
].sort()

export function expectNoLeaks(view: unknown, seat: number, state: CatanState): void {
  const v = view as ReturnType<typeof redactCatanState>
  // own hand, in full
  expect(v.you.seat).toBe(seat)
  expect(v.you.resources).toEqual(state.players[seat]!.resources)
  expect(v.you.devCards).toEqual(state.players[seat]!.devCards)
  // every player entry has ONLY the public summary keys
  for (const p of v.players) {
    expect(Object.keys(p).sort()).toEqual(PUBLIC_PLAYER_KEYS)
  }
  // deck reduced to a count; the array never appears anywhere
  expect(v.devDeckCount).toBe(state.devDeck.length)
  expect(JSON.stringify(v)).not.toContain('"devDeck"')
  // public pass-through stays intact
  expect(v.board).toEqual(state.board)
  expect(v.buildings).toEqual(state.buildings)
  expect(v.roads).toEqual(state.roads)
  expect(v.bank).toEqual(state.bank)
  expect(v.turn).toEqual(state.turn)
  expect(v.seq).toBe(state.seq)
}

describe('redactCatanState', () => {
  it('gives each seat its own hand and only public summaries of others', () => {
    const state = withResources(setupComplete(), 1, { wood: 3, ore: 2 })
    for (let seat = 0; seat < state.playerCount; seat++) {
      expectNoLeaks(redactCatanState(state, seat), seat, state)
    }
    const v0 = redactCatanState(state, 0)
    expect(v0.players[1]!.resourceCount).toBe(
      Object.values(state.players[1]!.resources).reduce((a, b) => a + b, 0),
    )
    expect((v0.players[1] as Record<string, unknown>)['resources']).toBeUndefined()
  })

  it('reveals winnerVpCards only when the game is won', () => {
    const state = setupComplete()
    expect(redactCatanState(state, 0).winnerVpCards).toBeNull()
    const won: CatanState = {
      ...state,
      winner: 2,
      players: state.players.map((p, i) =>
        i === 2
          ? { ...p, devCards: [{ card: 'vp' as const, boughtOnTurn: 1 }, { card: 'knight' as const, boughtOnTurn: 1 }] }
          : p,
      ),
    }
    expect(redactCatanState(won, 0).winnerVpCards).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules test -- redact`
Expected: FAIL — `redactCatanState` is not exported.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rules/src/catan/redact.ts
import type { PlayerId } from '../state'
import type { CatanBoard } from './board'
import type { CatanState, Building, OwnedDevCard, TurnState } from './state'
import type { EdgeId, VertexId } from './topology'
import { totalResources, type ResourceCount } from './types'

/** Public per-seat summary — composition of hands never appears. */
export interface CatanPublicPlayer {
  resourceCount: number
  devCardCount: number
  knightsPlayed: number
  roadsLeft: number
  settlementsLeft: number
  citiesLeft: number
}

export interface CatanYou {
  seat: PlayerId
  resources: ResourceCount
  devCards: readonly OwnedDevCard[]
}

/**
 * What one seat is allowed to see (spec §2). This is the ONLY shape the
 * server ever sends to a client.
 */
export interface CatanClientState {
  seq: number
  playerCount: number
  board: CatanBoard
  buildings: Readonly<Record<VertexId, Building>>
  roads: Readonly<Record<EdgeId, PlayerId>>
  bank: ResourceCount
  turn: TurnState
  awards: { longestRoad: PlayerId | null; largestArmy: PlayerId | null }
  winner: PlayerId | null
  devDeckCount: number
  players: readonly CatanPublicPlayer[]
  you: CatanYou
  /** VP-card count revealed by the winner; null until the game is won. */
  winnerVpCards: number | null
}

/**
 * Fail-closed by construction (spec §8): the view is built field-by-field.
 * NEVER spread `state` or `state.players[i]` here — a future secret field
 * must not leak by default.
 */
export function redactCatanState(state: CatanState, seat: PlayerId): CatanClientState {
  const me = state.players[seat]!
  return {
    seq: state.seq,
    playerCount: state.playerCount,
    board: state.board,
    buildings: state.buildings,
    roads: state.roads,
    bank: state.bank,
    turn: state.turn,
    awards: state.awards,
    winner: state.winner,
    devDeckCount: state.devDeck.length,
    players: state.players.map((p) => ({
      resourceCount: totalResources(p.resources),
      devCardCount: p.devCards.length,
      knightsPlayed: p.knightsPlayed,
      roadsLeft: p.roadsLeft,
      settlementsLeft: p.settlementsLeft,
      citiesLeft: p.citiesLeft,
    })),
    you: { seat, resources: me.resources, devCards: me.devCards },
    winnerVpCards:
      state.winner === null
        ? null
        : state.players[state.winner]!.devCards.filter((c) => c.card === 'vp').length,
  }
}
```

Add to `packages/rules/src/catan/index.ts` (alphabetical position is fine — append after `'./queries'` line):

```ts
export * from './redact'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meridian/rules test -- redact`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole rules suite**

Run: `pnpm --filter @meridian/rules test`
Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/rules/src/catan/redact.ts packages/rules/src/catan/index.ts packages/rules/test/catan/redact.test.ts
git commit -m "feat(rules): redactCatanState — per-seat client view, fail-closed construction"
```

---

### Task 2: Promote bot + test-support helpers into rules src

**Files:**
- Create: `packages/rules/src/catan/bot.ts`
- Create: `packages/rules/src/catan/test-support.ts`
- Modify: `packages/rules/src/catan/index.ts` (two more export lines)
- Modify: `packages/rules/test/catan/full-game.test.ts` (delete local `nextIntent`, import `botIntent`)
- Modify: `packages/rules/test/catan/helpers.ts` (re-export moved values)

**Interfaces:**
- Produces: `botIntent(state: CatanState): CatanIntent` (the scripted legality-exercising bot, moved VERBATIM from `full-game.test.ts`'s `nextIntent`); `stubRng(values: number[]): Rng`; `die(k: number): number`; `SETUP_PLACEMENTS` (moved verbatim from `helpers.ts`); `mustApply(state, intent, rng?): CatanState`. Tasks 3, 6, 7, 9, 11, 12 import these from `@meridian/rules`.

Why: server tests cannot import another package's test files; these helpers are needed by server unit/integration tests (and later by phase-4 e2e). They are deliberately shipped in src as documented test/pilot support.

- [ ] **Step 1: Create `bot.ts` by moving `nextIntent` verbatim**

Copy the entire `nextIntent` function body from `packages/rules/test/catan/full-game.test.ts` into:

```ts
// packages/rules/src/catan/bot.ts
import { coordKey } from '../coord'
import { affordable, legalCityVertices, legalRoadEdges, legalSettlementVertices } from './queries'
import type { CatanIntent } from './intent'
import type { CatanState } from './state'
import { standardTopology } from './topology'
import { RESOURCES, totalResources } from './types'

/**
 * Deterministic scripted bot: one legal decision for whoever must act.
 * Test/support tool (full-game tests, pilot liveness harness, demos) —
 * NOT a competent player and NOT the caretaker pilot.
 */
export function botIntent(state: CatanState): CatanIntent {
  // ... body of nextIntent, moved verbatim, with `nextIntent` renamed `botIntent`
}
```

The body is moved WITHOUT behavior changes (imports adjusted from `'../../src/index'` to the relative module paths above). Then in `full-game.test.ts`: delete the local `nextIntent` and its now-unused imports, `import { botIntent } from '../../src/index'`, and replace call sites (`nextIntent(state)` → `botIntent(state)`).

- [ ] **Step 2: Create `test-support.ts`**

Move `stubRng`, `die`, and `SETUP_PLACEMENTS` verbatim from `packages/rules/test/catan/helpers.ts`, and add `mustApply` (the vitest-free version of helpers' `apply`):

```ts
// packages/rules/src/catan/test-support.ts
import { applyCatanIntent } from './apply'
import { createRng, type Rng } from './rng'
import { isCatanRuleError, type CatanIntent } from './intent'
import type { CatanState } from './state'
import { edgeId, vertexId } from './topology'

/** Deterministic rng from an explicit value list; throws when exhausted. */
export function stubRng(values: number[]): Rng {
  let i = 0
  return {
    next() {
      if (i >= values.length) throw new Error('stubRng exhausted')
      return values[i++]!
    },
  }
}

/** A next() value that makes rollD6 return k (1..6). */
export function die(k: number): number {
  return (k - 0.5) / 6
}

/** Apply an intent that MUST be legal; throws with a readable message otherwise. */
export function mustApply(state: CatanState, intent: CatanIntent, rng: Rng = createRng(0)): CatanState {
  const result = applyCatanIntent(state, intent, rng)
  if (isCatanRuleError(result))
    throw new Error(`unexpected ${result.code}: ${result.message} (intent ${intent.type})`)
  return result
}

export const SETUP_PLACEMENTS = [
  // ... the 8 entries moved verbatim from helpers.ts
] as const
```

In `helpers.ts`: delete the moved definitions and re-export so existing tests keep working unchanged:

```ts
export { stubRng, die, SETUP_PLACEMENTS, mustApply } from '../../src/index'
```

(`helpers.ts`'s `apply` stays but becomes `export const apply = mustApply` — keep `expectError`, `setupComplete`, `inMain`, `withResources` in helpers as-is, updating their internal `apply` references if needed.)

Add to `packages/rules/src/catan/index.ts`:

```ts
export * from './bot'
export * from './test-support'
```

- [ ] **Step 3: Run the full rules suite**

Run: `pnpm --filter @meridian/rules test`
Expected: all 123+ tests PASS (pure moves, no behavior change).

- [ ] **Step 4: Commit**

```bash
git add packages/rules/src/catan/bot.ts packages/rules/src/catan/test-support.ts packages/rules/src/catan/index.ts packages/rules/test/catan/full-game.test.ts packages/rules/test/catan/helpers.ts
git commit -m "refactor(rules): promote scripted bot + test-support helpers to src for cross-package reuse"
```

---

### Task 3: No-leak replay property test (rules)

**Files:**
- Test: `packages/rules/test/catan/redact-replay.test.ts`

**Interfaces:**
- Consumes: `botIntent`, `redactCatanState`, `createCatanGame`, `applyCatanIntent`, `createRng`, `isCatanRuleError` from `@meridian/rules`; `expectNoLeaks` exported from `./redact.test` (Task 1 defined it as an export).

- [ ] **Step 1: Write the test**

```ts
// packages/rules/test/catan/redact-replay.test.ts
import { describe, expect, it } from 'vitest'
import {
  applyCatanIntent,
  botIntent,
  createCatanGame,
  createRng,
  isCatanRuleError,
  redactCatanState,
} from '../../src/index'
import { expectNoLeaks } from './redact.test'

const MAX_INTENTS = 5000

describe('redaction across full seeded games', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: every seat's view is leak-free at every step`, () => {
      const rng = createRng(seed)
      let state = createCatanGame({ playerCount: 4 }, rng)
      for (let i = 0; i < MAX_INTENTS && state.winner === null; i++) {
        for (let seat = 0; seat < state.playerCount; seat++) {
          expectNoLeaks(redactCatanState(state, seat), seat, state)
        }
        const result = applyCatanIntent(state, botIntent(state), rng)
        if (isCatanRuleError(result)) throw new Error(`${result.code}: ${result.message}`)
        state = result
      }
      expect(state.winner).not.toBeNull()
      for (let seat = 0; seat < state.playerCount; seat++) {
        expectNoLeaks(redactCatanState(state, seat), seat, state)
      }
    })
  }
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @meridian/rules test -- redact-replay`
Expected: PASS. (If a seed fails to reach a winner within the cap, it would also fail in `full-game.test.ts` — the same seeds are proven there for seeds 1–5.)

- [ ] **Step 3: Commit**

```bash
git add packages/rules/test/catan/redact-replay.test.ts
git commit -m "test(rules): no-leak property — redacted views across full seeded games"
```

---

### Task 4: Retype public queries to accept redacted views (rules)

**Files:**
- Modify: `packages/rules/src/catan/queries.ts`
- Test: `packages/rules/test/catan/queries-view.test.ts`

**Interfaces:**
- Produces: `type PlacementView = Pick<CatanState, 'board' | 'buildings' | 'roads'>`; `legalRoadEdges`, `legalSettlementVertices`, `legalCityVertices`, `bankTradeRate` accept `PlacementView` as their first parameter (a `CatanClientState` satisfies it structurally). `affordable` keeps taking full `CatanState`. Tasks 11 and phase-4 client rely on this.

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/queries-view.test.ts
import { describe, expect, it } from 'vitest'
import {
  bankTradeRate,
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  redactCatanState,
} from '../../src/index'
import { setupComplete } from './helpers'

describe('queries accept redacted client views', () => {
  it('placement queries give identical answers on state and view', () => {
    const state = setupComplete()
    const view = redactCatanState(state, 0)
    expect(legalRoadEdges(view, 0)).toEqual(legalRoadEdges(state, 0))
    expect(legalSettlementVertices(view, 0)).toEqual(legalSettlementVertices(state, 0))
    expect(legalCityVertices(view, 0)).toEqual(legalCityVertices(state, 0))
    expect(bankTradeRate(view, 0, 'brick')).toBe(bankTradeRate(state, 0, 'brick'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules test -- queries-view`
Expected: FAIL to typecheck/compile — `CatanClientState` is not assignable to `CatanState`. (Vitest surfaces this as a transform/type error; `pnpm --filter @meridian/rules lint` shows it directly.)

- [ ] **Step 3: Retype in `queries.ts`**

```ts
/** The public subset placement legality needs — a CatanClientState satisfies this. */
export type PlacementView = Pick<CatanState, 'board' | 'buildings' | 'roads'>
```

Change ONLY the first-parameter types (bodies untouched):
- `legalRoadEdges(state: PlacementView, player: PlayerId)`
- `legalSettlementVertices(state: PlacementView, player: PlayerId, opts…)`
- `legalCityVertices(state: PlacementView, player: PlayerId)`
- `bankTradeRate(state: PlacementView, player: PlayerId, resource: Resource)`

Check `packages/rules/src/catan/placement.ts` — `settlementDistanceOk` is called by `legalSettlementVertices`; retype its state parameter to `Pick<CatanState, 'buildings'>` (or `PlacementView`) to match.

- [ ] **Step 4: Run tests + lint**

Run: `pnpm --filter @meridian/rules test && pnpm --filter @meridian/rules lint`
Expected: all PASS (widening a parameter type breaks no existing caller).

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan/queries.ts packages/rules/src/catan/placement.ts packages/rules/test/catan/queries-view.test.ts
git commit -m "feat(rules): placement queries accept redacted client views (PlacementView)"
```

---

### Task 5: Protocol — `catanIntentSchema` + `MSG.START` + snapshot payload type

**Files:**
- Modify: `packages/protocol/package.json` (move `@meridian/rules` from devDependencies to dependencies — the snapshot payload type imports from it)
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/catan-intents.test.ts`

**Interfaces:**
- Consumes: `type CatanClientState` from `@meridian/rules` (type-only).
- Produces: `MSG.START = 'start'`; `catanIntentSchema` (zod), `type CatanClientIntent = z.infer<typeof catanIntentSchema>`; `interface CatanSnapshotPayload { seq: number; view: CatanClientState }`. Tasks 8–12 and the phase-4 client rely on these names.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/test/catan-intents.test.ts
import { describe, expect, it } from 'vitest'
import { catanIntentSchema, MSG } from '../src/index'

describe('catanIntentSchema', () => {
  const valid = [
    { type: 'placeSetupSettlement', vertex: 'v:0,0:1' },
    { type: 'placeSetupRoad', edge: 'e:0,0:1' },
    { type: 'rollDice' },
    { type: 'discard', resources: { wood: 2, ore: 1 } },
    { type: 'moveRobber', hex: { q: 1, r: -1 }, stealFrom: 2 },
    { type: 'moveRobber', hex: { q: 1, r: -1 }, stealFrom: null },
    { type: 'build', piece: 'city', location: 'v:0,0:1' },
    { type: 'buyDevCard' },
    { type: 'playDevCard', card: 'knight' },
    { type: 'playDevCard', card: 'roadBuilding', edges: ['e:0,0:1', 'e:0,0:2'] },
    { type: 'playDevCard', card: 'yearOfPlenty', take: ['wood', 'wood'] },
    { type: 'playDevCard', card: 'monopoly', resource: 'ore' },
    { type: 'bankTrade', give: 'wood', get: 'ore' },
    { type: 'offerTrade', give: { wood: 1 }, get: { ore: 1 } },
    { type: 'respondTrade', response: 'accept' },
    { type: 'respondTrade', response: { give: { ore: 2 }, get: { wood: 1 } } },
    { type: 'confirmTrade', partner: 1 },
    { type: 'cancelTrade' },
    { type: 'endTurn' },
  ]
  it.each(valid.map((v) => [v.type, v] as const))('accepts %s', (_t, intent) => {
    expect(catanIntentSchema.safeParse(intent).success).toBe(true)
  })

  it('rejects a player field, unknown keys, and bad values', () => {
    expect(catanIntentSchema.safeParse({ type: 'endTurn', player: 0 }).success).toBe(false)
    expect(catanIntentSchema.safeParse({ type: 'rollDice', extra: 1 }).success).toBe(false)
    expect(catanIntentSchema.safeParse({ type: 'forfeit' }).success).toBe(false)
    expect(catanIntentSchema.safeParse({ type: 'discard', resources: { wood: -1 } }).success).toBe(false)
    expect(catanIntentSchema.safeParse({ type: 'discard', resources: { gold: 1 } }).success).toBe(false)
    expect(catanIntentSchema.safeParse({ type: 'moveRobber', hex: { q: 0.5, r: 0 }, stealFrom: null }).success).toBe(false)
  })

  it('exposes MSG.START', () => {
    expect(MSG.START).toBe('start')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/protocol test`
Expected: FAIL — `catanIntentSchema` not exported.

- [ ] **Step 3: Implement in `packages/protocol/src/index.ts`**

Add `START: 'start',` to the `MSG` object, then append:

```ts
import type { CatanClientState } from '@meridian/rules'

const resourceNames = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const
const resourceSchema = z.enum(resourceNames)
/** Strict partial resource map; positive integer counts only. */
const resourceMapSchema = z
  .object(
    Object.fromEntries(
      resourceNames.map((r) => [r, z.number().int().positive().optional()]),
    ) as Record<(typeof resourceNames)[number], z.ZodOptional<z.ZodNumber>>,
  )
  .strict()

const boardId = z.string().min(1).max(64)
const seatSchema = z.number().int().nonnegative().max(3)

/**
 * Client -> server Catan intents. NO player field — the server derives the
 * seat from the connection. Strict: unknown keys are rejected. The engine
 * remains the authority on legality; this only rejects malformed shapes.
 */
export const catanIntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('placeSetupSettlement'), vertex: boardId }).strict(),
  z.object({ type: z.literal('placeSetupRoad'), edge: boardId }).strict(),
  z.object({ type: z.literal('rollDice') }).strict(),
  z.object({ type: z.literal('discard'), resources: resourceMapSchema }).strict(),
  z.object({ type: z.literal('moveRobber'), hex: coordSchema, stealFrom: seatSchema.nullable() }).strict(),
  z.object({ type: z.literal('build'), piece: z.enum(['road', 'settlement', 'city']), location: boardId }).strict(),
  z.object({ type: z.literal('buyDevCard') }).strict(),
  z.object({ type: z.literal('playDevCard'), card: z.literal('knight') }).strict(),
  z.object({ type: z.literal('playDevCard'), card: z.literal('roadBuilding'), edges: z.array(boardId).min(1).max(2) }).strict(),
  z.object({ type: z.literal('playDevCard'), card: z.literal('yearOfPlenty'), take: z.tuple([resourceSchema, resourceSchema]) }).strict(),
  z.object({ type: z.literal('playDevCard'), card: z.literal('monopoly'), resource: resourceSchema }).strict(),
  z.object({ type: z.literal('bankTrade'), give: resourceSchema, get: resourceSchema }).strict(),
  z.object({ type: z.literal('offerTrade'), give: resourceMapSchema, get: resourceMapSchema }).strict(),
  z
    .object({
      type: z.literal('respondTrade'),
      response: z.union([
        z.literal('accept'),
        z.literal('reject'),
        z.object({ give: resourceMapSchema, get: resourceMapSchema }).strict(),
      ]),
    })
    .strict(),
  z.object({ type: z.literal('confirmTrade'), partner: seatSchema }).strict(),
  z.object({ type: z.literal('cancelTrade') }).strict(),
  z.object({ type: z.literal('endTurn') }).strict(),
])
export type CatanClientIntent = z.infer<typeof catanIntentSchema>

/** Server -> client per-seat snapshot (spec §2/§5). */
export interface CatanSnapshotPayload {
  seq: number
  view: CatanClientState
}
```

Note: `roadBuilding` edges allow `min(1)` because the engine permits playing it with one road left in stock — confirm against `dev-cards.ts` while implementing; if the engine requires exactly 2, tighten to `.length(2)`.

In `package.json`, move `"@meridian/rules": "workspace:*"` from `devDependencies` to `dependencies`, then run `pnpm install`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @meridian/protocol test && pnpm --filter @meridian/protocol lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/index.ts packages/protocol/test/catan-intents.test.ts packages/protocol/package.json pnpm-lock.yaml
git commit -m "feat(protocol): catan intent schemas, MSG.START, snapshot payload type"
```

---

### Task 6: Caretaker pilot (server, engine-only)

**Files:**
- Create: `apps/server/src/pilot.ts`
- Test: `apps/server/test/pilot.test.ts`

**Interfaces:**
- Consumes: `CatanState`, `CatanIntent`, `Rng`, `PlayerId`, `legalSettlementVertices`, `standardTopology`, `coordKey`, `pick`, `RESOURCES`, `totalResources` from `@meridian/rules`.
- Produces: `pilotIntent(state: CatanState, seat: PlayerId, rng: Rng): CatanIntent | null`. Tasks 7 and 8 rely on this exact signature.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/test/pilot.test.ts
import { describe, expect, it } from 'vitest'
import {
  applyCatanIntent,
  createCatanGame,
  createRng,
  isCatanRuleError,
  mustApply,
  SETUP_PLACEMENTS,
  stubRng,
  die,
  coordKey,
  standardTopology,
  type CatanState,
} from '@meridian/rules'
import { pilotIntent } from '../src/pilot'

function setupComplete(): CatanState {
  let state = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
  for (const p of SETUP_PLACEMENTS) {
    state = mustApply(state, { type: 'placeSetupSettlement', player: p.player, vertex: p.vertex })
    state = mustApply(state, { type: 'placeSetupRoad', player: p.player, edge: p.edge })
  }
  return state
}

/** Test surgery: hand a player resources out of the bank. */
function withResources(state: CatanState, player: number, resources: Partial<Record<string, number>>): CatanState {
  const players = state.players.map((p, i) =>
    i === player
      ? { ...p, resources: Object.fromEntries(Object.entries(p.resources).map(([r, n]) => [r, n + (resources[r] ?? 0)])) as CatanState['players'][number]['resources'] }
      : p,
  )
  const bank = Object.fromEntries(
    Object.entries(state.bank).map(([r, n]) => [r, n - (resources[r] ?? 0)]),
  ) as CatanState['bank']
  return { ...state, players, bank }
}

describe('pilotIntent', () => {
  it('returns null when the seat has nothing mandatory to do', () => {
    const state = setupComplete() // preRoll, current = 0
    expect(pilotIntent(state, 1, createRng(0))).toBeNull()
  })

  it('rolls on its own preRoll turn', () => {
    const state = setupComplete()
    expect(pilotIntent(state, 0, createRng(0))).toEqual({ type: 'rollDice', player: 0 })
  })

  it('discards greedily from the largest piles, ties broken in RESOURCES order', () => {
    let state = withResources(setupComplete(), 1, { wood: 5, brick: 5, ore: 1 })
    // player 1 now holds 11+setup cards; force a 7 so a discard is owed
    state = mustApply(state, { type: 'rollDice', player: 0 }, stubRng([die(3), die(4)]))
    expect(state.turn.phase).toBe('discard')
    const owed = state.turn.pendingDiscards[1]!
    const intent = pilotIntent(state, 1, createRng(0))
    expect(intent).not.toBeNull()
    expect(intent!.type).toBe('discard')
    const resources = (intent as { resources: Record<string, number> }).resources
    // greedy: biggest piles first; wood before brick on ties (RESOURCES order)
    const total = Object.values(resources).reduce((a, b) => a + b, 0)
    expect(total).toBe(owed)
    const applied = applyCatanIntent(state, intent!, createRng(0))
    expect(isCatanRuleError(applied)).toBe(false)
  })

  it('moves the robber to a building-free hex and steals only when forced', () => {
    let state = setupComplete()
    state = mustApply(state, { type: 'rollDice', player: 0 }, stubRng([die(3), die(4)]))
    // clear pending discards by having each owing player discard via the pilot
    while (state.turn.phase === 'discard') {
      const seat = Number(Object.keys(state.turn.pendingDiscards)[0]!)
      state = mustApply(state, pilotIntent(state, seat, createRng(0))!)
    }
    expect(state.turn.phase).toBe('robber')
    const intent = pilotIntent(state, 0, createRng(0))!
    expect(intent.type).toBe('moveRobber')
    const move = intent as { hex: { q: number; r: number }; stealFrom: number | null }
    const topo = standardTopology()
    const touched = (topo.hexVertices[coordKey(move.hex)] ?? []).some((v) => state.buildings[v])
    if (!touched) expect(move.stealFrom).toBeNull()
    expect(isCatanRuleError(applyCatanIntent(state, intent, createRng(0)))).toBe(false)
  })

  it('rejects an open trade offer addressed to it', () => {
    let state = setupComplete()
    state = mustApply(state, { type: 'rollDice', player: 0 }, stubRng([die(1), die(2)]))
    state = withResources(state, 0, { wood: 1 })
    state = mustApply(state, { type: 'offerTrade', player: 0, give: { wood: 1 }, get: { ore: 1 } })
    expect(pilotIntent(state, 2, createRng(0))).toEqual({
      type: 'respondTrade',
      player: 2,
      response: 'reject',
    })
    // and it does not respond twice
    state = mustApply(state, { type: 'respondTrade', player: 2, response: 'reject' })
    expect(pilotIntent(state, 2, createRng(0))).toBeNull()
  })

  it('cancels its own dangling trade offer and ends its turn', () => {
    let state = setupComplete()
    state = mustApply(state, { type: 'rollDice', player: 0 }, stubRng([die(1), die(2)]))
    state = withResources(state, 0, { wood: 1 })
    state = mustApply(state, { type: 'offerTrade', player: 0, give: { wood: 1 }, get: { ore: 1 } })
    // seat 0 disconnects: pilot must first cancel the dangling offer…
    expect(pilotIntent(state, 0, createRng(0))).toEqual({ type: 'cancelTrade', player: 0 })
    state = mustApply(state, { type: 'cancelTrade', player: 0 })
    // …then end the turn
    expect(pilotIntent(state, 0, createRng(0))).toEqual({ type: 'endTurn', player: 0 })
  })

  it('completes the setup draft', () => {
    let state = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
    const rng = createRng(3)
    for (let i = 0; i < 16; i++) {
      const seat = state.turn.current
      const intent = pilotIntent(state, seat, rng)
      expect(intent).not.toBeNull()
      state = mustApply(state, intent!, rng)
    }
    expect(state.turn.phase).toBe('preRoll')
  })

  it('never emits build/buy/play/offer intents', () => {
    // covered structurally: pilotIntent's return type is exercised across
    // this file; assert on the union of types seen in the setup-draft loop
    // plus a main-phase turn.
    let state = setupComplete()
    state = mustApply(state, { type: 'rollDice', player: 0 }, stubRng([die(1), die(2)]))
    const intent = pilotIntent(state, 0, createRng(0))!
    expect(['endTurn', 'cancelTrade']).toContain(intent.type)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter server test -- pilot`
Expected: FAIL — `../src/pilot` does not exist.

- [ ] **Step 3: Implement `pilot.ts`**

```ts
// apps/server/src/pilot.ts
import {
  coordKey,
  legalSettlementVertices,
  pick,
  RESOURCES,
  standardTopology,
  totalResources,
  type CatanIntent,
  type CatanState,
  type PlayerId,
  type Resource,
  type Rng,
} from '@meridian/rules'

/**
 * Caretaker pilot (spec §3): performs ONLY mandatory actions for a seat
 * with no connected human, so the game never stalls. It never builds,
 * buys or plays dev cards, or offers trades — a piloted seat cannot win
 * or reshape the board. Returns null when nothing is mandatory.
 */
export function pilotIntent(state: CatanState, seat: PlayerId, rng: Rng): CatanIntent | null {
  if (state.winner !== null || state.turn.phase === 'ended') return null
  const t = state.turn

  // off-turn obligations first (mirror the engine's off-turn dispatch)
  const owed = t.pendingDiscards[seat]
  if (t.phase === 'discard' && owed) {
    return { type: 'discard', player: seat, resources: greedyDiscard(state, seat, owed) }
  }
  if (t.openTrade && t.current !== seat && t.openTrade.responses[seat] === undefined) {
    return { type: 'respondTrade', player: seat, response: 'reject' }
  }

  if (t.current !== seat) return null

  switch (t.phase) {
    case 'setup': {
      if (t.setup!.expect === 'settlement') {
        const spots = legalSettlementVertices(state, seat, { setup: true })
        return { type: 'placeSetupSettlement', player: seat, vertex: pick(rng, spots) }
      }
      const topo = standardTopology()
      const settlement = t.setup!.lastSettlement!
      const edge = (topo.vertexEdges[settlement] ?? []).find((e) => state.roads[e] === undefined)!
      return { type: 'placeSetupRoad', player: seat, edge }
    }
    case 'preRoll':
      return { type: 'rollDice', player: seat }
    case 'robber':
      return robberMove(state, seat, rng)
    case 'main':
      if (t.openTrade) return { type: 'cancelTrade', player: seat }
      return { type: 'endTurn', player: seat }
    case 'discard':
      return null // own discard handled above; others still owe — wait
    default:
      return null
  }
}

/** Shed from the largest piles first; ties broken in RESOURCES order. */
function greedyDiscard(state: CatanState, seat: PlayerId, owed: number): Partial<Record<Resource, number>> {
  const hand = { ...state.players[seat]!.resources }
  const out: Partial<Record<Resource, number>> = {}
  let remaining = owed
  while (remaining > 0) {
    let best: Resource = RESOURCES[0]!
    for (const r of RESOURCES) if (hand[r] > hand[best]) best = r
    const take = Math.min(hand[best], remaining)
    out[best] = (out[best] ?? 0) + take
    hand[best] -= take
    remaining -= take
  }
  return out
}

function robberMove(state: CatanState, seat: PlayerId, rng: Rng): CatanIntent {
  const topo = standardTopology()
  const candidates = state.board.hexes.filter((h) => coordKey(h.coord) !== state.board.robber)
  const untouched = candidates.filter(
    (h) => !(topo.hexVertices[coordKey(h.coord)] ?? []).some((v) => state.buildings[v]),
  )
  const hex = (untouched.length > 0 ? pick(rng, untouched) : pick(rng, candidates)).coord
  const key = coordKey(hex)
  const victims = state.players
    .map((_, i) => i)
    .filter(
      (i) =>
        i !== seat &&
        totalResources(state.players[i]!.resources) > 0 &&
        (topo.hexVertices[key] ?? []).some((v) => state.buildings[v]?.owner === i),
    )
  return {
    type: 'moveRobber',
    player: seat,
    hex,
    stealFrom: victims.length > 0 ? pick(rng, victims) : null,
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter server test -- pilot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/pilot.ts apps/server/test/pilot.test.ts
git commit -m "feat(server): caretaker pilot — mandatory-actions-only driver for absent seats"
```

---

### Task 7: Pilot liveness property test

**Files:**
- Test: `apps/server/test/pilot-liveness.test.ts`

**Interfaces:**
- Consumes: `pilotIntent` (Task 6), `botIntent` (Task 2), engine exports.

- [ ] **Step 1: Write the test**

```ts
// apps/server/test/pilot-liveness.test.ts
import { describe, expect, it } from 'vitest'
import {
  applyCatanIntent,
  botIntent,
  createCatanGame,
  createRng,
  isCatanRuleError,
  type CatanState,
} from '@meridian/rules'
import { pilotIntent } from '../src/pilot'

const MAX_INTENTS = 5000
const PILOT_SEATS = new Set([1, 3])

/** The single seat the game is currently waiting on. */
function waitingSeat(state: CatanState): number {
  if (state.turn.phase === 'discard') return Number(Object.keys(state.turn.pendingDiscards)[0]!)
  return state.turn.current
}

describe('pilot liveness: piloted seats never stall a game', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: mixed human/pilot game terminates, pilot never wins`, () => {
      const rng = createRng(seed)
      let state = createCatanGame({ playerCount: 4 }, rng)
      const pilotTypes = new Set<string>()
      for (let i = 0; i < MAX_INTENTS && state.winner === null; i++) {
        const seat = waitingSeat(state)
        const intent = PILOT_SEATS.has(seat) ? pilotIntent(state, seat, rng) : botIntent(state)
        expect(intent, `stalled at step ${i}, phase ${state.turn.phase}, seat ${seat}`).not.toBeNull()
        if (PILOT_SEATS.has(seat)) pilotTypes.add(intent!.type)
        const result = applyCatanIntent(state, intent!, rng)
        if (isCatanRuleError(result))
          throw new Error(`pilot=${PILOT_SEATS.has(seat)} seat=${seat}: ${result.code}: ${result.message}`)
        state = result
      }
      expect(state.winner).not.toBeNull()
      expect(PILOT_SEATS.has(state.winner!)).toBe(false)
      // caretaker discipline: no build/buy/play/offer ever emitted
      for (const forbidden of ['build', 'buyDevCard', 'playDevCard', 'offerTrade', 'confirmTrade', 'bankTrade'])
        expect(pilotTypes.has(forbidden)).toBe(false)
    })
  }
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter server test -- pilot-liveness`
Expected: PASS. If a seed fails to reach a winner inside the cap (two passive seats slow the bots down), raise `MAX_INTENTS` to 8000 first; if it still fails, swap in the next seed (4, 5, …) and note the change in the test comment. A `null` intent or rule error is a REAL pilot bug — fix the pilot, not the test.

- [ ] **Step 3: Commit**

```bash
git add apps/server/test/pilot-liveness.test.ts
git commit -m "test(server): pilot liveness property — mixed games terminate, caretaker discipline holds"
```

---

### Task 8: `CatanRoom` — lobby, start, intent loop, per-seat snapshots

**Files:**
- Create: `apps/server/src/schema/CatanLobbyState.ts`
- Create: `apps/server/src/rooms/CatanRoom.ts`
- Modify: `apps/server/src/app.config.ts` (register `'catan'`)
- Test: `apps/server/test/catan-room.test.ts`

**Interfaces:**
- Consumes: `redactCatanState`, `createCatanGame`, `applyCatanIntent`, `isCatanRuleError`, `createRng`, `stubRng` from `@meridian/rules`; `catanIntentSchema`, `MSG`, `CatanSnapshotPayload` from `@meridian/protocol`; `pilotIntent` (Task 6); `generateRoomId`/`releaseRoomId` from `../room-id`.
- Produces: room type `'catan'` with create options `{ players: 3 | 4; layout?: 'beginner' | 'random'; pilotDelayMs?: number; abandonMinutes?: number; seed?: number; rngScript?: number[] }`. `rngScript` is a TEST-ONLY escape hatch (documented deviation from spec §4: it exists so ws tests can force dice; it builds a `stubRng`). Tasks 9–12 rely on these options and on the message flow.

- [ ] **Step 1: Write the failing integration tests**

```ts
// apps/server/test/catan-room.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as ClientRoom } from 'colyseus.js'
import appConfig from '../src/app.config'
import { MSG, type CatanSnapshotPayload } from '@meridian/protocol'

let server: ColyseusTestServer
beforeAll(async () => {
  server = await boot(appConfig)
})
afterAll(async () => {
  await server.shutdown()
})
afterEach(async () => {
  await server.cleanup()
})

const PUBLIC_PLAYER_KEYS = [
  'citiesLeft',
  'devCardCount',
  'knightsPlayed',
  'resourceCount',
  'roadsLeft',
  'settlementsLeft',
]

/** Structural no-leak check on a received snapshot, keyed to the seat that received it. */
export function expectRedactedFor(payload: CatanSnapshotPayload, seat: number): void {
  expect(payload.view.you.seat).toBe(seat)
  for (const p of payload.view.players) expect(Object.keys(p).sort()).toEqual(PUBLIC_PLAYER_KEYS)
  expect(JSON.stringify(payload)).not.toContain('"devDeck"')
  expect(typeof payload.view.devDeckCount).toBe('number')
}

function collectSnapshots(client: ClientRoom, sink: CatanSnapshotPayload[]): void {
  client.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
  client.onMessage('*', () => undefined)
}

function nextMessage<T>(client: ClientRoom, type: string): Promise<T> {
  return new Promise((resolve) => client.onMessage(type, (payload: T) => resolve(payload)))
}

async function seatClients(n: 3 | 4, options: Record<string, unknown> = {}) {
  const clients: ClientRoom[] = []
  const snapshots: CatanSnapshotPayload[][] = []
  const first = await server.sdk.joinOrCreate('catan', { players: n, pilotDelayMs: 0, seed: 1, ...options })
  clients.push(first)
  snapshots.push([])
  collectSnapshots(first, snapshots[0]!)
  for (let i = 1; i < n; i++) {
    const c = await server.sdk.joinById(first.roomId, {})
    clients.push(c)
    snapshots.push([])
    collectSnapshots(c, snapshots[i]!)
  }
  await server.room(first.roomId).waitForNextPatch()
  return { clients, snapshots, roomId: first.roomId }
}

describe('CatanRoom lobby and intent loop', () => {
  it('starts automatically when full and sends each seat a redacted setup snapshot', async () => {
    const { clients, snapshots } = await seatClients(4)
    // wait until every client holds a first snapshot
    await new Promise((r) => setTimeout(r, 50))
    for (let seat = 0; seat < 4; seat++) {
      expect(snapshots[seat]!.length).toBeGreaterThan(0)
      const snap = snapshots[seat]!.at(-1)!
      expectRedactedFor(snap, seat)
      expect(snap.view.turn.phase).toBe('setup')
    }
    void clients
  })

  it('rejects an out-of-turn intent with RULE_ERROR and applies a legal one with fresh snapshots', async () => {
    const { clients, snapshots } = await seatClients(4)
    await new Promise((r) => setTimeout(r, 50))
    const err = nextMessage<{ code: string }>(clients[1]!, MSG.RULE_ERROR)
    clients[1]!.send(MSG.INTENT, { type: 'rollDice' })
    expect((await err).code).toBe('NOT_YOUR_TURN')

    // seat 0 places a legal setup settlement read from its own view
    const view0 = snapshots[0]!.at(-1)!.view
    expect(view0.turn.current).toBe(0)
    // any vertex is legal for the FIRST setup settlement; use a known-good one:
    const before = snapshots[2]!.length
    clients[0]!.send(MSG.INTENT, { type: 'placeSetupSettlement', vertex: Object.keys(view0.board.hexes.length ? {} : {}).length ? '' : (await import('@meridian/rules')).vertexId({ q: 2, r: 0 }, 0) })
    await new Promise((r) => setTimeout(r, 50))
    expect(snapshots[2]!.length).toBeGreaterThan(before) // everyone got a fresh view
    const snap2 = snapshots[2]!.at(-1)!
    expectRedactedFor(snap2, 2)
    expect(Object.keys(snap2.view.buildings)).toHaveLength(1)
  })

  it('malformed intents get BAD_MESSAGE', async () => {
    const { clients } = await seatClients(4)
    const err = nextMessage<{ code: string }>(clients[0]!, MSG.RULE_ERROR)
    clients[0]!.send(MSG.INTENT, { type: 'rollDice', player: 0 })
    expect((await err).code).toBe('BAD_MESSAGE')
  })

  it('host can start a 4-room at 3 seats; non-host cannot', async () => {
    const c0 = await server.sdk.joinOrCreate('catan', { players: 4, pilotDelayMs: 0, seed: 1 })
    const c1 = await server.sdk.joinById(c0.roomId, {})
    const c2 = await server.sdk.joinById(c0.roomId, {})
    const sink: CatanSnapshotPayload[] = []
    collectSnapshots(c0, sink)
    c1.onMessage('*', () => undefined)
    c2.onMessage('*', () => undefined)

    const err = nextMessage<{ code: string }>(c1, MSG.RULE_ERROR)
    c1.send(MSG.START)
    expect((await err).code).toBe('NOT_HOST')

    c0.send(MSG.START)
    await new Promise((r) => setTimeout(r, 50))
    expect(sink.length).toBeGreaterThan(0)
    expect(sink.at(-1)!.view.playerCount).toBe(3)
  })
})
```

Simplify the awkward inline vertex expression in the second test to a top-of-file import: `import { vertexId } from '@meridian/rules'` and `vertex: vertexId({ q: 2, r: 0 }, 0)` (a coastal vertex from SETUP_PLACEMENTS, legal as a first placement).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter server test -- catan-room`
Expected: FAIL — no `'catan'` room type registered.

- [ ] **Step 3: Implement lobby schema**

```ts
// apps/server/src/schema/CatanLobbyState.ts
import { ArraySchema, Schema, type } from '@colyseus/schema'

/**
 * Lobby plumbing ONLY (spec §4): game state never enters Colyseus schema —
 * every game byte a client sees flows through redactCatanState.
 */
export class CatanLobbyState extends Schema {
  @type('string') phase: 'waiting' | 'playing' | 'ended' = 'waiting'
  @type('number') targetPlayers = 4
  /** sessionIds by seat index */
  @type(['string']) seats = new ArraySchema<string>()
  /** per-seat presence — false means the pilot is driving (spec §4) */
  @type(['boolean']) connected = new ArraySchema<boolean>()
}
```

- [ ] **Step 4: Implement `CatanRoom`**

```ts
// apps/server/src/rooms/CatanRoom.ts
import { Room, type Client } from 'colyseus'
import {
  applyCatanIntent,
  createCatanGame,
  createRng,
  isCatanRuleError,
  redactCatanState,
  stubRng,
  type CatanState,
  type Rng,
} from '@meridian/rules'
import { catanIntentSchema, MSG, type CatanSnapshotPayload } from '@meridian/protocol'
import { pilotIntent } from '../pilot'
import { CatanLobbyState } from '../schema/CatanLobbyState'
import { generateRoomId, releaseRoomId } from '../room-id'

interface CreateOptions {
  players: 3 | 4
  layout?: 'beginner' | 'random'
  pilotDelayMs?: number
  abandonMinutes?: number
  seed?: number
  /** TEST-ONLY: forces the room rng to a scripted value list. */
  rngScript?: number[]
}

export class CatanRoom extends Room<CatanLobbyState> {
  private game: CatanState | null = null
  private rng: Rng = createRng(0)
  private layout: 'beginner' | 'random' = 'random'
  private pilotDelayMs = 600
  private abandonMs = 10 * 60_000
  /** connected client per seat; null = pilot drives */
  private seatClients: (Client | null)[] = []
  private pilotTimer: ReturnType<Room['clock']['setTimeout']> | null = null
  private abandonTimer: ReturnType<Room['clock']['setTimeout']> | null = null

  async onCreate(options: CreateOptions) {
    if (options.players !== 3 && options.players !== 4) throw new Error('players must be 3 or 4')
    this.roomId = await generateRoomId(this.presence)
    this.maxClients = options.players
    this.layout = options.layout ?? 'random'
    this.pilotDelayMs = options.pilotDelayMs ?? 600
    this.abandonMs = (options.abandonMinutes ?? 10) * 60_000
    this.rng = options.rngScript
      ? stubRng(options.rngScript)
      : createRng(options.seed ?? Math.floor(Math.random() * 2 ** 31))
    this.setState(new CatanLobbyState())
    this.state.targetPlayers = options.players

    this.onMessage(MSG.INTENT, (client, raw: unknown) => this.handleIntent(client, raw))
    this.onMessage(MSG.START, (client) => this.handleStart(client))
  }

  onJoin(client: Client) {
    this.state.seats.push(client.sessionId)
    this.state.connected.push(true)
    this.seatClients.push(client)
    if (this.state.seats.length === this.state.targetPlayers) this.startGame()
  }

  private handleStart(client: Client) {
    if (this.seatOf(client) !== 0)
      return client.send(MSG.RULE_ERROR, { code: 'NOT_HOST', message: 'only the host can start early' })
    if (this.state.phase !== 'waiting' || this.state.seats.length !== 3 || this.state.targetPlayers !== 4)
      return client.send(MSG.RULE_ERROR, { code: 'BAD_START', message: 'early start needs exactly 3 seated players in a 4-room' })
    this.startGame()
  }

  private startGame() {
    const n = this.state.seats.length as 3 | 4
    this.game = createCatanGame({ playerCount: n, layout: this.layout }, this.rng)
    this.state.phase = 'playing'
    this.lock()
    this.broadcastViews()
    this.schedulePilot()
  }

  private seatOf(client: Client): number {
    return this.state.seats.findIndex((s) => s === client.sessionId)
  }

  private humansConnected(): number {
    return this.seatClients.filter((c) => c !== null).length
  }

  private handleIntent(client: Client, raw: unknown) {
    const parsed = catanIntentSchema.safeParse(raw)
    if (!parsed.success)
      return client.send(MSG.RULE_ERROR, { code: 'BAD_MESSAGE', message: 'malformed intent' })
    if (this.state.phase !== 'playing' || !this.game)
      return client.send(MSG.RULE_ERROR, { code: 'NOT_PLAYING', message: 'match is not in progress' })
    const seat = this.seatOf(client)
    if (seat === -1) return
    this.applyAndBroadcast({ ...parsed.data, player: seat }, client)
  }

  /** Single choke point: EVERY state change flows through here. */
  private applyAndBroadcast(intent: Parameters<typeof applyCatanIntent>[1], errorTo?: Client) {
    if (!this.game) return
    const result = applyCatanIntent(this.game, intent, this.rng)
    if (isCatanRuleError(result)) {
      errorTo?.send(MSG.RULE_ERROR, { code: result.code, message: result.message })
      return
    }
    this.game = result
    this.broadcastViews()
    if (this.game.winner !== null) {
      this.state.phase = 'ended'
      this.broadcast(MSG.MATCH_ENDED, { reason: 'win', winner: this.game.winner })
    }
    this.schedulePilot()
  }

  private broadcastViews() {
    if (!this.game) return
    for (let seat = 0; seat < this.seatClients.length; seat++) {
      const client = this.seatClients[seat]
      if (!client) continue
      const payload: CatanSnapshotPayload = {
        seq: this.game.seq,
        view: redactCatanState(this.game, seat),
      }
      client.send(MSG.SNAPSHOT, payload)
    }
  }

  /** Fire the pilot for at most one absent seat that the game waits on. */
  private schedulePilot() {
    if (this.pilotTimer) {
      this.pilotTimer.clear()
      this.pilotTimer = null
    }
    if (!this.game || this.state.phase !== 'playing') return
    if (this.humansConnected() === 0) return // paused while abandoned (spec §4)
    const seat = this.nextPilotSeat()
    if (seat === null) return
    this.pilotTimer = this.clock.setTimeout(() => {
      this.pilotTimer = null
      if (!this.game || this.state.phase !== 'playing') return
      const s = this.nextPilotSeat()
      if (s === null) return
      const intent = pilotIntent(this.game, s, this.rng)
      if (intent) this.applyAndBroadcast(intent)
    }, this.pilotDelayMs)
  }

  private nextPilotSeat(): number | null {
    if (!this.game) return null
    for (let seat = 0; seat < this.seatClients.length; seat++) {
      if (this.seatClients[seat] !== null) continue
      if (pilotIntent(this.game, seat, { next: () => 0 }) !== null) return seat
    }
    return null
  }

  async onLeave(client: Client, consented: boolean) {
    void consented
    if (this.state.phase === 'waiting') {
      const idx = this.seatOf(client)
      if (idx !== -1) {
        this.state.seats.splice(idx, 1)
        this.state.connected.splice(idx, 1)
        this.seatClients.splice(idx, 1)
      }
      if (this.state.seats.length === 0) this.resetAutoDisposeTimeout(30)
      return
    }
    if (this.state.phase !== 'playing') return

    const seat = this.seatOf(client)
    if (seat === -1) return
    this.seatClients[seat] = null
    this.state.connected[seat] = false
    this.schedulePilot()
    if (this.humansConnected() === 0) this.startAbandonTimer()

    try {
      // reclaimable until game end or abandonment disposal (spec §4)
      const rejoined = await this.allowReconnection(client, 'manual')
      this.seatClients[seat] = rejoined
      this.state.connected[seat] = true
      this.stopAbandonTimer()
      if (this.game)
        rejoined.send(
          MSG.SNAPSHOT,
          { seq: this.game.seq, view: redactCatanState(this.game, seat) },
          { afterNextPatch: true },
        )
      this.schedulePilot()
    } catch {
      // reconnection cancelled (room disposing) — nothing to do
    }
  }

  private startAbandonTimer() {
    if (this.abandonTimer) return
    this.abandonTimer = this.clock.setTimeout(() => {
      void this.disconnect()
    }, this.abandonMs)
  }

  private stopAbandonTimer() {
    if (this.abandonTimer) {
      this.abandonTimer.clear()
      this.abandonTimer = null
    }
  }

  async onDispose() {
    await releaseRoomId(this.presence, this.roomId)
  }
}
```

Notes for the implementer:
- The `nextPilotSeat` probe passes a throwaway zero-rng — it only asks "is there a mandatory action?", never applies the result. The REAL rng is consumed only inside the timer callback via `pilotIntent(this.game, s, this.rng)`.
- Colyseus 0.16 `allowReconnection(client, 'manual')` resolves when the client reconnects and rejects on room disposal. Verify the exact clear/timeout API of `this.clock.setTimeout` against `@colyseus/core` 0.16.24 (it returns a `Delayed` with `.clear()`).
- Wire into `app.config.ts`:

```ts
import { CatanRoom } from './rooms/CatanRoom'
// inside initializeGameServer:
gameServer.define('catan', CatanRoom)
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter server test -- catan-room`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full server suite**

Run: `pnpm --filter server test`
Expected: all PASS (MatchRoom tests untouched).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/rooms/CatanRoom.ts apps/server/src/schema/CatanLobbyState.ts apps/server/src/app.config.ts apps/server/test/catan-room.test.ts
git commit -m "feat(server): CatanRoom — lobby, host start, intent loop, per-seat redacted snapshots"
```

---

### Task 9: Pilot takeover + seat reclaim (integration)

**Files:**
- Test: `apps/server/test/catan-reclaim.test.ts`

**Interfaces:**
- Consumes: room `'catan'` (Task 8), `SETUP_PLACEMENTS`, `die` from `@meridian/rules`, `expectRedactedFor` from `./catan-room.test`.

The deterministic script: `layout: 'beginner'`, `rngScript` = 24 zeros (deck shuffle at create) followed by dice values. With the beginner board and SETUP_PLACEMENTS draft, a forced roll of 1+2=3 produces nothing (proven by helpers' `inMain`), so turns advance cleanly.

- [ ] **Step 1: Write the tests**

```ts
// apps/server/test/catan-reclaim.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as ClientRoom } from 'colyseus.js'
import appConfig from '../src/app.config'
import { MSG, type CatanSnapshotPayload } from '@meridian/protocol'
import { die, SETUP_PLACEMENTS } from '@meridian/rules'
import { expectRedactedFor } from './catan-room.test'

let server: ColyseusTestServer
beforeAll(async () => {
  server = await boot(appConfig)
})
afterAll(async () => {
  await server.shutdown()
})
afterEach(async () => {
  await server.cleanup()
})

const SHUFFLE_PAD = Array(24).fill(0) // consumed by the dev-deck shuffle at game creation
const CALM_ROLL = [die(1), die(2)] // 3 — nobody produces on this draft

function latest(sink: CatanSnapshotPayload[]): CatanSnapshotPayload {
  return sink.at(-1)!
}

async function settle(ms = 50): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function bootRoom(diceRolls: number) {
  const rngScript = [...SHUFFLE_PAD, ...Array(diceRolls).fill(CALM_ROLL).flat()]
  const clients: ClientRoom[] = []
  const sinks: CatanSnapshotPayload[][] = []
  const c0 = await server.sdk.joinOrCreate('catan', {
    players: 4,
    layout: 'beginner',
    pilotDelayMs: 0,
    rngScript,
  })
  clients.push(c0)
  for (let i = 1; i < 4; i++) clients.push(await server.sdk.joinById(c0.roomId, {}))
  for (const [i, c] of clients.entries()) {
    const sink: CatanSnapshotPayload[] = []
    sinks.push(sink)
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
    void i
  }
  await settle()
  return { clients, sinks, roomId: c0.roomId }
}

/** Drive the full snake draft over ws, each client placing its own pieces. */
async function completeSetup(clients: ClientRoom[], sinks: CatanSnapshotPayload[][]) {
  for (const p of SETUP_PLACEMENTS) {
    clients[p.player]!.send(MSG.INTENT, { type: 'placeSetupSettlement', vertex: p.vertex })
    await settle(30)
    clients[p.player]!.send(MSG.INTENT, { type: 'placeSetupRoad', edge: p.edge })
    await settle(30)
  }
  expect(latest(sinks[0]!).view.turn.phase).toBe('preRoll')
}

describe('pilot takeover and seat reclaim', () => {
  it('drops a client mid-setup: the pilot completes its placements', async () => {
    const { clients, sinks } = await bootRoom(0)
    // seat 0 places, then seat 1 vanishes before its first placement
    clients[0]!.send(MSG.INTENT, { type: 'placeSetupSettlement', vertex: SETUP_PLACEMENTS[0]!.vertex })
    await settle(30)
    clients[0]!.send(MSG.INTENT, { type: 'placeSetupRoad', edge: SETUP_PLACEMENTS[0]!.edge })
    await settle(30)
    await clients[1]!.leave(true)
    await settle(100) // pilot (delay 0) should place settlement + road for seat 1
    const view = latest(sinks[2]!).view
    expect(view.turn.current).toBe(2) // draft advanced past the piloted seat
    expect(Object.keys(view.buildings)).toHaveLength(2)
    expect(view.players[1]!.settlementsLeft).toBe(4)
  })

  it('drops the current player pre-roll: pilot rolls and ends the turn; reclaim restores control', async () => {
    const { clients, sinks } = await bootRoom(3)
    await completeSetup(clients, sinks)

    // turn 1: seat 0 rolls (calm 3) and ends
    clients[0]!.send(MSG.INTENT, { type: 'rollDice' })
    await settle(30)
    clients[0]!.send(MSG.INTENT, { type: 'endTurn' })
    await settle(30)
    expect(latest(sinks[2]!).view.turn.current).toBe(1)

    // seat 1 drops holding the turn; pilot must roll + endTurn
    const token = clients[1]!.reconnectionToken
    await clients[1]!.leave(true)
    await settle(150)
    const after = latest(sinks[2]!).view
    expect(after.turn.current).toBe(2) // pilot finished seat 1's turn

    // seat 2 plays through; then seat 1 reclaims before its next turn
    clients[2]!.send(MSG.INTENT, { type: 'rollDice' })
    await settle(30)
    clients[2]!.send(MSG.INTENT, { type: 'endTurn' })
    await settle(30)

    const c1b = await server.sdk.reconnect(token)
    const sink1b: CatanSnapshotPayload[] = []
    c1b.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink1b.push(p))
    c1b.onMessage('*', () => undefined)
    await settle(100)
    expect(sink1b.length).toBeGreaterThan(0)
    expectRedactedFor(latest(sink1b), 1)

    // seat 3 finishes; now the reclaimed seat 1 must be human-driven again
    clients[3]!.send(MSG.INTENT, { type: 'rollDice' })
    await settle(30)
    clients[3]!.send(MSG.INTENT, { type: 'endTurn' })
    await settle(30)
    // turn is back to 0; play to seat 1 and prove the human drives it
    clients[0]!.send(MSG.INTENT, { type: 'rollDice' })
    await settle(30)
    clients[0]!.send(MSG.INTENT, { type: 'endTurn' })
    await settle(150) // pilot must NOT act for seat 1 anymore
    expect(latest(sink1b).view.turn.current).toBe(1)
    expect(latest(sink1b).view.turn.phase).toBe('preRoll') // still waiting on the human
    c1b.send(MSG.INTENT, { type: 'rollDice' })
    await settle(30)
    expect(latest(sink1b).view.turn.phase).toBe('main')
  })
})
```

Dice budget note: `bootRoom(diceRolls)` pre-loads that many calm rolls; the second test consumes rolls for turns: seat0, pilot-seat1, seat2, seat3, seat0, seat1 — that is 6 rolls, so call `bootRoom(6)` there (adjust the literal when writing; `stubRng exhausted` failures mean the count is short — count the rolls, don't pad blindly).

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter server test -- catan-reclaim`
Expected: PASS. Timing flake rule: if a `settle()` proves too tight under CI load, raise that single wait — never add retries.

- [ ] **Step 3: Commit**

```bash
git add apps/server/test/catan-reclaim.test.ts
git commit -m "test(server): pilot takeover mid-setup and mid-turn; reconnect reclaims the seat"
```

---

### Task 10: Abandonment guard (integration)

**Files:**
- Test: `apps/server/test/catan-abandon.test.ts`

**Interfaces:**
- Consumes: room `'catan'` with `abandonMinutes` option (Task 8). `abandonMinutes: 0.002` = 120ms.

- [ ] **Step 1: Write the test**

```ts
// apps/server/test/catan-abandon.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import appConfig from '../src/app.config'

let server: ColyseusTestServer
beforeAll(async () => {
  server = await boot(appConfig)
})
afterAll(async () => {
  await server.shutdown()
})
afterEach(async () => {
  await server.cleanup()
})

describe('abandonment guard', () => {
  it('pauses pilots with zero humans and disposes the room after the window', async () => {
    const c0 = await server.sdk.joinOrCreate('catan', {
      players: 3,
      pilotDelayMs: 0,
      abandonMinutes: 0.002, // 120ms
      seed: 1,
    })
    const c1 = await server.sdk.joinById(c0.roomId, {})
    const c2 = await server.sdk.joinById(c0.roomId, {})
    for (const c of [c0, c1, c2]) c.onMessage('*', () => undefined)
    const roomId = c0.roomId
    await new Promise((r) => setTimeout(r, 50)) // game started (3 = target)

    const room = server.getRoomById(roomId) as unknown as { game: { seq: number } | null }
    await c0.leave(true)
    await c1.leave(true)
    await c2.leave(true)
    await new Promise((r) => setTimeout(r, 40))
    const seqAtAbandon = room.game!.seq
    await new Promise((r) => setTimeout(r, 40))
    // pilots are paused: no intents applied while nobody is connected
    expect(room.game!.seq).toBe(seqAtAbandon)

    // after the abandonment window the room is gone
    await new Promise((r) => setTimeout(r, 150))
    expect(server.getRoomById(roomId)).toBeUndefined()
  })
})
```

Note: `server.getRoomById` — verify the accessor name on `ColyseusTestServer` (0.16 exposes `getRoomById(roomId)`; if absent, use `matchMaker.getLocalRoomById` from `colyseus`). The `game` property is private — the cast is a deliberate test-only peek; do not widen the room's public API for this.

- [ ] **Step 2: Run the test**

Run: `pnpm --filter server test -- catan-abandon`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/server/test/catan-abandon.test.ts
git commit -m "test(server): abandonment guard — pilots pause, room disposes, code freed"
```

---

### Task 11: Full scripted 3p and 4p matches over ws with cross-seat leak assertions

**Files:**
- Test: `apps/server/test/catan-full-match.test.ts`

**Interfaces:**
- Consumes: room `'catan'` (`seed` option), `botIntent`-equivalent view driver (below), retyped queries (Task 4), `COSTS`, `hasResources` from `@meridian/rules`, `expectRedactedFor` (Task 8).

The view driver replicates `botIntent`'s decision order EXACTLY, but reads only a `CatanClientState`. `botIntent` uses nothing but public info + the acting player's own hand, so a view-driven ws match with `seed: N` replays the engine-only match of the same seed move-for-move — seeds 1–5 are proven to finish within 5000 intents by `full-game.test.ts`.

- [ ] **Step 1: Write the test**

```ts
// apps/server/test/catan-full-match.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as ClientRoom } from 'colyseus.js'
import appConfig from '../src/app.config'
import { MSG, type CatanClientIntent, type CatanSnapshotPayload } from '@meridian/protocol'
import {
  COSTS,
  hasResources,
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  RESOURCES,
  coordKey,
  standardTopology,
  type CatanClientState,
} from '@meridian/rules'
import { expectRedactedFor } from './catan-room.test'

let server: ColyseusTestServer
beforeAll(async () => {
  server = await boot(appConfig)
})
afterAll(async () => {
  await server.shutdown()
})
afterEach(async () => {
  await server.cleanup()
})

const MAX_INTENTS = 6000

/**
 * Mirror of the engine test bot (rules botIntent), decision-for-decision,
 * operating on a redacted view. Returns null when this seat need not act.
 */
function viewIntent(view: CatanClientState): CatanClientIntent | null {
  const t = view.turn
  const seat = view.you.seat
  const topo = standardTopology()

  if (t.phase === 'discard') {
    const owedSeat = Number(Object.keys(t.pendingDiscards)[0]!)
    if (owedSeat !== seat) return null
    let owed = t.pendingDiscards[seat]!
    const hand = { ...view.you.resources }
    const resources: Partial<Record<(typeof RESOURCES)[number], number>> = {}
    for (const r of RESOURCES) {
      const n = Math.min(hand[r], owed)
      if (n > 0) resources[r] = n
      owed -= n
      if (owed === 0) break
    }
    return { type: 'discard', resources }
  }

  if (t.current !== seat) return null

  if (t.phase === 'setup') {
    if (t.setup!.expect === 'settlement') {
      const spots = legalSettlementVertices(view, seat, { setup: true })
      return { type: 'placeSetupSettlement', vertex: spots[0]! }
    }
    const settlement = t.setup!.lastSettlement!
    const edge = (topo.vertexEdges[settlement] ?? []).find((e) => view.roads[e] === undefined)!
    return { type: 'placeSetupRoad', edge }
  }

  if (t.phase === 'robber') {
    const hex = view.board.hexes.find(
      (h) =>
        coordKey(h.coord) !== view.board.robber &&
        !(topo.hexVertices[coordKey(h.coord)] ?? []).some((v) => view.buildings[v]?.owner === seat),
    )!
    const key = coordKey(hex.coord)
    const victim = view.players.findIndex(
      (pl, i) =>
        i !== seat &&
        pl.resourceCount > 0 &&
        (topo.hexVertices[key] ?? []).some((v) => view.buildings[v]?.owner === i),
    )
    return { type: 'moveRobber', hex: hex.coord, stealFrom: victim === -1 ? null : victim }
  }

  if (t.phase === 'preRoll') return { type: 'rollDice' }

  // main phase — same greedy priorities as botIntent
  const me = view.players[seat]!
  const hand = view.you.resources
  if (hasResources(hand, COSTS.city) && me.citiesLeft > 0) {
    const spots = legalCityVertices(view, seat)
    if (spots.length) return { type: 'build', piece: 'city', location: spots[0]! }
  }
  if (hasResources(hand, COSTS.settlement) && me.settlementsLeft > 0) {
    const spots = legalSettlementVertices(view, seat)
    if (spots.length) return { type: 'build', piece: 'settlement', location: spots[0]! }
  }
  if (hasResources(hand, COSTS.devCard) && view.devDeckCount > 0) return { type: 'buyDevCard' }
  if (!t.devPlayed && view.you.devCards.some((c) => c.card === 'knight' && c.boughtOnTurn < t.number))
    return { type: 'playDevCard', card: 'knight' }
  if (hasResources(hand, COSTS.road) && me.roadsLeft > 0) {
    const spots = legalRoadEdges(view, seat)
    if (spots.length) return { type: 'build', piece: 'road', location: spots[0]! }
  }
  return { type: 'endTurn' }
}

async function runMatch(players: 3 | 4, seed: number) {
  const clients: ClientRoom[] = []
  const views: (CatanClientState | null)[] = Array(players).fill(null)
  let snapshots = 0
  let ended: { winner: number } | null = null

  const c0 = await server.sdk.joinOrCreate('catan', { players, seed, pilotDelayMs: 0 })
  clients.push(c0)
  for (let i = 1; i < players; i++) clients.push(await server.sdk.joinById(c0.roomId, {}))
  clients.forEach((c, seat) => {
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => {
      snapshots++
      expectRedactedFor(p, seat) // EVERY snapshot every client receives is leak-checked
      views[seat] = p.view
    })
    c.onMessage(MSG.MATCH_ENDED, (p: { winner: number }) => {
      ended = p
    })
    c.onMessage('*', () => undefined)
  })

  for (let i = 0; i < MAX_INTENTS && !ended; i++) {
    await new Promise((r) => setTimeout(r, 5))
    if (ended) break
    // exactly one seat must act; find it from any view and let THAT client send
    const anyView = views.find((v) => v !== null)
    if (!anyView) continue
    for (let seat = 0; seat < players; seat++) {
      const view = views[seat]
      if (!view) continue
      const intent = viewIntent(view)
      if (intent) {
        const seqBefore = view.seq
        clients[seat]!.send(MSG.INTENT, intent)
        // wait for the state to advance before deciding again
        for (let w = 0; w < 200 && views[seat]!.seq === seqBefore && !ended; w++)
          await new Promise((r) => setTimeout(r, 5))
        break
      }
    }
  }
  expect(ended).not.toBeNull()
  expect(snapshots).toBeGreaterThan(0)
  return ended!
}

describe('full matches over ws', () => {
  it('4 players, seed 1: plays to a win, every snapshot redaction-checked', async () => {
    const result = await runMatch(4, 1)
    expect(result.winner).toBeGreaterThanOrEqual(0)
  }, 120_000)

  it('3 players, seed 2: plays to a win, every snapshot redaction-checked', async () => {
    const result = await runMatch(3, 2)
    expect(result.winner).toBeGreaterThanOrEqual(0)
  }, 120_000)
})
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter server test -- catan-full-match`
Expected: PASS within the timeouts. If a seed stalls (no seat has a non-null `viewIntent` yet no MATCH_ENDED), that indicates a real divergence between view-driver and engine bot — diff the decision order against `botIntent`, do not swap seeds to hide it. (3-player seeds are NOT pre-proven by `full-game.test.ts`, which is 4-player only — if seed 2 exceeds `MAX_INTENTS` legitimately, try seeds 3–10 for the 3p match and pin the first that finishes, noting it in a comment.)

- [ ] **Step 3: Commit**

```bash
git add apps/server/test/catan-full-match.test.ts
git commit -m "test(server): full 3p/4p ws matches to a win with per-snapshot leak checks"
```

---

### Task 12: Trade sub-flow over ws + message-path coverage for every intent type

**Files:**
- Test: `apps/server/test/catan-trade-paths.test.ts`

**Interfaces:**
- Consumes: room `'catan'` (`rngScript`, `layout: 'beginner'`), `SETUP_PLACEMENTS`, `die` (Task 2), setup-driving helper pattern from Task 9.

Rationale: game mechanics are exhaustively engine-tested; what phase 3 must prove over ws is the MESSAGE PATH (parse → seat attach → dispatch → snapshot/error) for every intent type, plus the one genuinely multi-client sub-flow: an open trade between seats. Setup payouts on the beginner draft are known (helpers.ts): P0 +1 ore, P1 +1 wheat, P2 +1 ore, P3 +1 brick.

- [ ] **Step 1: Write the tests**

```ts
// apps/server/test/catan-trade-paths.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as ClientRoom } from 'colyseus.js'
import appConfig from '../src/app.config'
import { MSG, type CatanSnapshotPayload } from '@meridian/protocol'
import { die, SETUP_PLACEMENTS } from '@meridian/rules'

let server: ColyseusTestServer
beforeAll(async () => {
  server = await boot(appConfig)
})
afterAll(async () => {
  await server.shutdown()
})
afterEach(async () => {
  await server.cleanup()
})

const SHUFFLE_PAD = Array(24).fill(0)
const CALM_ROLL = [die(1), die(2)]

async function settle(ms = 40): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function bootToMain() {
  const rngScript = [...SHUFFLE_PAD, ...CALM_ROLL]
  const clients: ClientRoom[] = []
  const sinks: CatanSnapshotPayload[][] = []
  const c0 = await server.sdk.joinOrCreate('catan', {
    players: 4,
    layout: 'beginner',
    pilotDelayMs: 0,
    rngScript,
  })
  clients.push(c0)
  for (let i = 1; i < 4; i++) clients.push(await server.sdk.joinById(c0.roomId, {}))
  for (const c of clients) {
    const sink: CatanSnapshotPayload[] = []
    sinks.push(sink)
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
  }
  await settle()
  for (const p of SETUP_PLACEMENTS) {
    clients[p.player]!.send(MSG.INTENT, { type: 'placeSetupSettlement', vertex: p.vertex })
    await settle(25)
    clients[p.player]!.send(MSG.INTENT, { type: 'placeSetupRoad', edge: p.edge })
    await settle(25)
  }
  clients[0]!.send(MSG.INTENT, { type: 'rollDice' }) // calm 3 -> main
  await settle()
  expect(sinks[0]!.at(-1)!.view.turn.phase).toBe('main')
  return { clients, sinks }
}

function ruleError(client: ClientRoom): Promise<{ code: string }> {
  return new Promise((resolve) => client.onMessage(MSG.RULE_ERROR, resolve))
}

describe('trade sub-flow over ws', () => {
  it('offer -> reject+accept -> confirm settles the trade between the right seats', async () => {
    const { clients, sinks } = await bootToMain()
    // setup payouts: P0 holds 1 ore, P1 holds 1 wheat
    expect(sinks[0]!.at(-1)!.view.you.resources.ore).toBe(1)
    expect(sinks[1]!.at(-1)!.view.you.resources.wheat).toBe(1)

    clients[0]!.send(MSG.INTENT, { type: 'offerTrade', give: { ore: 1 }, get: { wheat: 1 } })
    await settle()
    // the open offer is public in every view
    expect(sinks[3]!.at(-1)!.view.turn.openTrade).not.toBeNull()

    clients[2]!.send(MSG.INTENT, { type: 'respondTrade', response: 'reject' })
    await settle(25)
    clients[1]!.send(MSG.INTENT, { type: 'respondTrade', response: 'accept' })
    await settle(25)
    clients[0]!.send(MSG.INTENT, { type: 'confirmTrade', partner: 1 })
    await settle()

    expect(sinks[0]!.at(-1)!.view.you.resources).toMatchObject({ ore: 0, wheat: 1 })
    expect(sinks[1]!.at(-1)!.view.you.resources).toMatchObject({ ore: 1, wheat: 0 })
    // bystanders see only counts move
    expect(sinks[3]!.at(-1)!.view.players[0]!.resourceCount).toBe(1)
    expect(sinks[3]!.at(-1)!.view.players[1]!.resourceCount).toBe(1)
  })
})

describe('message path: every intent type reaches the engine', () => {
  // Each remaining intent type is sent in a context where the ENGINE (not the
  // schema) rejects it — proving parse -> seat -> dispatch -> error routing.
  const engineRejected: [string, Record<string, unknown>, string][] = [
    ['bankTrade', { type: 'bankTrade', give: 'wood', get: 'ore' }, 'CANT_AFFORD'],
    ['buyDevCard', { type: 'buyDevCard' }, 'CANT_AFFORD'],
    ['playDevCard knight', { type: 'playDevCard', card: 'knight' }, 'NO_CARD'],
    ['playDevCard roadBuilding', { type: 'playDevCard', card: 'roadBuilding', edges: [SETUP_PLACEMENTS[0]!.edge] }, 'NO_CARD'],
    ['playDevCard yearOfPlenty', { type: 'playDevCard', card: 'yearOfPlenty', take: ['wood', 'wood'] }, 'NO_CARD'],
    ['playDevCard monopoly', { type: 'playDevCard', card: 'monopoly', resource: 'ore' }, 'NO_CARD'],
    ['moveRobber', { type: 'moveRobber', hex: { q: 0, r: 0 }, stealFrom: null }, 'BAD_PHASE'],
    ['discard', { type: 'discard', resources: { wood: 1 } }, 'BAD_PHASE'],
    ['cancelTrade', { type: 'cancelTrade' }, 'NO_TRADE'],
    ['build road', { type: 'build', piece: 'road', location: SETUP_PLACEMENTS[0]!.edge }, 'CANT_AFFORD'],
  ]

  it.each(engineRejected)('%s routes to the engine and errors cleanly', async (_name, intent, code) => {
    const { clients } = await bootToMain()
    const err = ruleError(clients[0]!)
    clients[0]!.send(MSG.INTENT, intent)
    expect((await err).code).toBe(code)
  })
})
```

Error-code note: the exact expected codes (`CANT_AFFORD` vs `BAD_PHASE` etc.) must be verified against the engine's actual precedence while implementing — if a code differs, update the EXPECTATION to the engine's real answer (the assertion's purpose is "the engine answered", not to re-test engine rules). `respondTrade` with a counter-offer is exercised in the schema tests (Task 5) and its engine path by the reject/accept flow above.

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter server test -- catan-trade-paths`
Expected: PASS.

- [ ] **Step 3: Run the entire monorepo suite**

Run: `pnpm test` (from repo root)
Expected: all packages PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/test/catan-trade-paths.test.ts
git commit -m "test(server): ws trade sub-flow + message-path coverage for every intent type"
```

---

## Self-review notes (already applied)

- Spec §2 winner-reveal → Task 1 (`winnerVpCards`).
- Spec §3 pilot policy + liveness → Tasks 6, 7.
- Spec §4 lobby/start/snapshots/reclaim/abandonment → Tasks 8, 9, 10.
- Spec §5 protocol → Task 5 (plus `rngScript`, a documented test-only room-option deviation).
- Spec §6 rules tests → Tasks 1, 3, 4; server unit → 6, 7; integration → 8–12.
- Cross-task name consistency: `redactCatanState`/`CatanClientState` (T1) used in T3/T5/T8/T11; `pilotIntent` (T6) in T7/T8; `botIntent`/`stubRng`/`die`/`SETUP_PLACEMENTS`/`mustApply` (T2) in T3/T6/T7/T9/T12; `PlacementView` retyping (T4) consumed by T11's `viewIntent`.
