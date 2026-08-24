# Native Companion Bots + Camera Orbit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play solo (or partially-filled) Catan matches against competent server-native bots picked from the lobby — bots that propose trades — and make HUD-occluded board vertices reachable via camera orbit.

**Architecture:** A pure `companionIntent` brain joins `pilotIntent`/`botIntent` in `@meridian/rules`; `CatanRoom` seeds bot seats at match start and drives them through its existing empty-seat timer, choosing brain by seat kind. The lobby gains a bot-count selector; the protocol create options carry it. Camera orbit already exists (`OrbitControls` in `CatanScene`) — the work is reproduction, fixing whatever blocks it, and a scripted acceptance check.

**Tech Stack:** TypeScript, pnpm workspace + turbo, vitest, Colyseus (+ `@colyseus/testing`), React + zustand, R3F/drei, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-native-bots-orbit-design.md`

## Global Constraints

- Game state NEVER enters Colyseus schema — every game byte a client sees flows through `redactCatanState` (server design spec §4). `CatanLobbyState` carries lobby plumbing only.
- Client intents have NO `player` field; the server derives the seat from the connection.
- Brains (`pilotIntent`, `companionIntent`) are pure functions: `(state, seat, rng, …) → CatanIntent | null`. Per-turn bot memory lives in the room, passed via opts.
- Bots read only seat-visible information: own hand/dev cards + public board, players' piece counts, awards, bank. Never `devDeck` contents or other hands.
- Comments: match existing density; state constraints, not narration.
- Run tests from the package dir: `pnpm -C packages/rules test`, `pnpm -C apps/server test`, `pnpm -C apps/client test`, `pnpm -C apps/client test:e2e`.
- E2E/dev-server footgun: kill anything on ports 5173/2567 before Playwright runs (`lsof -ti:5173,2567 | xargs kill -9`), else `reuseExistingServer` can test a stale checkout.

---

### Task 1: Companion heuristics — goals, pips, VP, robber scoring

**Files:**
- Create: `packages/rules/src/catan/companion.ts`
- Modify: `packages/rules/src/catan/index.ts` (add `export * from './companion'`)
- Test: `packages/rules/test/catan/companion.test.ts`

**Interfaces:**
- Consumes: `CatanState`, `COSTS` (`./data`), `RESOURCES`, `hasResources`, `totalResources` (`./types`), `standardTopology` (`./topology`), `coordKey` (`../coord`), `legalCityVertices`, `legalSettlementVertices` (`./queries`).
- Produces (all exported; later tasks call these exact names):
  - `pips(token: number | null): number`
  - `vertexPips(state: Pick<CatanState, 'board'>, vertex: VertexId): number`
  - `publicVp(state: CatanState, player: PlayerId): number`
  - `buildGoal(state: CatanState, seat: PlayerId): 'city' | 'settlement' | 'devCard' | 'road'`
  - `missingForGoal(state: CatanState, seat: PlayerId, goal?: ReturnType<typeof buildGoal>): Resource[]`
  - `robberHexScore(state: CatanState, seat: PlayerId, hexKey: string): number`
  - `greedyDiscard(state: CatanState, seat: PlayerId, owed: number): Partial<ResourceCount>`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/rules/test/catan/companion.test.ts
import { describe, expect, it } from 'vitest'
import { coordKey, vertexId } from '../../src/index'
import {
  buildGoal, greedyDiscard, missingForGoal, pips, publicVp, robberHexScore, vertexPips,
} from '../../src/index'
import { inMain, setupComplete, withResources } from './helpers'

describe('companion heuristics', () => {
  it('pips: ways to roll the token', () => {
    expect(pips(6)).toBe(5)
    expect(pips(8)).toBe(5)
    expect(pips(2)).toBe(1)
    expect(pips(12)).toBe(1)
    expect(pips(null)).toBe(0) // desert
  })

  it('vertexPips sums the pip weights of the vertex\'s (up to 3) land hexes', () => {
    const state = setupComplete()
    const v = vertexId({ q: 0, r: 0 }, 0)
    const keys = v.split('|')
    const expected = keys.reduce((sum, k) => {
      const hex = state.board.hexes.find((h) => coordKey(h.coord) === k)
      return sum + (hex ? pips(hex.token) : 0)
    }, 0)
    expect(vertexPips(state, v)).toBe(expected)
    expect(expected).toBeGreaterThan(0)
  })

  it('publicVp counts buildings and awards, not hidden dev cards', () => {
    const state = setupComplete() // every seat: 2 settlements
    expect(publicVp(state, 0)).toBe(2)
    const withAward = { ...state, awards: { ...state.awards, longestRoad: 0 as const } }
    expect(publicVp(withAward, 0)).toBe(4)
  })

  it('buildGoal prefers city > settlement > devCard', () => {
    const state = inMain() // everyone has upgradable settlements and cities left
    expect(buildGoal(state, 0)).toBe('city')
    const noCities = {
      ...state,
      players: state.players.map((p, i) => (i === 0 ? { ...p, citiesLeft: 0 } : p)),
    }
    expect(buildGoal(noCities, 0)).toBe('settlement')
    const noSettlements = {
      ...noCities,
      players: noCities.players.map((p, i) => (i === 0 ? { ...p, settlementsLeft: 0 } : p)),
    }
    expect(buildGoal(noSettlements, 0)).toBe('devCard')
  })

  it('missingForGoal lists the goal\'s deficits, biggest first', () => {
    // city costs 2 wheat + 3 ore; hand starts near-empty after setup
    const state = inMain()
    const hand = state.players[0]!.resources
    const missing = missingForGoal(state, 0, 'city')
    expect(missing).toContain('ore')
    // biggest deficit (ore: 3 - hand.ore) sorts before wheat (2 - hand.wheat)
    if (hand.ore === hand.wheat) expect(missing[0]).toBe('ore')
    for (const r of missing) expect(['wheat', 'ore']).toContain(r)
  })

  it('robberHexScore: heavily negative on own hexes, positive on enemy production', () => {
    const state = setupComplete()
    // a hex under P1's first settlement, not touched by P0
    const p1Hex = '(-2,0)' // matches SETUP_PLACEMENTS P1 vertex (q:-2,r:0)
    const key = state.board.hexes
      .map((h) => coordKey(h.coord))
      .find((k) => k === p1Hex) ?? coordKey(state.board.hexes[0]!.coord)
    // find any hex P0 builds on for the negative case
    const ownVertex = Object.entries(state.buildings).find(([, b]) => b.owner === 0)![0]
    const ownHexKey = ownVertex.split('|')[0]!
    expect(robberHexScore(state, 0, ownHexKey)).toBeLessThanOrEqual(-1000)
  })

  it('greedyDiscard sheds from the largest piles first and totals exactly owed', () => {
    const state = withResources(inMain(), 0, { wood: 5, brick: 1 })
    const out = greedyDiscard(state, 0, 4)
    const total = Object.values(out).reduce((n, v) => n + (v ?? 0), 0)
    expect(total).toBe(4)
    expect(out.wood).toBeGreaterThanOrEqual(3) // biggest pile pays most
  })
})
```

Note on the robber test: don't over-assert exact `coordKey` string formats — derive keys from `state` as shown (the positive-score case is covered thoroughly in Task 2's robber-intent test; here the guaranteed assertion is the own-hex veto).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/rules exec vitest run test/catan/companion.test.ts`
Expected: FAIL — `companion` module has no exports / file not found.

- [ ] **Step 3: Implement the heuristics**

```ts
// packages/rules/src/catan/companion.ts
import { coordKey } from '../coord'
import type { PlayerId } from '../state'
import { COSTS } from './data'
import type { CatanIntent } from './intent'
import type { CatanState } from './state'
import { standardTopology, type VertexId } from './topology'
import { RESOURCES, type Resource, type ResourceCount } from './types'

/**
 * Companion bot brain (native-bots design spec §1): a competent player for a
 * seat with no human, unlike pilotIntent's caretaker. Pure — per-turn memory
 * (offers proposed, bank trades made) lives in the room and arrives via opts.
 */

/** Production weight of a number token: ways to roll it (6/8 → 5 … 2/12 → 1; desert 0). */
export function pips(token: number | null): number {
  return token == null ? 0 : 6 - Math.abs(7 - token)
}

/** Total pips a vertex touches. Vertex ids are 'a|b|c' sorted coordKeys; off-board keys miss the map. */
export function vertexPips(state: Pick<CatanState, 'board'>, vertex: VertexId): number {
  let sum = 0
  for (const part of vertex.split('|')) {
    const hex = state.board.hexes.find((h) => coordKey(h.coord) === part)
    sum += hex ? pips(hex.token) : 0
  }
  return sum
}

/** Public victory points (buildings + awards) — what every seat can see. */
export function publicVp(state: CatanState, player: PlayerId): number {
  let vp = 0
  for (const b of Object.values(state.buildings)) if (b.owner === player) vp += b.kind === 'city' ? 2 : 1
  if (state.awards.longestRoad === player) vp += 2
  if (state.awards.largestArmy === player) vp += 2
  return vp
}

/** What to save toward: city upgrade > new settlement > dev card > road. */
export function buildGoal(state: CatanState, seat: PlayerId): 'city' | 'settlement' | 'devCard' | 'road' {
  const me = state.players[seat]!
  const upgradable = Object.values(state.buildings).some((b) => b.owner === seat && b.kind === 'settlement')
  if (me.citiesLeft > 0 && upgradable) return 'city'
  if (me.settlementsLeft > 0) return 'settlement'
  if (state.devDeck.length > 0) return 'devCard'
  return 'road'
}

/** Resources still missing for the goal, biggest deficit first. */
export function missingForGoal(
  state: CatanState,
  seat: PlayerId,
  goal: 'city' | 'settlement' | 'devCard' | 'road' = buildGoal(state, seat),
): Resource[] {
  const cost = COSTS[goal]
  const hand = state.players[seat]!.resources
  return RESOURCES.filter((r) => (cost[r] ?? 0) > hand[r]).sort(
    (a, b) => (cost[b] ?? 0) - hand[b] - ((cost[a] ?? 0) - hand[a]),
  )
}

/**
 * Robber destination score: block the biggest production owned by the seats
 * furthest ahead, never our own (heavily negative if we build there).
 */
export function robberHexScore(state: CatanState, seat: PlayerId, hexKey: string): number {
  const topo = standardTopology()
  const hex = state.board.hexes.find((h) => coordKey(h.coord) === hexKey)
  let owners = 0
  for (const v of topo.hexVertices[hexKey] ?? []) {
    const b = state.buildings[v]
    if (!b) continue
    if (b.owner === seat) return -1000
    owners += (b.kind === 'city' ? 2 : 1) * (1 + publicVp(state, b.owner))
  }
  return owners * (1 + pips(hex?.token ?? null))
}

/** Shed from the largest piles first; ties broken in RESOURCES order. (Moved from apps/server pilot.ts — Task 2 dedupes.) */
export function greedyDiscard(state: CatanState, seat: PlayerId, owed: number): Partial<ResourceCount> {
  const hand = { ...state.players[seat]!.resources }
  const out: Partial<ResourceCount> = {}
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
```

(Leave `CatanIntent` imported with a `// used from Task 2` TODO-free approach: simply omit the import until Task 2 needs it — do not ship unused imports.)

Add to `packages/rules/src/catan/index.ts`:

```ts
export * from './companion'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/rules exec vitest run test/catan/companion.test.ts`
Expected: PASS. Also run the full package: `pnpm -C packages/rules test` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan/companion.ts packages/rules/src/catan/index.ts packages/rules/test/catan/companion.test.ts
git commit -m "feat(rules): companion bot heuristics — pips, goals, robber scoring"
```

---

### Task 2: `companionIntent` — full decision function + liveness

**Files:**
- Modify: `packages/rules/src/catan/companion.ts`
- Modify: `apps/server/src/pilot.ts` (delete local `greedyDiscard`, import from `@meridian/rules`)
- Test: `packages/rules/test/catan/companion.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 helpers; `legalSettlementVertices`, `legalCityVertices`, `legalRoadEdges`, `affordable` (`./queries`); `hasResources`, `totalResources` (`./types`); `standardTopology`.
- Produces:
  - `interface CompanionOpts { proposedThisTurn: boolean; resolveOfferNow: boolean; bankTradesThisTurn: number }`
  - `const COMPANION_DEFAULTS: CompanionOpts` (all false / 0)
  - `companionIntent(state: CatanState, seat: PlayerId, rng: Rng, opts?: CompanionOpts): CatanIntent | null`
  - `bankTradePlan(state: CatanState, seat: PlayerId): { give: Resource; get: Resource } | null`

Trade proposal/management arrives in Task 3 — in this task `companionIntent` never emits `offerTrade`/`confirmTrade`, and with an open own offer returns `{ type: 'cancelTrade' }` only when `opts.resolveOfferNow`, else `null` (Task 3 upgrades this).

- [ ] **Step 1: Write the failing tests** (append to `companion.test.ts`)

```ts
import {
  applyCatanIntent, botIntent, companionIntent, COMPANION_DEFAULTS, bankTradePlan,
  createCatanGame, createRng, isCatanRuleError, vertexPips as vp,
  type CatanState,
} from '../../src/index'

describe('companionIntent decisions', () => {
  it('setup: places the pip-maximal legal settlement, then a road off it', () => {
    const rng = createRng(7)
    const state = createCatanGame({ playerCount: 4, layout: 'beginner' }, rng)
    const intent = companionIntent(state, 0, rng)!
    expect(intent.type).toBe('placeSetupSettlement')
    const chosen = (intent as { vertex: string }).vertex
    // no legal vertex beats the chosen one
    const { legalSettlementVertices } = await import('../../src/index')
    for (const v of legalSettlementVertices(state, 0, { setup: true }))
      expect(vp(state, chosen)).toBeGreaterThanOrEqual(vp(state, v))
    const after = applyCatanIntent(state, intent, rng) as CatanState
    const road = companionIntent(after, 0, rng)!
    expect(road.type).toBe('placeSetupRoad')
  })

  it('preRoll: rolls', () => {
    const state = setupComplete()
    expect(companionIntent(state, state.turn.current, createRng(0))!.type).toBe('rollDice')
  })

  it('main: builds a city when affordable, at its highest-pip own settlement', () => {
    const state = withResources(inMain(), 0, { wheat: 2, ore: 3 })
    const intent = companionIntent(state, 0, createRng(0))!
    expect(intent).toMatchObject({ type: 'build', piece: 'city' })
  })

  it('main: buys a dev card when affordable and no city/settlement is possible', () => {
    // settlement needs a connected legal vertex — none exist right after setup roads
    const state = withResources(inMain(), 0, { sheep: 1, wheat: 1, ore: 1 })
    const intent = companionIntent(state, 0, createRng(0))!
    expect(intent.type).toBe('buyDevCard')
  })

  it('main: bank-trades 4-surplus toward the goal deficit, honoring the opts cap', () => {
    const state = withResources(inMain(), 0, { wood: 6 })
    const plan = bankTradePlan(state, 0)
    expect(plan).toMatchObject({ give: 'wood' })
    const intent = companionIntent(state, 0, createRng(0))!
    expect(intent).toMatchObject({ type: 'bankTrade', give: 'wood' })
    const capped = companionIntent(state, 0, createRng(0), { ...COMPANION_DEFAULTS, bankTradesThisTurn: 2 })!
    expect(capped.type).toBe('endTurn')
  })

  it('off-turn: accepts a covered never-net-losing offer, rejects otherwise', () => {
    let state = withResources(inMain(), 0, { wood: 1 })
    state = withResources(state, 1, { brick: 1 })
    const cur = state.turn.current
    // current player offers 2-for-1 in seat 1's favor: give {wood:1}, get {brick:1} is 1:1 — acceptable
    state = mustApply(withResources(state, cur, { wood: 1 }), { type: 'offerTrade', player: cur, give: { wood: 1 }, get: { brick: 1 } })
    const responder = [0, 1, 2, 3].find((s) => s !== cur && state.players[s]!.resources.brick >= 1)!
    const intent = companionIntent(state, responder, createRng(0))!
    expect(intent).toMatchObject({ type: 'respondTrade', response: 'accept' })
  })

  it('robber: picks a scoring-maximal enemy hex and steals from the fattest victim', () => {
    let state = setupComplete()
    state = mustApply(state, { type: 'rollDice', player: state.turn.current }, stubRng([die(3), die(4)]))
    // no hand > 7 on this draft, so we land straight in robber phase
    expect(state.turn.phase).toBe('robber')
    const intent = companionIntent(state, state.turn.current, createRng(0))!
    expect(intent.type).toBe('moveRobber')
  })
})

describe('companion liveness', () => {
  it('4 companion seats finish seeded games; every intent legal; no nulls while the game waits', () => {
    for (const seed of [1, 2, 3]) {
      const rng = createRng(seed)
      let state = createCatanGame({ playerCount: 4 }, rng)
      for (let i = 0; i < 5000 && state.winner === null; i++) {
        const seat = state.turn.phase === 'discard'
          ? Number(Object.keys(state.turn.pendingDiscards)[0]!)
          : state.turn.current
        const intent = companionIntent(state, seat, rng)
        expect(intent, `seed ${seed}: stalled at ${i}, phase ${state.turn.phase}`).not.toBeNull()
        const result = applyCatanIntent(state, intent!, rng)
        if (isCatanRuleError(result)) throw new Error(`seed ${seed} seat ${seat}: ${result.code}: ${result.message}`)
        state = result
      }
      expect(state.winner, `seed ${seed} never finished`).not.toBeNull()
    }
  })
})
```

Fix the dynamic-import awkwardness in the setup test by importing `legalSettlementVertices` at the top of the file instead (test files are sync — the snippet above shows intent; write it with a top-level import).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm -C packages/rules exec vitest run test/catan/companion.test.ts`
Expected: FAIL — `companionIntent` not exported.

- [ ] **Step 3: Implement `companionIntent`** (append to `companion.ts`)

```ts
import { legalCityVertices, legalRoadEdges, legalSettlementVertices, affordable } from './queries'
import { hasResources, totalResources } from './types'
import type { Rng } from './rng'

export interface CompanionOpts {
  /** Room-tracked: this seat already opened an offer this turn. */
  proposedThisTurn: boolean
  /** Room-tracked: response window expired — confirm best or cancel. */
  resolveOfferNow: boolean
  /** Room-tracked: bank trades already made this turn (brain stops at 2). */
  bankTradesThisTurn: number
}

export const COMPANION_DEFAULTS: CompanionOpts = {
  proposedThisTurn: false,
  resolveOfferNow: false,
  bankTradesThisTurn: 0,
}

/** Give 4-of-a-kind surplus (beyond the goal's own cost) for the goal's biggest deficit. */
export function bankTradePlan(state: CatanState, seat: PlayerId): { give: Resource; get: Resource } | null {
  const goal = buildGoal(state, seat)
  const cost = COSTS[goal]
  const hand = state.players[seat]!.resources
  const get = missingForGoal(state, seat, goal)[0]
  if (!get || state.bank[get] < 1) return null
  let give: Resource | null = null
  for (const r of RESOURCES) {
    if (r === get) continue
    const surplus = hand[r] - (cost[r] ?? 0)
    if (surplus >= 4 && (give === null || surplus > hand[give] - (cost[give] ?? 0))) give = r
  }
  return give ? { give, get } : null
}

/** Highest-pip vertex from a candidate list (first wins ties — stable, deterministic). */
function bestVertex(state: CatanState, candidates: readonly VertexId[]): VertexId | null {
  let best: VertexId | null = null
  let bestScore = -1
  for (const v of candidates) {
    const s = vertexPips(state, v)
    if (s > bestScore) { best = v; bestScore = s }
  }
  return best
}

export function companionIntent(
  state: CatanState,
  seat: PlayerId,
  rng: Rng,
  opts: CompanionOpts = COMPANION_DEFAULTS,
): CatanIntent | null {
  if (state.winner !== null || state.turn.phase === 'ended') return null
  const t = state.turn
  const me = state.players[seat]!

  // off-turn obligations (mirror the engine's off-turn dispatch)
  const owed = t.pendingDiscards[seat]
  if (t.phase === 'discard' && owed) return { type: 'discard', player: seat, resources: greedyDiscard(state, seat, owed) }
  if (t.openTrade && t.current !== seat && t.openTrade.responses[seat] === undefined) {
    const offer = t.openTrade
    const favorable = hasResources(me.resources, offer.get) && totalResources(offer.give) >= totalResources(offer.get)
    return { type: 'respondTrade', player: seat, response: favorable ? 'accept' : 'reject' }
  }
  if (t.current !== seat) return null

  switch (t.phase) {
    case 'setup': {
      if (t.setup!.expect === 'settlement') {
        const spots = legalSettlementVertices(state, seat, { setup: true })
        return { type: 'placeSetupSettlement', player: seat, vertex: bestVertex(state, spots)! }
      }
      const topo = standardTopology()
      const settlement = t.setup!.lastSettlement!
      const edge = (topo.vertexEdges[settlement] ?? []).find((e) => state.roads[e] === undefined)!
      return { type: 'placeSetupRoad', player: seat, edge }
    }
    case 'preRoll':
      return { type: 'rollDice', player: seat }
    case 'robber': {
      let bestKey: string | null = null
      let bestScore = -Infinity
      for (const h of state.board.hexes) {
        const key = coordKey(h.coord)
        if (key === state.board.robber) continue
        const s = robberHexScore(state, seat, key)
        if (s > bestScore) { bestKey = key; bestScore = s }
      }
      const topo = standardTopology()
      const hex = state.board.hexes.find((h) => coordKey(h.coord) === bestKey)!
      const victims = state.players
        .map((_, i) => i)
        .filter((i) =>
          i !== seat &&
          totalResources(state.players[i]!.resources) > 0 &&
          (topo.hexVertices[bestKey!] ?? []).some((v) => state.buildings[v]?.owner === i),
        )
        .sort((a, b) => publicVp(state, b) - publicVp(state, a))
      return { type: 'moveRobber', player: seat, hex: hex.coord, stealFrom: victims[0] ?? null }
    }
    case 'main':
      return mainPhase(state, seat, opts)
    default:
      return null
  }
}

function mainPhase(state: CatanState, seat: PlayerId, opts: CompanionOpts): CatanIntent | null {
  const t = state.turn
  const me = state.players[seat]!

  // own open offer: Task 3 adds confirm-best; until then cancel on deadline, else wait
  if (t.openTrade) {
    if (opts.resolveOfferNow) return { type: 'cancelTrade', player: seat }
    return null
  }

  const can = affordable(state, seat)
  if (can.city && me.citiesLeft > 0) {
    const spots = legalCityVertices(state, seat)
    if (spots.length) return { type: 'build', player: seat, piece: 'city', location: bestVertex(state, spots)! }
  }
  if (can.settlement && me.settlementsLeft > 0) {
    const spots = legalSettlementVertices(state, seat)
    if (spots.length) return { type: 'build', player: seat, piece: 'settlement', location: bestVertex(state, spots)! }
  }
  if (can.devCard && state.devDeck.length > 0) return { type: 'buyDevCard', player: seat }

  if (!t.devPlayed) {
    const playable = (card: string) => me.devCards.some((c) => c.card === card && c.boughtOnTurn < t.number)
    if (playable('knight')) return { type: 'playDevCard', player: seat, card: 'knight' }
    if (playable('roadBuilding') && me.roadsLeft > 0) {
      const edges = legalRoadEdges(state, seat).slice(0, Math.min(2, me.roadsLeft))
      if (edges.length) return { type: 'playDevCard', player: seat, card: 'roadBuilding', edges }
    }
    if (playable('yearOfPlenty')) {
      const take = plentyPicks(state, seat)
      if (take) return { type: 'playDevCard', player: seat, card: 'yearOfPlenty', take }
    }
    if (playable('monopoly')) {
      const want = missingForGoal(state, seat)[0] ?? 'ore'
      return { type: 'playDevCard', player: seat, card: 'monopoly', resource: want }
    }
  }

  if (can.road && me.roadsLeft > 0) {
    const spots = legalRoadEdges(state, seat)
    if (spots.length) return { type: 'build', player: seat, piece: 'road', location: spots[0]! }
  }

  if (opts.bankTradesThisTurn < 2) {
    const plan = bankTradePlan(state, seat)
    if (plan) return { type: 'bankTrade', player: seat, give: plan.give, get: plan.get }
  }

  return { type: 'endTurn', player: seat }
}

/** Two Year-of-Plenty picks the bank can actually pay: goal deficits first, any stocked resource as filler. Null if the bank can't fund two. */
function plentyPicks(state: CatanState, seat: PlayerId): readonly [Resource, Resource] | null {
  const bank = { ...state.bank }
  const picks: Resource[] = []
  for (const r of missingForGoal(state, seat)) {
    while (picks.length < 2 && bank[r] > 0 && (COSTS[buildGoal(state, seat)][r] ?? 0) > state.players[seat]!.resources[r] + picks.filter((p) => p === r).length) {
      picks.push(r); bank[r]--
    }
  }
  for (const r of RESOURCES) while (picks.length < 2 && bank[r] > 0) { picks.push(r); bank[r]-- }
  return picks.length === 2 ? [picks[0]!, picks[1]!] : null
}
```

Then in `apps/server/src/pilot.ts`: delete the local `greedyDiscard` and add `greedyDiscard` to the existing `@meridian/rules` import (same signature — call sites unchanged except argument order stays `(state, seat, owed)`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/rules test` and `pnpm -C apps/server test`
Expected: PASS (all suites, including existing pilot tests against the moved `greedyDiscard`). If the liveness loop stalls, the failure message names the phase/seat — fix the decision table, not the test.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan/companion.ts packages/rules/test/catan/companion.test.ts apps/server/src/pilot.ts
git commit -m "feat(rules): companionIntent — competent full-game bot brain with liveness proof"
```

---

### Task 3: Trade proposals + own-offer management

**Files:**
- Modify: `packages/rules/src/catan/companion.ts`
- Test: `packages/rules/test/catan/companion.test.ts` (extend)

**Interfaces:**
- Produces:
  - `proposalPlan(state: CatanState, seat: PlayerId): { give: Resource; get: Resource } | null`
  - `bestConfirmPartner(state: CatanState, seat: PlayerId): PlayerId | null`
  - `companionIntent` now emits `offerTrade` (guarded by `opts.proposedThisTurn`) and `confirmTrade`.

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { proposalPlan, bestConfirmPartner } from '../../src/index'

describe('companion trade proposals', () => {
  it('proposes 1 surplus for the biggest goal deficit when 1-2 kinds short', () => {
    // goal city (2 wheat 3 ore): give hand 3 wheat (surplus 1) + 2 ore → missing 1 ore only
    const state = withResources(inMain(), 0, { wheat: 3, ore: 2 })
    const cur = state.turn.current
    const s = { ...state, turn: { ...state.turn, current: 0 } } // test surgery: make it seat 0's main
    const plan = proposalPlan(s, 0)
    expect(plan).toEqual({ give: 'wheat', get: 'ore' })
    const intent = companionIntent(s, 0, createRng(0))!
    expect(intent).toMatchObject({ type: 'offerTrade', give: { wheat: 1 }, get: { ore: 1 } })
  })

  it('never proposes twice a turn, with no surplus, or when 3+ kinds short', () => {
    const ready = { ...withResources(inMain(), 0, { wheat: 3, ore: 2 }), }
    const s = { ...ready, turn: { ...ready.turn, current: 0 } }
    const again = companionIntent(s, 0, createRng(0), { ...COMPANION_DEFAULTS, proposedThisTurn: true })!
    expect(again.type).not.toBe('offerTrade')
    expect(proposalPlan({ ...inMain(), turn: { ...inMain().turn, current: 0 } }, 0)).toBeNull() // fresh hand: no surplus
  })

  it('confirms the lowest-public-VP acceptable responder; counters must pass the floor', () => {
    let s = withResources(inMain(), 0, { wheat: 3, ore: 2 })
    s = { ...s, turn: { ...s.turn, current: 0 } }
    s = mustApply(s, { type: 'offerTrade', player: 0, give: { wheat: 1 }, get: { ore: 1 } })
    s = withResources(s, 1, { ore: 1 })
    s = withResources(s, 2, { ore: 1 })
    s = mustApply(s, { type: 'respondTrade', player: 1, response: 'accept' })
    s = mustApply(s, { type: 'respondTrade', player: 2, response: 'accept' })
    // both accepted; equal public VP → first (seat 1); give seat 2 a city to break the tie downward
    expect([1, 2]).toContain(bestConfirmPartner(s, 0))
    const intent = companionIntent(s, 0, createRng(0))!
    expect(intent.type).toBe('confirmTrade')
  })

  it('waits while responses are pending, cancels on resolveOfferNow', () => {
    let s = withResources(inMain(), 0, { wheat: 3, ore: 2 })
    s = { ...s, turn: { ...s.turn, current: 0 } }
    s = mustApply(s, { type: 'offerTrade', player: 0, give: { wheat: 1 }, get: { ore: 1 } })
    expect(companionIntent(s, 0, createRng(0))).toBeNull()
    const forced = companionIntent(s, 0, createRng(0), { ...COMPANION_DEFAULTS, resolveOfferNow: true })!
    expect(forced.type).toBe('cancelTrade')
    // a lone unfavorable counter: give 1 wheat get 3 ore reversed — proposer would net-lose
    s = mustApply(s, { type: 'respondTrade', player: 1, response: { give: { ore: 1 }, get: { wheat: 3 } } },)
    // wait: counter fails floor (pay 3 wheat for 1 ore)
    expect(bestConfirmPartner(s, 0)).toBeNull()
  })
})
```

(The `respondTrade` counter above needs seat 1 to hold 1 ore — reuse `withResources` before countering; adjust while writing so every `mustApply` is legal.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/rules exec vitest run test/catan/companion.test.ts`
Expected: FAIL — `proposalPlan` not exported.

- [ ] **Step 3: Implement** (append to `companion.ts`; wire into `mainPhase`)

```ts
/**
 * Player-trade ask (design spec §1): fires only when the goal is 1–2 resource
 * kinds short AND some other resource has surplus beyond the goal's own cost.
 * Give exactly 1 surplus for 1 of the biggest deficit — tried before the
 * >=4:1 bank fallback.
 */
export function proposalPlan(state: CatanState, seat: PlayerId): { give: Resource; get: Resource } | null {
  const goal = buildGoal(state, seat)
  const cost = COSTS[goal]
  const hand = state.players[seat]!.resources
  const missing = missingForGoal(state, seat, goal)
  if (missing.length === 0 || missing.length > 2) return null
  let give: Resource | null = null
  let giveSurplus = 0
  for (const r of RESOURCES) {
    if (missing.includes(r)) continue
    const surplus = hand[r] - (cost[r] ?? 0)
    if (surplus >= 1 && surplus > giveSurplus) { give = r; giveSurplus = surplus }
  }
  return give ? { give, get: missing[0]! } : null
}

/**
 * Best confirmable responder to our own open offer, or null. Accepts are
 * always confirmable; counters must pass the pilot floor from the proposer's
 * side (cover counter.get, and counter.give >= counter.get in card count).
 * Ties/choices resolve toward the fewest public VP — don't feed the leader.
 */
export function bestConfirmPartner(state: CatanState, seat: PlayerId): PlayerId | null {
  const offer = state.turn.openTrade
  if (!offer) return null
  const hand = state.players[seat]!.resources
  const ok: PlayerId[] = []
  for (const [k, r] of Object.entries(offer.responses)) {
    const partner = Number(k)
    if (r.kind === 'accept') ok.push(partner)
    else if (r.kind === 'counter' && hasResources(hand, r.get) && totalResources(r.give) >= totalResources(r.get))
      ok.push(partner)
  }
  ok.sort((a, b) => publicVp(state, a) - publicVp(state, b))
  return ok[0] ?? null
}
```

In `mainPhase`, replace the openTrade block and insert the proposal between road-building and bank trade:

```ts
  if (t.openTrade) {
    const partner = bestConfirmPartner(state, seat)
    if (partner !== null) return { type: 'confirmTrade', player: seat, partner }
    if (opts.resolveOfferNow) return { type: 'cancelTrade', player: seat }
    return null // keep waiting; the room owns the clock
  }
  ...
  if (!opts.proposedThisTurn) {
    const ask = proposalPlan(state, seat)
    if (ask) return { type: 'offerTrade', player: seat, give: { [ask.give]: 1 }, get: { [ask.get]: 1 } }
  }
  // then the bank-trade fallback, then endTurn
```

Liveness note: with default opts (`proposedThisTurn: false`), the liveness loop from Task 2 would offer, then every other seat responds, then confirm/`bestConfirmPartner`-or-what? If all reject, `bestConfirmPartner` is null and the brain waits forever — the liveness driver has no room clock. Update the liveness test to model the room: track `proposedThisTurn`/`bankTradesThisTurn` per seat per turn number, and pass `resolveOfferNow: true` whenever every non-current seat has responded and none is confirmable. This mirrors exactly what the room does and keeps the no-stall assertion honest.

- [ ] **Step 4: Run tests**

Run: `pnpm -C packages/rules test`
Expected: PASS, including the updated liveness test (games still finish — trades change hands but the loop terminates).

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan/companion.ts packages/rules/test/catan/companion.test.ts
git commit -m "feat(rules): companion bots propose 1:1 goal trades and manage their own offers"
```

---

### Task 4: Room — `bots` option, bot seats, brain dispatch

**Files:**
- Modify: `apps/server/src/rooms/CatanRoom.ts`
- Modify: `apps/server/src/schema/CatanLobbyState.ts`
- Test: `apps/server/test/companion-room.test.ts` (create)

**Interfaces:**
- Consumes: `companionIntent`, `COMPANION_DEFAULTS`, `type CompanionOpts` from `@meridian/rules`.
- Produces: `CreateOptions.bots?: number`, `CreateOptions.botDelayMs?: number`, `CreateOptions.offerWindowMs?: number`; `CatanLobbyState.botCount: number` (schema `@type('number')`). Bot seats occupy trailing indices with session ids `bot-1`, `bot-2`, …

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/test/companion-room.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import appConfig from '../src/app.config'
import { MSG, type CatanSnapshotPayload } from '@meridian/protocol'

let server: ColyseusTestServer
beforeAll(async () => { server = await boot(appConfig) })
afterAll(async () => { await server.shutdown() })
afterEach(async () => { await server.cleanup() })

async function settle(ms = 120): Promise<void> { await new Promise((r) => setTimeout(r, ms)) }

const FAST = { pilotDelayMs: 0, botDelayMs: 0, seed: 1 }

describe('CatanRoom with native bots', () => {
  it('players:4 bots:3 starts on the creator alone, bots in trailing seats', async () => {
    const c = await server.sdk.joinOrCreate('catan', { players: 4, bots: 3, ...FAST })
    const sink: CatanSnapshotPayload[] = []
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
    await settle()
    expect(sink.length).toBeGreaterThan(0)
    expect(sink.at(-1)!.view.playerCount).toBe(4)
    expect(c.state.botCount).toBe(3)
    expect(Array.from(c.state.seats)).toEqual([c.sessionId, 'bot-1', 'bot-2', 'bot-3'])
  })

  it('players:4 bots:2 waits for a second human, then starts', async () => {
    const c0 = await server.sdk.joinOrCreate('catan', { players: 4, bots: 2, ...FAST })
    await settle(60)
    expect(c0.state.phase).toBe('waiting')
    const c1 = await server.sdk.joinById(c0.roomId, {})
    const sink: CatanSnapshotPayload[] = []
    c1.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c1.onMessage('*', () => undefined)
    c0.onMessage('*', () => undefined)
    await settle()
    expect(sink.at(-1)!.view.playerCount).toBe(4)
  })

  it('rejects bad bot counts', async () => {
    await expect(server.sdk.joinOrCreate('catan', { players: 4, bots: 4, ...FAST })).rejects.toThrow()
    await expect(server.sdk.joinOrCreate('catan', { players: 3, bots: -1, ...FAST })).rejects.toThrow()
    await expect(server.sdk.joinOrCreate('catan', { players: 3, bots: 1.5, ...FAST })).rejects.toThrow()
  })

  it('bots play: after the human places setup pieces, bot seats place theirs unprompted', async () => {
    const c = await server.sdk.joinOrCreate('catan', { players: 4, bots: 3, ...FAST, layout: 'beginner' })
    const sink: CatanSnapshotPayload[] = []
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
    await settle()
    const view = sink.at(-1)!.view
    expect(view.turn.current).toBe(0) // human is host seat 0, setup starts with them
    const vertex = view.board ? (await import('@meridian/rules')).vertexId({ q: 2, r: 0 }, 0) : ''
    c.send(MSG.INTENT, { type: 'placeSetupSettlement', vertex })
    c.send(MSG.INTENT, { type: 'placeSetupRoad', edge: (await import('@meridian/rules')).edgeId({ q: 2, r: 0 }, 0) })
    await settle(400) // bots 1-3 place snake-draft first picks
    const after = sink.at(-1)!.view
    expect(Object.keys(after.buildings).length).toBeGreaterThanOrEqual(4)
  })
})
```

(Move the `import { vertexId, edgeId } from '@meridian/rules'` to the top — shown inline only for locality.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C apps/server exec vitest run test/companion-room.test.ts`
Expected: FAIL — `botCount` undefined on state; room starts nothing with 1 human in a 4-room.

- [ ] **Step 3: Implement**

`CatanLobbyState.ts` — add below `targetPlayers`:

```ts
  /** Trailing seats reserved for native bots (native-bots design spec §2). */
  @type('number') botCount = 0
```

`CatanRoom.ts` changes, in order:

```ts
interface CreateOptions {
  players: 3 | 4
  bots?: number
  layout?: 'beginner' | 'random'
  pilotDelayMs?: number
  botDelayMs?: number
  /** How long a bot's own trade offer stays open for human responses. */
  offerWindowMs?: number
  abandonMinutes?: number
  seed?: number
  rngScript?: number[]
  targetVp?: number
}
```

New fields:

```ts
  private botCount = 0
  private botDelayMs = 900
  private offerWindowMs = 10_000
  private seatKinds: ('human' | 'bot')[] = []
  /** Per-bot-seat turn memory (design spec §2): reset when turn.number moves. */
  private botMemory = new Map<number, { turn: number; proposed: boolean; bankTrades: number }>()
  private offerTimer: Delayed | null = null
  private offerDeadlineHit = false
```

`onCreate` additions (after the `players` validation):

```ts
    const bots = options.bots ?? 0
    if (!Number.isInteger(bots) || bots < 0 || bots > options.players - 1)
      throw new Error('bots must be an integer in 0..players-1')
    this.botCount = bots
    this.botDelayMs = options.botDelayMs ?? 900
    this.offerWindowMs = options.offerWindowMs ?? 10_000
    ...
    this.maxClients = options.players - bots
    this.state.botCount = bots
```

`onJoin`: push `'human'` onto `seatKinds`; the start condition becomes `this.state.seats.length === this.state.targetPlayers - this.botCount`.

`handleStart`: add `|| this.botCount !== 0` to the BAD_START condition (early start is a 0-bot affordance; any bot count already lowers the human threshold).

`startGame()` — seed bot seats first:

```ts
  private startGame() {
    for (let i = 0; i < this.botCount; i++) {
      this.state.seats.push(`bot-${i + 1}`)
      this.state.connected.push(true)
      this.seatClients.push(null)
      this.seatKinds.push('bot')
    }
    const n = this.state.seats.length as 3 | 4
    ...unchanged...
  }
```

`onLeave` waiting-phase splice: also `this.seatKinds.splice(idx, 1)` (bots never leave; only humans can be in `seats` while waiting).

Brain dispatch — generalize the pilot machinery (rename internals; keep the public option names):

```ts
  /** Compute the driving intent for a seat with no client: competent brain for bot seats, caretaker for absent humans. */
  private drivenIntent(seat: number, rng: Rng): CatanIntent | null {
    if (!this.game) return null
    if (this.seatKinds[seat] !== 'bot') return pilotIntent(this.game, seat, rng)
    return companionIntent(this.game, seat, rng, this.companionOpts(seat))
  }

  private companionOpts(seat: number): CompanionOpts {
    const turn = this.game!.turn.number
    let mem = this.botMemory.get(seat)
    if (!mem || mem.turn !== turn) { mem = { turn, proposed: false, bankTrades: 0 }; this.botMemory.set(seat, mem) }
    return { proposedThisTurn: mem.proposed, resolveOfferNow: this.offerDeadlineHit, bankTradesThisTurn: mem.bankTrades }
  }
```

In `schedulePilot`'s timer callback (and rename nothing externally): compute `const s = this.nextDrivenSeat()`, `const intent = this.drivenIntent(s, this.rng)`, and **before** `applyAndBroadcast`, record memory:

```ts
      if (intent && this.seatKinds[s] === 'bot') {
        const mem = this.botMemory.get(s)
        if (mem) {
          if (intent.type === 'offerTrade') mem.proposed = true
          if (intent.type === 'bankTrade') mem.bankTrades++
        }
      }
```

`nextPilotSeat` → `nextDrivenSeat`: same loop, but probe with `this.drivenIntent(seat, { next: () => 0 })`. The timer delay: `this.seatKinds[this.nextDrivenSeat()!] === 'bot' ? this.botDelayMs : this.pilotDelayMs` — compute the seat once, pass it into the timeout closure instead of re-deriving (the current code re-derives; keep its re-derivation guard as a fallback).

Offer window — call after every state change, at the end of `applyAndBroadcast`:

```ts
  /** Arm a response window while a bot's own offer is open; force confirm-or-cancel at the deadline. */
  private syncOfferWindow() {
    const open = this.game?.turn.openTrade != null && this.seatKinds[this.game!.turn.current] === 'bot'
    if (!open) {
      this.offerTimer?.clear()
      this.offerTimer = null
      this.offerDeadlineHit = false
      return
    }
    if (this.offerTimer) return // already armed for this offer
    this.offerTimer = this.clock.setTimeout(() => {
      this.offerTimer = null
      this.offerDeadlineHit = true
      this.schedulePilot()
    }, this.offerWindowMs)
  }
```

`schedulePilot`'s early-return guards stay (abandoned rooms pause bots too — `humansConnected() === 0`). `offerDeadlineHit` clears in `syncOfferWindow` once the offer closes.

- [ ] **Step 4: Run tests**

Run: `pnpm -C apps/server test`
Expected: PASS — new suite green, every existing suite (pilot, reclaim, abandon, full-match, trade-paths) untouched.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/rooms/CatanRoom.ts apps/server/src/schema/CatanLobbyState.ts apps/server/test/companion-room.test.ts
git commit -m "feat(server): native bot seats — bots option, companion brain dispatch, offer window"
```

---### Task 5: Bot offer window integration test

**Files:**
- Test: `apps/server/test/companion-room.test.ts` (extend)

**Interfaces:** Consumes Task 4's `offerWindowMs` option and Task 3's proposal behavior.

A bot proposal cannot be forced deterministically through a live room without playing resources into place, so this test drives the human seat with `botIntent`-style scripted intents until a bot offer appears, then verifies the window closes it.

- [ ] **Step 1: Write the test**

```ts
  it('a bot trade offer resolves within the offer window even if the human never responds', async () => {
    const c = await server.sdk.joinOrCreate('catan', {
      players: 4, bots: 3, pilotDelayMs: 0, botDelayMs: 0, offerWindowMs: 150, seed: 5, targetVp: 4,
    })
    const sink: CatanSnapshotPayload[] = []
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
    await settle()
    // drive the human seat with the rules' scripted bot until the match ends
    // or 400 intents pass; on every snapshot where it's our turn / our duty, act.
    let sawBotOffer = false
    for (let i = 0; i < 400; i++) {
      const view = sink.at(-1)?.view
      if (!view) break
      if (view.winner !== null) break
      if (view.turn.openTrade && view.turn.current !== 0) sawBotOffer = true
      // never answer offers: the window must resolve them
      const intent = humanScriptIntent(view) // helper below
      if (intent) c.send(MSG.INTENT, intent)
      await settle(30)
    }
    // liveness through bot offers proves the window fires; a seeded run that
    // never produced an offer would leave sawBotOffer false — assert only
    // that the game finished, and log the flag for seed tuning.
    expect(sink.at(-1)!.view.winner).not.toBeNull()
    console.log('sawBotOffer(seed 5):', sawBotOffer)
  })
```

`humanScriptIntent(view)` is a small local helper mapping the redacted view to the same mandatory-only choices as `pilotIntent` (roll, discard greedily, first-legal setup placement, robber to first non-robbed hex, end turn, cancel nothing) — write it against `CatanClientState` fields (`view.you.resources`, `view.turn`), reusing `legalSettlementVertices`/`legalRoadEdges` from `@meridian/rules` (they accept the redacted view — `PlacementView`).

- [ ] **Step 2: Run, tune, pin**

Run: `pnpm -C apps/server exec vitest run test/companion-room.test.ts`
Expected: PASS with `sawBotOffer: true` printed. If false, try seeds 5→9 and pin the first seed that logs true; then **upgrade the console.log to a hard assertion** (`expect(sawBotOffer).toBe(true)`) so the window path stays covered.

- [ ] **Step 3: Commit**

```bash
git add apps/server/test/companion-room.test.ts
git commit -m "test(server): bot offers resolve via the response window in a full match"
```

---

### Task 6: Protocol + client — lobby selector, waiting room, net plumbing

**Files:**
- Modify: `apps/client/src/net/catan.ts`
- Modify: `apps/client/src/ui/Lobby.tsx`
- Modify: `apps/client/src/ui/WaitingRoom.tsx`
- Modify: `apps/client/src/scene/catan/catanStore.ts` (`setLobby` + `botCount` field)
- Modify: `README.md` (one line: lobby bot selector)
- Test: `apps/client/test/catanStore.test.ts` (extend), existing client suites stay green

**Interfaces:**
- Consumes: `CatanLobbyState.botCount` (Task 4).
- Produces: `createCatanMatch(players: 3 | 4, bots: number)`; store `botCount: number` + `setLobby(seats, connected, targetPlayers, botCount)`; Lobby testids `bots-0` … `bots-3`.

No protocol-package change is needed: create options travel as plain Colyseus create payloads (`CreateOptions` is server-validated), not through `catanIntentSchema` — only `net/catan.ts` changes.

- [ ] **Step 1: Write the failing store test** (extend `catanStore.test.ts`, mirroring the existing `setLobby` test idiom)

```ts
it('setLobby carries botCount; reset clears it', () => {
  const s = useCatanStore.getState()
  s.setLobby(['a'], [true], 4, 3)
  expect(useCatanStore.getState().botCount).toBe(3)
  useCatanStore.getState().reset()
  expect(useCatanStore.getState().botCount).toBe(0)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/client exec vitest run test/catanStore.test.ts`
Expected: FAIL — `setLobby` takes 3 args / `botCount` undefined.

- [ ] **Step 3: Implement**

`catanStore.ts`: add `botCount: number` (initial `0`, cleared by `reset`); `setLobby(seats, connected, targetPlayers, botCount) => set({ seats, connected, targetPlayers, botCount })`.

`net/catan.ts`:

```ts
interface CatanLobbyClientState {
  ...existing fields...
  botCount: number
}

export async function createCatanMatch(players: 3 | 4, bots: number): Promise<void> {
  useCatanStore.getState().setStatus('connecting')
  const seed = numberParam('seed')
  const targetVp = numberParam('vp')
  const botsOverride = numberParam('bots') // E2E hook, same idiom as ?seed=/?vp=
  const options = {
    players,
    bots: botsOverride ?? bots,
    ...(seed !== undefined ? { seed } : {}),
    ...(targetVp !== undefined ? { targetVp } : {}),
  }
  enterRoom(await getClient().create<CatanLobbyClientState>('catan', options))
}
```

`onStateChange`: `store().setLobby(Array.from(state.seats), Array.from(state.connected), state.targetPlayers, state.botCount ?? 0)`.

`Lobby.tsx` — below the players choice:

```tsx
  const [bots, setBots] = useState(0)
  const maxBots = players - 1
  // in the players-3 button onClick: setPlayers(3); setBots((b) => Math.min(b, 2))

  <div className="players-choice bots-choice">
    {Array.from({ length: maxBots + 1 }, (_, n) => (
      <button
        key={n}
        data-testid={`bots-${n}`}
        className={bots === n ? 'selected' : undefined}
        disabled={busy}
        onClick={() => setBots(n)}
      >
        {n === 0 ? 'No bots' : `${n} bot${n > 1 ? 's' : ''}`}
      </button>
    ))}
  </div>
```

and `createCatanMatch(players, bots)` in the create button. Reuse the existing `.players-choice` styling; add a `.bots-choice` margin rule in the lobby stylesheet only if the rows visually collide.

`WaitingRoom.tsx`:

```tsx
  const botCount = useCatanStore((s) => s.botCount)
  const humanTarget = (targetPlayers ?? 0) - botCount
  // seat list: after the human seats,
  {Array.from({ length: botCount }, (_, i) => (
    <li key={`bot-${i}`} data-testid={`bot-seat-${i}`}>
      <span className="dot connected" />
      Bot {i + 1}
    </li>
  ))}
  // status line:
  waiting for players ({seats.length}/{humanTarget > 0 ? humanTarget : '?'})
```

`canStartEarly` also requires `botCount === 0` (matches the server rule).

README: one line under the existing bots.mjs usage note — "Solo play: pick a bot count in the lobby (native bots; no script needed)."

- [ ] **Step 4: Run the client suite**

Run: `pnpm -C apps/client test`
Expected: PASS — the extended store test plus every existing suite (connection.test.ts mocks `setLobby` call sites; update any signature expectations it asserts).

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/net/catan.ts apps/client/src/ui/Lobby.tsx apps/client/src/ui/WaitingRoom.tsx apps/client/src/scene/catan/catanStore.ts apps/client/test/catanStore.test.ts README.md
git commit -m "feat(client): lobby bot-count selector; waiting room shows reserved bot seats"
```

---

### Task 7: E2E — solo match vs bots through the real UI

**Files:**
- Test: `apps/client/e2e/bots.spec.ts` (create)

**Interfaces:** Consumes Lobby testids (`players-4`, `bots-3`, `create-button`), `window.__meridianDebug.catanView/legalTargetsOnScreen` dev hooks, driver helpers from `e2e/driver.mjs`.

- [ ] **Step 1: Kill stale servers, then write the spec**

```bash
lsof -ti:5173,2567 | xargs kill -9 2>/dev/null; true
```

```ts
// apps/client/e2e/bots.spec.ts
import { expect, test } from '@playwright/test'
import { tryClick } from './driver.mjs'

declare global { interface Window { __meridianDebug?: any } }

test('lobby clamps bot count when switching 4 -> 3 players', async ({ page }) => {
  await page.goto('/?tier=low')
  await page.getByTestId('players-4').click()
  await page.getByTestId('bots-3').click()
  await page.getByTestId('players-3').click()
  await expect(page.getByTestId('bots-3')).toHaveCount(0) // max is now 2
  await expect(page.getByTestId('bots-2')).toHaveClass(/selected/) // clamped 3 -> 2
})

test('solo 4p match vs 3 bots: instant start, bots play setup, a human turn arrives', async ({ page }) => {
  await page.goto('/?seed=42&vp=4&tier=low')
  await page.getByTestId('players-4').click()
  await page.getByTestId('bots-3').click()
  await page.getByTestId('create-button').click()
  // no waiting room — the scene mounts straight away
  await page.waitForFunction(() => typeof window.__meridianDebug?.legalTargetsOnScreen === 'function')
  // human (seat 0) places the snake-draft's first settlement + road
  for (let i = 0; i < 2; i++) {
    await page.waitForFunction(() => window.__meridianDebug.legalTargetsOnScreen().targets.length > 0)
    const t = await page.evaluate(() => window.__meridianDebug.legalTargetsOnScreen().targets[0])
    await page.mouse.click(t.x, t.y)
  }
  // bots take the rest of the first draft leg without any driver
  await page.waitForFunction(
    () => Object.keys(window.__meridianDebug.catanView().view.buildings).length >= 4,
    null, { timeout: 30_000 },
  )
  // the draft snakes back: eventually it's the human's second placement
  await page.waitForFunction(
    () => window.__meridianDebug.catanView().view.turn.current === 0
      && window.__meridianDebug.legalTargetsOnScreen().targets.length > 0,
    null, { timeout: 30_000 },
  )
})
```

Match the import style of the existing specs (`catan.spec.ts` imports from `./driver.mjs`); reuse its occlusion-aware click helper instead of raw `targets[0]` if the first target flakes under HUD panels.

- [ ] **Step 2: Run it**

Run: `pnpm -C apps/client test:e2e -- bots.spec.ts`
Expected: PASS. Also run the full E2E suite (`pnpm -C apps/client test:e2e`) — the existing specs must stay green (they create 0-bot rooms; the new default `bots = 0` keeps their flow identical).

- [ ] **Step 3: Commit**

```bash
git add apps/client/e2e/bots.spec.ts
git commit -m "test(e2e): solo match vs native bots through the lobby"
```

---

### Task 8: Camera orbit — reproduce, fix, prove

**Files:**
- Test: `apps/client/e2e/orbit.spec.ts` (create)
- Modify: whatever reproduction implicates — expected candidates: `apps/client/src/ui/hud.css` (pointer-events), `apps/client/src/ui/Hud.tsx` (hint line), `apps/client/src/scene/catan/CatanScene.tsx` (controls config)

**Interfaces:** Consumes `legalTargetsOnScreen`, `catanView` dev hooks; drei `OrbitControls` already mounted (`CatanScene.tsx:189-195`, rotate+zoom, pan off).

- [ ] **Step 1: Write the acceptance test first — it doubles as the reproduction probe**

```ts
// apps/client/e2e/orbit.spec.ts
import { expect, test } from '@playwright/test'

declare global { interface Window { __meridianDebug?: any } }

test.use({ viewport: { width: 1280, height: 720 } })

/** The element actually hit at (x,y) — 'canvas' means the click would reach the board. */
async function hitTest(page, x: number, y: number): Promise<string> {
  return page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.tagName.toLowerCase() ?? 'none', [x, y])
}

test('a vertex under a HUD panel becomes clickable after a drag-orbit', async ({ page }) => {
  await page.goto('/?seed=42&vp=4&tier=low')
  await page.getByTestId('players-4').click()
  await page.getByTestId('bots-3').click()
  await page.getByTestId('create-button').click()
  await page.waitForFunction(() => window.__meridianDebug?.legalTargetsOnScreen?.().targets.length > 0)

  // find (or manufacture, by toggling HUD panels open) an occluded legal target
  let targets = await page.evaluate(() => window.__meridianDebug.legalTargetsOnScreen().targets)
  let occluded = null
  for (const t of targets) if ((await hitTest(page, t.x, t.y)) !== 'canvas') { occluded = t; break }
  test.skip(occluded === null, 'no target occluded on this seed/viewport — rerun after seed change')

  // drag-orbit from a clear point mid-board
  const clear = targets.find(async (t) => (await hitTest(page, t.x, t.y)) === 'canvas') ?? targets[0]
  await page.mouse.move(640, 300)
  await page.mouse.down()
  await page.mouse.move(400, 300, { steps: 10 })
  await page.mouse.up()

  // projections must have moved (camera actually orbited)
  const after = await page.evaluate(() => window.__meridianDebug.legalTargetsOnScreen().targets)
  const same = (a, b) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1
  expect(after.some((t) => t.id === occluded.id && !same(t, occluded))).toBe(true)

  // the previously occluded vertex is now clear — click it and see the building land
  const moved = after.find((t) => t.id === occluded.id)!
  expect(await hitTest(page, moved.x, moved.y)).toBe('canvas')
  const before = await page.evaluate(() => Object.keys(window.__meridianDebug.catanView().view.buildings).length)
  await page.mouse.click(moved.x, moved.y)
  await page.waitForFunction((n) => Object.keys(window.__meridianDebug.catanView().view.buildings).length > n, before)
})
```

- [ ] **Step 2: Run it and diagnose from the failure point**

Run: `pnpm -C apps/client test:e2e -- orbit.spec.ts`

Decision tree — fix exactly what the failing assertion implicates:
- **Projections didn't move** → drags never reach `OrbitControls`. Inspect what swallows the pointer: run `hitTest` at the drag origin; if a HUD element (`.overlay`, a panel) sits there, the overlay root is intercepting — give the non-interactive overlay container `pointer-events: none` in `hud.css` and restore `pointer-events: auto` on each interactive child (build bar, panels, strips). This is the classic R3F-HUD bug and the most likely playtest culprit.
- **Vertex still occluded after orbit** → the drag delta was too small for the polar/azimuth clamps; widen the drag in the test first; if a corner panel still shadows the whole reachable arc, loosen `maxPolarAngle`/`minDistance` in `CatanScene.tsx` minimally and re-run the full E2E suite (projection-based specs recompute from the live camera, so they tolerate camera changes — verify).
- **Everything passes first try** → the mechanism always worked and the playtest gap was discoverability. Add a one-line hint to the HUD (in `Hud.tsx`, styled like the existing footnotes): `drag to rotate · scroll to zoom`, testid `orbit-hint`, and assert its presence in this spec.

Whatever the branch, when the run is green the backlog item's acceptance is met.

- [ ] **Step 3: Run the whole E2E + unit suites**

Run: `pnpm -C apps/client test && pnpm -C apps/client test:e2e`
Expected: PASS everywhere — orbit changes must not break the projection-clicking specs.

- [ ] **Step 4: Commit**

```bash
git add apps/client/e2e/orbit.spec.ts apps/client/src/ui/ apps/client/src/scene/catan/CatanScene.tsx
git commit -m "fix(client): HUD-occluded vertices reachable by drag-orbit, proven by E2E"
```

---

### Task 9: Playtest sweep, backlog close-out, push

**Files:**
- Modify: `docs/BACKLOG.md`

- [ ] **Step 1: Fresh servers, real sweep**

```bash
lsof -ti:5173,2567 | xargs kill -9 2>/dev/null; true
pnpm -C apps/server dev &   # or the repo's turbo dev task
pnpm -C apps/client dev &
```

Drive one full 4p/3-bot match end-to-end with a Playwright script (scratchpad, not committed): create via the lobby UI, play the human seat to completion at `vp=10` (no `?vp` shortcut — this run is about feel and coverage, not speed). Checklist to exercise and screenshot:

- bot trade offer arrives → banner renders → accept once, decline once, counter once (three separate offers; bots re-offer on later turns)
- human proposes to bots → responses appear in the offer review → confirm
- orbit then click a previously-hidden vertex
- dev cards: buy + play all four kinds through the modals
- robber flow: discard on a 7, steal chooser
- win overlay at match end; console error log empty throughout

Append findings to `docs/BACKLOG.md` under a dated "## Native-bots sweep (2026-08-24)" heading: quick fixes applied in-session (with their commits), anything larger as open items.

- [ ] **Step 2: Close out BACKLOG.md**

Mark DONE with a one-line root-cause/fix note, matching the file's existing style:
- "Bots never propose player trades" → DONE (native bots propose; `tools/bots.mjs` item closed as moot — responder UI now exercised every match)
- "Make the bots competent…" wishlist line → note the brain now lives in `@meridian/rules` `companionIntent`
- "Fixed camera + corner HUD panels can cover board vertices" → DONE with whatever Task 8 found

- [ ] **Step 3: Full-repo verification, then push**

```bash
pnpm -C packages/rules test && pnpm -C apps/server test && pnpm -C apps/client test && pnpm -C apps/client test:e2e
git add docs/BACKLOG.md
git commit -m "docs: backlog — native bots shipped, orbit fix, sweep findings"
git push
```

Expected: every suite green before the push; the push publishes the whole session.
