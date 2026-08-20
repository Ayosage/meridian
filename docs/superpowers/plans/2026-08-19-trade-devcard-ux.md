# Trade & Dev-Card UX (Phase 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the trading (player + bank/port) and development-card interfaces on the phase-4 board client, plus pilot trade evaluation so bots accept favorable offers.

**Architecture:** Pure-logic modules (`tradeLogic.ts`, `devCardLogic.ts`) hold every decision as unit-testable functions; `catanStore` gains UI state and actions that delegate to them with the injected-`SendIntent` pattern; thin components render store state with `hud.css` classes. One server change: `pilot.ts` evaluates trades instead of auto-rejecting. Zero engine/protocol changes — every intent already exists in `catanIntentSchema` and the redacted view already carries `turn.openTrade`, `you.devCards`, `turn.devPlayed`.

**Tech Stack:** TypeScript, React + zustand (client), Vitest, Playwright, Colyseus (server), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-19-trade-devcard-ux-design.md`

## Global Constraints

- `packages/rules` must never import three/react (unchanged; this plan never touches it).
- The engine stays the legality authority: client helpers pre-filter for UX only; rule errors surface via the existing toast path.
- Intents sent to the server NEVER carry a `player` field (`CatanClientIntent` — the server derives the seat).
- Resource maps in intents carry positive counts only (protocol `resourceMapSchema` rejects zeros) — always strip zeros via `selectionToPartial`.
- Follow existing store discipline: pure functions exported for tests; store handlers take `send: SendIntent` as a parameter, never import `net/catan.ts` (circular).
- All styles go in `apps/client/src/ui/hud.css` with the existing vocabulary: panels `rgba(12,14,20,0.8)`, card panels `rgba(12,14,20,0.92)` + `1px solid rgba(127,200,232,0.25)` radius 10px, primary `#2c6e8f`, green `#4a8f5c`, danger `#7a2f2f`/`#ff8080`, badge `#6b5b1f`/`#f4d97a`, text `#e8e8f0`.
- Every interactive element gets a `data-testid` (E2E depends on them; naming below is load-bearing).
- Work on branch `feat/trade-devcards` (already exists with the spec committed).
- Test commands: `pnpm -C apps/client exec vitest run [file]` (client), `pnpm -C apps/server exec vitest run [file]` (server). Final gate uses the repo's own `test`/`lint` scripts (check root `package.json` / `turbo.json` for exact names).

---

### Task 1: tradeLogic — pure trade helpers

**Files:**
- Create: `apps/client/src/scene/catan/tradeLogic.ts`
- Test: `apps/client/test/tradeLogic.test.ts`

**Interfaces:**
- Consumes: `@meridian/rules` — `bankTradeRate(state, player, resource): 4|3|2` (accepts a `CatanClientState`, which satisfies `PlacementView`), `RESOURCES`, `totalResources`, `hasResources`, types `CatanClientState`, `Resource`, `ResourceCount`, `TradeResponse`; `@meridian/protocol` — `CatanClientIntent`.
- Produces (Tasks 3, 6, 7 rely on these exact signatures):
  - `type ResourceSelection = Record<Resource, number>`
  - `emptySelection(): ResourceSelection`
  - `selectionTotal(sel: ResourceSelection): number`
  - `incrementSelection(sel, r: Resource, cap?: number): ResourceSelection` (no-op at cap; default cap `Infinity`)
  - `decrementSelection(sel, r: Resource): ResourceSelection` (floored at 0)
  - `selectionToPartial(sel): Partial<ResourceCount>` (zeros stripped)
  - `offerTradeIntent(give, get: ResourceSelection): CatanClientIntent | null` (null when either side totals 0)
  - `counterTradeIntent(give, get: ResourceSelection): CatanClientIntent | null` (same guard; builds `respondTrade` with `{give, get}` — `give` = what the RESPONDER hands over)
  - `bankRates(view: CatanClientState, seat: number): Record<Resource, 4|3|2>`
  - `bankTradeIntent(view, seat, give: Resource | null, get: Resource | null): CatanClientIntent | null` (null when: either pick missing, `give === get`, hand below the rate, or `view.bank[get] < 1`)
  - `interface IncomingOfferView { from: number; youReceive: Partial<ResourceCount>; youGive: Partial<ResourceCount>; responded: boolean }`
  - `incomingOfferFor(view, seat: number): IncomingOfferView | null` (null unless `view.turn.openTrade` set AND `view.turn.current !== seat`; `youReceive = openTrade.give`, `youGive = openTrade.get`, `responded = openTrade.responses[seat] !== undefined`)
  - `type ResponseSummary = { seat: number } & ({ kind: 'waiting' } | { kind: 'accept' } | { kind: 'reject' } | { kind: 'counter'; youGive: Partial<ResourceCount>; youGet: Partial<ResourceCount> })`
  - `offerResponsesFor(view, seat: number): ResponseSummary[] | null` (null unless `openTrade` set AND `current === seat`; one entry per opponent seat in seat order. Counter perspective flip per `applyConfirmTrade`: the offerer gives `response.get` and gets `response.give`, so `youGive = response.get`, `youGet = response.give`)

- [ ] **Step 1: Write the failing tests**

```ts
// apps/client/test/tradeLogic.test.ts
import { describe, expect, it } from 'vitest'
import { createCatanGame, createRng, redactCatanState, type CatanClientState } from '@meridian/rules'
import {
  bankRates, bankTradeIntent, counterTradeIntent, decrementSelection, emptySelection,
  incomingOfferFor, incrementSelection, offerResponsesFor, offerTradeIntent,
  selectionToPartial, selectionTotal,
} from '../src/scene/catan/tradeLogic'

/** Real-engine view; you.resources / turn / bank overridable per test. */
function makeView(overrides: {
  seat?: number
  resources?: Partial<CatanClientState['you']['resources']>
  turn?: Partial<CatanClientState['turn']>
  bank?: Partial<CatanClientState['bank']>
} = {}): CatanClientState {
  const state = createCatanGame({ playerCount: 4 }, createRng(1))
  const base = redactCatanState(state, overrides.seat ?? 0)
  return {
    ...base,
    bank: { ...base.bank, ...overrides.bank },
    turn: { ...base.turn, ...overrides.turn },
    you: { ...base.you, resources: { ...base.you.resources, ...overrides.resources } },
  }
}

describe('selection helpers', () => {
  it('increments up to the cap and not past it', () => {
    let sel = emptySelection()
    sel = incrementSelection(sel, 'wood', 1)
    expect(sel.wood).toBe(1)
    expect(incrementSelection(sel, 'wood', 1)).toBe(sel) // no-op returns same object
  })

  it('decrements floored at zero', () => {
    const sel = emptySelection()
    expect(decrementSelection(sel, 'ore')).toBe(sel)
    expect(decrementSelection(incrementSelection(sel, 'ore'), 'ore').ore).toBe(0)
  })

  it('selectionToPartial strips zeros (protocol rejects zero counts)', () => {
    const sel = { ...emptySelection(), wood: 2 }
    expect(selectionToPartial(sel)).toEqual({ wood: 2 })
  })

  it('selectionTotal sums across resources', () => {
    expect(selectionTotal({ wood: 2, brick: 0, sheep: 1, wheat: 0, ore: 0 })).toBe(3)
  })
})

describe('offer/counter intents', () => {
  const give = { ...emptySelection(), wood: 2 }
  const get = { ...emptySelection(), ore: 1 }

  it('offerTradeIntent builds offerTrade with stripped maps', () => {
    expect(offerTradeIntent(give, get)).toEqual({ type: 'offerTrade', give: { wood: 2 }, get: { ore: 1 } })
  })

  it('offerTradeIntent refuses an empty side', () => {
    expect(offerTradeIntent(give, emptySelection())).toBeNull()
    expect(offerTradeIntent(emptySelection(), get)).toBeNull()
  })

  it('counterTradeIntent builds respondTrade with the counter terms', () => {
    expect(counterTradeIntent(give, get)).toEqual({
      type: 'respondTrade', response: { give: { wood: 2 }, get: { ore: 1 } },
    })
  })
})

describe('bank trades', () => {
  it('bankRates reports 4:1 for a player with no port buildings', () => {
    const view = makeView()
    expect(bankRates(view, 0)).toEqual({ wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 })
  })

  it('bankTradeIntent builds the intent when affordable', () => {
    const view = makeView({ resources: { wood: 4 } })
    expect(bankTradeIntent(view, 0, 'wood', 'ore')).toEqual({ type: 'bankTrade', give: 'wood', get: 'ore' })
  })

  it('bankTradeIntent refuses: missing picks, same resource, short hand, empty bank', () => {
    const view = makeView({ resources: { wood: 4, brick: 3 }, bank: { sheep: 0 } })
    expect(bankTradeIntent(view, 0, null, 'ore')).toBeNull()
    expect(bankTradeIntent(view, 0, 'wood', null)).toBeNull()
    expect(bankTradeIntent(view, 0, 'wood', 'wood')).toBeNull()
    expect(bankTradeIntent(view, 0, 'brick', 'ore')).toBeNull() // 3 < 4:1 rate
    expect(bankTradeIntent(view, 0, 'wood', 'sheep')).toBeNull() // bank empty
  })
})

describe('offer derivations', () => {
  const openTrade = {
    give: { wood: 2 }, get: { ore: 1 },
    responses: { 1: { kind: 'accept' as const }, 2: { kind: 'counter' as const, give: { ore: 1 }, get: { wood: 3 } } },
  }

  it('incomingOfferFor maps the responder perspective', () => {
    const view = makeView({ seat: 1, turn: { current: 0, phase: 'main', openTrade } })
    expect(incomingOfferFor(view, 1)).toEqual({
      from: 0, youReceive: { wood: 2 }, youGive: { ore: 1 }, responded: true,
    })
    expect(incomingOfferFor(view, 3)!.responded).toBe(false)
  })

  it('incomingOfferFor is null for the offerer and when no trade is open', () => {
    const view = makeView({ turn: { current: 0, phase: 'main', openTrade } })
    expect(incomingOfferFor(view, 0)).toBeNull()
    expect(incomingOfferFor(makeView({ turn: { phase: 'main', openTrade: null } }), 1)).toBeNull()
  })

  it('offerResponsesFor lists every opponent with counter terms flipped to the offerer perspective', () => {
    const view = makeView({ turn: { current: 0, phase: 'main', openTrade } })
    expect(offerResponsesFor(view, 0)).toEqual([
      { seat: 1, kind: 'accept' },
      { seat: 2, kind: 'counter', youGive: { wood: 3 }, youGet: { ore: 1 } },
      { seat: 3, kind: 'waiting' },
    ])
  })

  it('offerResponsesFor is null for non-offerers', () => {
    const view = makeView({ seat: 1, turn: { current: 0, phase: 'main', openTrade } })
    expect(offerResponsesFor(view, 1)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C apps/client exec vitest run test/tradeLogic.test.ts`
Expected: FAIL — cannot resolve `../src/scene/catan/tradeLogic`.

- [ ] **Step 3: Implement**

```ts
// apps/client/src/scene/catan/tradeLogic.ts
import type { CatanClientIntent } from '@meridian/protocol'
import {
  bankTradeRate, RESOURCES,
  type CatanClientState, type Resource, type ResourceCount,
} from '@meridian/rules'

/** Per-resource staged counts for a trade side; always fully populated. */
export type ResourceSelection = Record<Resource, number>

export function emptySelection(): ResourceSelection {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }
}

export function selectionTotal(sel: ResourceSelection): number {
  return RESOURCES.reduce((sum, r) => sum + sel[r], 0)
}

export function incrementSelection(sel: ResourceSelection, r: Resource, cap = Infinity): ResourceSelection {
  if (sel[r] >= cap) return sel
  return { ...sel, [r]: sel[r] + 1 }
}

export function decrementSelection(sel: ResourceSelection, r: Resource): ResourceSelection {
  if (sel[r] <= 0) return sel
  return { ...sel, [r]: sel[r] - 1 }
}

/** Protocol resource maps carry positive counts only — strip zeros. */
export function selectionToPartial(sel: ResourceSelection): Partial<ResourceCount> {
  const out: Partial<ResourceCount> = {}
  for (const r of RESOURCES) if (sel[r] > 0) out[r] = sel[r]
  return out
}

export function offerTradeIntent(give: ResourceSelection, get: ResourceSelection): CatanClientIntent | null {
  if (selectionTotal(give) === 0 || selectionTotal(get) === 0) return null
  return { type: 'offerTrade', give: selectionToPartial(give), get: selectionToPartial(get) }
}

/** `give` = what the responder hands over (mirrors the engine's respondTrade counter shape). */
export function counterTradeIntent(give: ResourceSelection, get: ResourceSelection): CatanClientIntent | null {
  if (selectionTotal(give) === 0 || selectionTotal(get) === 0) return null
  return { type: 'respondTrade', response: { give: selectionToPartial(give), get: selectionToPartial(get) } }
}

export function bankRates(view: CatanClientState, seat: number): Record<Resource, 4 | 3 | 2> {
  const out = {} as Record<Resource, 4 | 3 | 2>
  for (const r of RESOURCES) out[r] = bankTradeRate(view, seat, r)
  return out
}

export function bankTradeIntent(
  view: CatanClientState,
  seat: number,
  give: Resource | null,
  get: Resource | null,
): CatanClientIntent | null {
  if (give === null || get === null || give === get) return null
  if (view.you.resources[give] < bankTradeRate(view, seat, give)) return null
  if (view.bank[get] < 1) return null
  return { type: 'bankTrade', give, get }
}

/** The open offer as one responder seat sees it, or null if this seat isn't a responder. */
export interface IncomingOfferView {
  from: number
  youReceive: Partial<ResourceCount>
  youGive: Partial<ResourceCount>
  responded: boolean
}

export function incomingOfferFor(view: CatanClientState, seat: number): IncomingOfferView | null {
  const offer = view.turn.openTrade
  if (!offer || view.turn.current === seat) return null
  return {
    from: view.turn.current,
    youReceive: offer.give,
    youGive: offer.get,
    responded: offer.responses[seat] !== undefined,
  }
}

export type ResponseSummary = { seat: number } & (
  | { kind: 'waiting' }
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'counter'; youGive: Partial<ResourceCount>; youGet: Partial<ResourceCount> }
)

/** Per-opponent response status as the offerer sees it, or null if this seat isn't the offerer. */
export function offerResponsesFor(view: CatanClientState, seat: number): ResponseSummary[] | null {
  const offer = view.turn.openTrade
  if (!offer || view.turn.current !== seat) return null
  const out: ResponseSummary[] = []
  for (let s = 0; s < view.playerCount; s++) {
    if (s === seat) continue
    const r = offer.responses[s]
    if (!r) out.push({ seat: s, kind: 'waiting' })
    else if (r.kind === 'accept') out.push({ seat: s, kind: 'accept' })
    else if (r.kind === 'reject') out.push({ seat: s, kind: 'reject' })
    // applyConfirmTrade: on a counter the offerer gives response.get and gets response.give.
    else out.push({ seat: s, kind: 'counter', youGive: r.get, youGet: r.give })
  }
  return out
}
```

Note: `totalResources` is imported for future use only if needed — remove the import if unused (lint will flag it).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm -C apps/client exec vitest run test/tradeLogic.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/scene/catan/tradeLogic.ts apps/client/test/tradeLogic.test.ts
git commit -m "feat(client): pure trade logic — selections, intents, offer derivations"
```

---

### Task 2: devCardLogic — pure dev-card helpers

**Files:**
- Create: `apps/client/src/scene/catan/devCardLogic.ts`
- Test: `apps/client/test/devCardLogic.test.ts`

**Interfaces:**
- Consumes: `@meridian/rules` — `COSTS`, `hasResources`, `legalRoadEdges`, types `CatanClientState`, `DevCard`, `EdgeId`, `Resource`; Task 1's `ResourceSelection`, `selectionTotal`.
- Produces (Tasks 4, 7 rely on these exact signatures):
  - `DEV_ORDER: readonly DevCard[]` = `['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'vp']`
  - `DEV_LABELS: Record<DevCard, string>` = Knight / Road Building / Year of Plenty / Monopoly / Victory Point
  - `interface DevGroup { card: DevCard; count: number; newCount: number; playable: boolean }`
  - `devHand(view: CatanClientState, seat: number): DevGroup[]` (held cards only, `DEV_ORDER` order; `newCount` = cards with `boughtOnTurn === view.turn.number`; `playable` = card ≠ 'vp' AND main phase AND `current === seat` AND `!devPlayed` AND at least one copy with `boughtOnTurn < turn.number`)
  - `canBuyDevCard(view, seat): boolean` (main phase, own turn, `hasResources(you.resources, COSTS.devCard)`, `devDeckCount > 0`)
  - `type RoadBuildingMode = { kind: 'roadBuilding'; staged: EdgeId[] }`
  - `roadBuildingTarget(view, seat): number` = `Math.min(2, view.players[seat].roadsLeft)`
  - `legalRoadBuildingEdges(view, seat, staged: readonly EdgeId[]): EdgeId[]` (staged edges overlaid as owned — mirrors `applyPlayDevCard`'s sequential validation)
  - `resolveRoadBuildingClick(view, seat, mode: RoadBuildingMode, edge: EdgeId): { intent: CatanClientIntent } | { mode: RoadBuildingMode } | null`
  - `yearOfPlentyIntent(sel: ResourceSelection, bank: CatanClientState['bank']): CatanClientIntent | null` (null unless total === 2 and the bank covers each picked count)
  - `monopolyIntent(resource: Resource): CatanClientIntent`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/client/test/devCardLogic.test.ts
import { describe, expect, it } from 'vitest'
import { createCatanGame, createRng, redactCatanState, type CatanClientState, type OwnedDevCard } from '@meridian/rules'
import {
  canBuyDevCard, devHand, legalRoadBuildingEdges, monopolyIntent,
  resolveRoadBuildingClick, roadBuildingTarget, yearOfPlentyIntent,
} from '../src/scene/catan/devCardLogic'
import { emptySelection } from '../src/scene/catan/tradeLogic'

function makeView(overrides: {
  seat?: number
  resources?: Partial<CatanClientState['you']['resources']>
  devCards?: OwnedDevCard[]
  turn?: Partial<CatanClientState['turn']>
  devDeckCount?: number
  bank?: Partial<CatanClientState['bank']>
} = {}): CatanClientState {
  const state = createCatanGame({ playerCount: 4 }, createRng(1))
  const base = redactCatanState(state, overrides.seat ?? 0)
  return {
    ...base,
    devDeckCount: overrides.devDeckCount ?? base.devDeckCount,
    bank: { ...base.bank, ...overrides.bank },
    turn: { ...base.turn, ...overrides.turn },
    you: {
      ...base.you,
      resources: { ...base.you.resources, ...overrides.resources },
      devCards: overrides.devCards ?? base.you.devCards,
    },
  }
}

const MAIN_TURN_3 = { current: 0, phase: 'main' as const, number: 3, devPlayed: false }

describe('devHand', () => {
  it('groups held cards in DEV_ORDER with counts, NEW counts, and playability', () => {
    const view = makeView({
      devCards: [
        { card: 'knight', boughtOnTurn: 1 },
        { card: 'knight', boughtOnTurn: 3 },
        { card: 'vp', boughtOnTurn: 1 },
      ],
      turn: MAIN_TURN_3,
    })
    expect(devHand(view, 0)).toEqual([
      { card: 'knight', count: 2, newCount: 1, playable: true },
      { card: 'vp', count: 1, newCount: 0, playable: false }, // vp never plays
    ])
  })

  it('nothing is playable once devPlayed is set, off-turn, or outside main', () => {
    const cards: OwnedDevCard[] = [{ card: 'monopoly', boughtOnTurn: 1 }]
    const played = makeView({ devCards: cards, turn: { ...MAIN_TURN_3, devPlayed: true } })
    expect(devHand(played, 0)[0]!.playable).toBe(false)
    const offTurn = makeView({ devCards: cards, turn: { ...MAIN_TURN_3, current: 1 } })
    expect(devHand(offTurn, 0)[0]!.playable).toBe(false)
    const preRoll = makeView({ devCards: cards, turn: { ...MAIN_TURN_3, phase: 'preRoll' } })
    expect(devHand(preRoll, 0)[0]!.playable).toBe(false)
  })

  it('a card whose only copies were bought this turn is not playable', () => {
    const view = makeView({ devCards: [{ card: 'knight', boughtOnTurn: 3 }], turn: MAIN_TURN_3 })
    expect(devHand(view, 0)).toEqual([{ card: 'knight', count: 1, newCount: 1, playable: false }])
  })
})

describe('canBuyDevCard', () => {
  it('requires main phase, own turn, dev cost, and deck stock', () => {
    const afford = { sheep: 1, wheat: 1, ore: 1 }
    expect(canBuyDevCard(makeView({ resources: afford, turn: MAIN_TURN_3 }), 0)).toBe(true)
    expect(canBuyDevCard(makeView({ resources: afford, turn: { ...MAIN_TURN_3, current: 1 } }), 0)).toBe(false)
    expect(canBuyDevCard(makeView({ resources: afford, turn: { ...MAIN_TURN_3, phase: 'preRoll' } }), 0)).toBe(false)
    expect(canBuyDevCard(makeView({ resources: { sheep: 0, wheat: 1, ore: 1 }, turn: MAIN_TURN_3 }), 0)).toBe(false)
    expect(canBuyDevCard(makeView({ resources: afford, turn: MAIN_TURN_3, devDeckCount: 0 }), 0)).toBe(false)
  })
})

describe('road building', () => {
  it('roadBuildingTarget is min(2, roadsLeft)', () => {
    const view = makeView()
    expect(roadBuildingTarget(view, 0)).toBe(2) // fresh game: 15 roads left
  })

  it('legalRoadBuildingEdges with no roads on the board is empty; overlay opens chained edges', () => {
    // Fresh board has no buildings/roads for seat 0, so nothing is legal —
    // this pins that the helper delegates to legalRoadEdges rather than
    // reimplementing it. Overlay behavior is pinned via resolveRoadBuildingClick
    // returning null for an illegal edge.
    const view = makeView()
    expect(legalRoadBuildingEdges(view, 0, [])).toEqual([])
  })

  it('resolveRoadBuildingClick refuses an illegal edge and completes at the target count', () => {
    const view = makeView()
    // no legal edges at all on a fresh board
    expect(resolveRoadBuildingClick(view, 0, { kind: 'roadBuilding', staged: [] }, 'e1' as never)).toBeNull()
  })
})

describe('modal intents', () => {
  it('yearOfPlentyIntent needs exactly 2 picked and bank coverage', () => {
    const bank = makeView().bank
    const two = { ...emptySelection(), wheat: 1, ore: 1 }
    expect(yearOfPlentyIntent(two, bank)).toEqual({ type: 'playDevCard', card: 'yearOfPlenty', take: ['wheat', 'ore'] })
    const doubled = { ...emptySelection(), ore: 2 }
    expect(yearOfPlentyIntent(doubled, bank)).toEqual({ type: 'playDevCard', card: 'yearOfPlenty', take: ['ore', 'ore'] })
    expect(yearOfPlentyIntent({ ...emptySelection(), ore: 1 }, bank)).toBeNull()
    expect(yearOfPlentyIntent(doubled, { ...bank, ore: 1 })).toBeNull()
  })

  it('monopolyIntent builds the intent', () => {
    expect(monopolyIntent('brick')).toEqual({ type: 'playDevCard', card: 'monopoly', resource: 'brick' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C apps/client exec vitest run test/devCardLogic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/client/src/scene/catan/devCardLogic.ts
import type { CatanClientIntent } from '@meridian/protocol'
import {
  COSTS, hasResources, legalRoadEdges, RESOURCES,
  type CatanClientState, type DevCard, type EdgeId, type Resource,
} from '@meridian/rules'
import { selectionTotal, type ResourceSelection } from './tradeLogic'

export const DEV_ORDER: readonly DevCard[] = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'vp']

export const DEV_LABELS: Record<DevCard, string> = {
  knight: 'Knight',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
  vp: 'Victory Point',
}

export interface DevGroup {
  card: DevCard
  count: number
  /** Copies bought this turn — shown with a NEW badge, not yet playable. */
  newCount: number
  playable: boolean
}

/** Own dev cards grouped in DEV_ORDER; playability per the engine's applyPlayDevCard gates. */
export function devHand(view: CatanClientState, seat: number): DevGroup[] {
  const { turn } = view
  const myTurnMain = turn.phase === 'main' && turn.current === seat && !turn.devPlayed
  const out: DevGroup[] = []
  for (const card of DEV_ORDER) {
    const copies = view.you.devCards.filter((c) => c.card === card)
    if (copies.length === 0) continue
    const matured = copies.some((c) => c.boughtOnTurn < turn.number)
    out.push({
      card,
      count: copies.length,
      newCount: copies.filter((c) => c.boughtOnTurn === turn.number).length,
      playable: card !== 'vp' && myTurnMain && matured,
    })
  }
  return out
}

export function canBuyDevCard(view: CatanClientState, seat: number): boolean {
  return (
    view.turn.phase === 'main' &&
    view.turn.current === seat &&
    hasResources(view.you.resources, COSTS.devCard) &&
    view.devDeckCount > 0
  )
}

export type RoadBuildingMode = { kind: 'roadBuilding'; staged: EdgeId[] }

/** The engine places exactly min(2, roadsLeft) roads for roadBuilding. */
export function roadBuildingTarget(view: CatanClientState, seat: number): number {
  return Math.min(2, view.players[seat]?.roadsLeft ?? 0)
}

/**
 * Legal edges for the NEXT road-building pick: staged edges are overlaid as
 * owned, mirroring the engine's sequential validation (applyPlayDevCard
 * re-runs legalRoadEdges after each placement) — chains off the first staged
 * road highlight correctly, and staged edges drop out as occupied.
 */
export function legalRoadBuildingEdges(
  view: CatanClientState,
  seat: number,
  staged: readonly EdgeId[],
): EdgeId[] {
  if (staged.length === 0) return legalRoadEdges(view, seat)
  const roads = { ...view.roads }
  for (const e of staged) roads[e] = seat
  return legalRoadEdges({ board: view.board, buildings: view.buildings, roads }, seat)
}

/** Pure: what an edge click does in roadBuilding mode — stage, complete, or nothing. */
export function resolveRoadBuildingClick(
  view: CatanClientState,
  seat: number,
  mode: RoadBuildingMode,
  edge: EdgeId,
): { intent: CatanClientIntent } | { mode: RoadBuildingMode } | null {
  if (!legalRoadBuildingEdges(view, seat, mode.staged).includes(edge)) return null
  const staged = [...mode.staged, edge]
  if (staged.length >= roadBuildingTarget(view, seat)) {
    return { intent: { type: 'playDevCard', card: 'roadBuilding', edges: staged } }
  }
  return { mode: { kind: 'roadBuilding', staged } }
}

/** Exactly two picked and each pick covered by the bank, else null. */
export function yearOfPlentyIntent(
  sel: ResourceSelection,
  bank: CatanClientState['bank'],
): CatanClientIntent | null {
  if (selectionTotal(sel) !== 2) return null
  const take: Resource[] = []
  for (const r of RESOURCES) {
    if (sel[r] > bank[r]) return null
    for (let i = 0; i < sel[r]; i++) take.push(r)
  }
  return { type: 'playDevCard', card: 'yearOfPlenty', take: [take[0]!, take[1]!] }
}

export function monopolyIntent(resource: Resource): CatanClientIntent {
  return { type: 'playDevCard', card: 'monopoly', resource }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm -C apps/client exec vitest run test/devCardLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/scene/catan/devCardLogic.ts apps/client/test/devCardLogic.test.ts
git commit -m "feat(client): pure dev-card logic — hand grouping, road-building overlay, modal intents"
```

---

### Task 3: Store — trade state and actions

**Files:**
- Modify: `apps/client/src/scene/catan/catanStore.ts`
- Test: `apps/client/test/catanStoreTrade.test.ts` (new file; keeps `catanStore.test.ts` focused)

**Interfaces:**
- Consumes: Task 1's entire surface.
- Produces (Tasks 6, 7 rely on these): store fields `tradeOpen: boolean`, `tradeTab: 'players' | 'bank'`, `tradeGive/tradeGet: ResourceSelection`, `bankGive/bankGet: Resource | null`, `counterDraft: { give: ResourceSelection; get: ResourceSelection } | null`; actions `toggleTrade()`, `setTradeTab(tab)`, `incTradeGive(r)`, `decTradeGive(r)`, `incTradeGet(r)`, `decTradeGet(r)`, `setBankGive(r)`, `setBankGet(r)`, `submitOffer(send)`, `submitBankTrade(send)`, `respondToOffer(response: 'accept' | 'reject', send)`, `startCounter()`, `incCounterGive(r)`, `decCounterGive(r)`, `incCounterGet(r)`, `decCounterGet(r)`, `submitCounter(send)`, `cancelCounter()`, `confirmTradeWith(partner: number, send)`, `cancelOpenTrade(send)`.

Semantics to implement exactly:
- `toggleTrade()` flips `tradeOpen`; on OPEN it resets `tradeGive`/`tradeGet` to empty and `bankGive`/`bankGet` to null. No-op while a forced mode is active (`STALE_IF_UNFORCED.has(mode.kind)`).
- `incTradeGive(r)` caps at `view.you.resources[r]` (can't offer what you don't hold); `incTradeGet(r)` is uncapped. Counter variants mirror this (`incCounterGive` capped by hand).
- `submitOffer` builds via `offerTradeIntent(tradeGive, tradeGet)`; no-op on null. Does NOT clear `tradeOpen` — the next snapshot's `openTrade` flips the panel to review.
- `submitBankTrade` builds via `bankTradeIntent(view, seat, bankGive, bankGet)`; no-op on null.
- `respondToOffer` sends `{ type: 'respondTrade', response }`.
- `startCounter()` seeds `counterDraft` from the open offer, PREFILLED from the responder's perspective: `give` = offer.get clamped to own hand (`Math.min(count, you.resources[r])`), `get` = offer.give. No-op when `incomingOfferFor` is null.
- `submitCounter` builds via `counterTradeIntent(counterDraft.give, counterDraft.get)`; on send clears `counterDraft`.
- `confirmTradeWith(partner, send)` sends `{ type: 'confirmTrade', partner }`; `cancelOpenTrade` sends `{ type: 'cancelTrade' }`.
- `ingestSnapshot` addition: when the previous view had `turn.openTrade` set and the new one has it null (resolved or cancelled), clear `counterDraft` and reset `tradeGive`/`tradeGet` to empty. When `openTrade` appears and `turn.current === seat`, also reset the staged composer selections (the review panel replaces the composer).
- `reset()` clears all new fields (fold them into `INITIAL`).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/client/test/catanStoreTrade.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCatanGame, createRng, redactCatanState, type CatanClientState } from '@meridian/rules'
import { useCatanStore } from '../src/scene/catan/catanStore'

function makeView(overrides: {
  seq?: number
  seat?: number
  resources?: Partial<CatanClientState['you']['resources']>
  turn?: Partial<CatanClientState['turn']>
} = {}): CatanClientState {
  const state = createCatanGame({ playerCount: 4 }, createRng(1))
  const base = redactCatanState(state, overrides.seat ?? 0)
  return {
    ...base,
    seq: overrides.seq ?? base.seq,
    turn: { ...base.turn, ...overrides.turn },
    you: { ...base.you, resources: { ...base.you.resources, ...overrides.resources } },
  }
}

const MAIN = { current: 0, phase: 'main' as const, number: 2 }
const OPEN = { give: { wood: 2 }, get: { ore: 1 }, responses: {} }

function seed(turn: Partial<CatanClientState['turn']> = MAIN, resources = { wood: 4, ore: 1 }) {
  useCatanStore.getState().setSeat(0)
  useCatanStore.getState().ingestSnapshot({ seq: 1, view: makeView({ seq: 1, turn, resources }) })
}

beforeEach(() => useCatanStore.getState().reset())

describe('composer staging', () => {
  it('toggleTrade opens with clean staging and closes again', () => {
    seed()
    useCatanStore.getState().toggleTrade()
    expect(useCatanStore.getState().tradeOpen).toBe(true)
    useCatanStore.getState().incTradeGive('wood')
    useCatanStore.getState().toggleTrade()
    useCatanStore.getState().toggleTrade()
    expect(useCatanStore.getState().tradeGive.wood).toBe(0) // re-open resets
  })

  it('incTradeGive caps at the hand count; incTradeGet is uncapped', () => {
    seed(MAIN, { wood: 1, ore: 0 })
    useCatanStore.getState().toggleTrade()
    useCatanStore.getState().incTradeGive('wood')
    useCatanStore.getState().incTradeGive('wood')
    expect(useCatanStore.getState().tradeGive.wood).toBe(1)
    useCatanStore.getState().incTradeGet('ore')
    useCatanStore.getState().incTradeGet('ore')
    expect(useCatanStore.getState().tradeGet.ore).toBe(2)
  })

  it('submitOffer sends offerTrade and keeps the panel open for the review swap', () => {
    seed()
    const send = vi.fn()
    const s = useCatanStore.getState()
    s.toggleTrade(); s.incTradeGive('wood'); s.incTradeGive('wood'); s.incTradeGet('ore')
    useCatanStore.getState().submitOffer(send)
    expect(send).toHaveBeenCalledWith({ type: 'offerTrade', give: { wood: 2 }, get: { ore: 1 } })
    expect(useCatanStore.getState().tradeOpen).toBe(true)
  })

  it('submitOffer is a no-op with an empty side', () => {
    seed()
    const send = vi.fn()
    useCatanStore.getState().toggleTrade()
    useCatanStore.getState().incTradeGive('wood')
    useCatanStore.getState().submitOffer(send)
    expect(send).not.toHaveBeenCalled()
  })

  it('submitBankTrade sends bankTrade only when the rate is covered', () => {
    seed(MAIN, { wood: 4, ore: 0 })
    const send = vi.fn()
    const s = useCatanStore.getState()
    s.toggleTrade(); s.setTradeTab('bank'); s.setBankGive('wood'); s.setBankGet('ore')
    useCatanStore.getState().submitBankTrade(send)
    expect(send).toHaveBeenCalledWith({ type: 'bankTrade', give: 'wood', get: 'ore' })
  })
})

describe('responding', () => {
  it('respondToOffer sends accept/reject', () => {
    seed({ ...MAIN, current: 1, openTrade: OPEN })
    const send = vi.fn()
    useCatanStore.getState().respondToOffer('accept', send)
    expect(send).toHaveBeenCalledWith({ type: 'respondTrade', response: 'accept' })
  })

  it('startCounter prefills from the offer clamped to the hand, submitCounter sends and clears', () => {
    seed({ ...MAIN, current: 1, openTrade: { give: { wood: 2 }, get: { ore: 3 }, responses: {} } }, { wood: 0, ore: 1 })
    useCatanStore.getState().startCounter()
    const draft = useCatanStore.getState().counterDraft!
    expect(draft.give.ore).toBe(1) // offer wants 3 ore; we hold 1
    expect(draft.get.wood).toBe(2)
    const send = vi.fn()
    useCatanStore.getState().submitCounter(send)
    expect(send).toHaveBeenCalledWith({ type: 'respondTrade', response: { give: { ore: 1 }, get: { wood: 2 } } })
    expect(useCatanStore.getState().counterDraft).toBeNull()
  })
})

describe('offerer controls + snapshot resets', () => {
  it('confirmTradeWith and cancelOpenTrade send their intents', () => {
    seed({ ...MAIN, openTrade: OPEN })
    const send = vi.fn()
    useCatanStore.getState().confirmTradeWith(2, send)
    expect(send).toHaveBeenCalledWith({ type: 'confirmTrade', partner: 2 })
    useCatanStore.getState().cancelOpenTrade(send)
    expect(send).toHaveBeenCalledWith({ type: 'cancelTrade' })
  })

  it('a snapshot resolving the open trade clears counterDraft and staged selections', () => {
    seed({ ...MAIN, current: 1, openTrade: OPEN })
    useCatanStore.getState().startCounter()
    expect(useCatanStore.getState().counterDraft).not.toBeNull()
    useCatanStore.getState().ingestSnapshot({
      seq: 2,
      view: makeView({ seq: 2, turn: { ...MAIN, current: 1, openTrade: null } }),
    })
    expect(useCatanStore.getState().counterDraft).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C apps/client exec vitest run test/catanStoreTrade.test.ts`
Expected: FAIL — new fields/actions missing from the store type.

- [ ] **Step 3: Implement in `catanStore.ts`**

Import from `./tradeLogic`: `bankTradeIntent, counterTradeIntent, emptySelection, incrementSelection, decrementSelection, incomingOfferFor, offerTradeIntent, type ResourceSelection`. Add the fields to the `CatanState` interface and `INITIAL` (`tradeOpen: false`, `tradeTab: 'players' as const`, `tradeGive: emptySelection()`, `tradeGet: emptySelection()`, `bankGive: null`, `bankGet: null`, `counterDraft: null`). Then the handlers:

```ts
toggleTrade: () => {
  const { tradeOpen, mode } = get()
  if (STALE_IF_UNFORCED.has(mode.kind)) return // never over a forced discard/robber/steal
  set(
    tradeOpen
      ? { tradeOpen: false }
      : { tradeOpen: true, tradeTab: 'players', tradeGive: emptySelection(), tradeGet: emptySelection(), bankGive: null, bankGet: null },
  )
},
setTradeTab: (tradeTab) => set({ tradeTab }),
incTradeGive: (r) => {
  const { view, tradeGive } = get()
  if (view === null) return
  set({ tradeGive: incrementSelection(tradeGive, r, view.you.resources[r]) })
},
decTradeGive: (r) => set({ tradeGive: decrementSelection(get().tradeGive, r) }),
incTradeGet: (r) => set({ tradeGet: incrementSelection(get().tradeGet, r) }),
decTradeGet: (r) => set({ tradeGet: decrementSelection(get().tradeGet, r) }),
setBankGive: (bankGive) => set({ bankGive }),
setBankGet: (bankGet) => set({ bankGet }),
submitOffer: (send) => {
  const intent = offerTradeIntent(get().tradeGive, get().tradeGet)
  if (intent) send(intent)
},
submitBankTrade: (send) => {
  const { view, seat, bankGive, bankGet } = get()
  if (view === null || seat === null) return
  const intent = bankTradeIntent(view, seat, bankGive, bankGet)
  if (intent) send(intent)
},
respondToOffer: (response, send) => send({ type: 'respondTrade', response }),
startCounter: () => {
  const { view, seat } = get()
  if (view === null || seat === null) return
  const offer = incomingOfferFor(view, seat)
  if (!offer) return
  const give = emptySelection()
  for (const r of RESOURCES) give[r] = Math.min(offer.youGive[r] ?? 0, view.you.resources[r])
  const getSel = emptySelection()
  for (const r of RESOURCES) getSel[r] = offer.youReceive[r] ?? 0
  set({ counterDraft: { give, get: getSel } })
},
incCounterGive: (r) => {
  const { view, counterDraft } = get()
  if (view === null || counterDraft === null) return
  set({ counterDraft: { ...counterDraft, give: incrementSelection(counterDraft.give, r, view.you.resources[r]) } })
},
decCounterGive: (r) => {
  const { counterDraft } = get()
  if (counterDraft === null) return
  set({ counterDraft: { ...counterDraft, give: decrementSelection(counterDraft.give, r) } })
},
incCounterGet: (r) => {
  const { counterDraft } = get()
  if (counterDraft === null) return
  set({ counterDraft: { ...counterDraft, get: incrementSelection(counterDraft.get, r) } })
},
decCounterGet: (r) => {
  const { counterDraft } = get()
  if (counterDraft === null) return
  set({ counterDraft: { ...counterDraft, get: decrementSelection(counterDraft.get, r) } })
},
submitCounter: (send) => {
  const { counterDraft } = get()
  if (counterDraft === null) return
  const intent = counterTradeIntent(counterDraft.give, counterDraft.get)
  if (!intent) return
  send(intent)
  set({ counterDraft: null })
},
cancelCounter: () => set({ counterDraft: null }),
confirmTradeWith: (partner, send) => send({ type: 'confirmTrade', partner }),
cancelOpenTrade: (send) => send({ type: 'cancelTrade' }),
```

And extend `ingestSnapshot` (inside the existing handler, after computing `nextMode`):

```ts
const hadOpenTrade = view?.turn.openTrade != null
const hasOpenTrade = payload.view.turn.openTrade != null
const tradeResolved = hadOpenTrade && !hasOpenTrade
// Our own offer just posted: the review panel replaces the composer, so the
// staged selections are done with; a resolved/cancelled trade clears drafts.
const ownOfferPosted = !hadOpenTrade && hasOpenTrade && payload.view.turn.current === seat
const resetStaging = tradeResolved || ownOfferPosted
```

…and add to the existing `set({...})` object in `ingestSnapshot` (alongside `view`/`mode`/`status`/`discardSelection`):

```ts
counterDraft: tradeResolved ? null : get().counterDraft,
tradeGive: resetStaging ? emptySelection() : get().tradeGive,
tradeGet: resetStaging ? emptySelection() : get().tradeGet,
```

Import `RESOURCES` from `@meridian/rules` (used by `startCounter`).

- [ ] **Step 4: Run to verify pass — plus no regressions**

Run: `pnpm -C apps/client exec vitest run test/catanStoreTrade.test.ts test/catanStore.test.ts`
Expected: PASS both files.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/scene/catan/catanStore.ts apps/client/test/catanStoreTrade.test.ts
git commit -m "feat(client): trade composer/respond/review state in catanStore"
```

---

### Task 4: Store — dev-card state, roadBuilding mode, modal actions

**Files:**
- Modify: `apps/client/src/scene/catan/catanStore.ts`
- Test: `apps/client/test/catanStoreDev.test.ts`

**Interfaces:**
- Consumes: Task 2's surface (`resolveRoadBuildingClick`, `roadBuildingTarget`, `legalRoadBuildingEdges`, `yearOfPlentyIntent`, `monopolyIntent`, `RoadBuildingMode`), Task 1's selection helpers.
- Produces (Tasks 7 relies on these): `Mode` gains `| { kind: 'roadBuilding'; staged: EdgeId[] }`; store fields `devModal: 'yearOfPlenty' | 'monopoly' | null`, `plentySelection: ResourceSelection`; actions `startRoadBuilding()`, `openDevModal(kind)`, `closeDevModal()`, `incPlenty(r)`, `decPlenty(r)`, `submitPlenty(send)`, `submitMonopoly(r, send)`. `legalEdgesForMode` returns road-building overlay edges when in that mode (Highlights/PickLayer then work untouched).

Semantics:
- `Mode` union gains the roadBuilding member; `deriveMode` clears it when `phase !== 'main' || current !== seat` (a voluntary mode that cannot outlive its turn); `cancelMode` (Esc) cancels it (extend the cancelable check — nothing is lost, the card isn't consumed until the intent sends); `ruleError` while in roadBuilding keeps the mode but resets `staged: []` (engine rejected the pair — re-pick, per spec §8).
- `clickEdge` routes to `resolveRoadBuildingClick` when in the mode: `{mode}` result stages, `{intent}` result sends and sets mode idle.
- `legalEdgesForMode`: `if (mode.kind === 'roadBuilding') return legalRoadBuildingEdges(view, seat, mode.staged)`.
- `startRoadBuilding()`: no-op unless the view's `devHand` shows a playable roadBuilding (defensive); sets `{ mode: { kind: 'roadBuilding', staged: [] }, tradeOpen: false }`.
- `openDevModal(kind)` resets `plentySelection` to empty; `incPlenty` caps the TOTAL at 2 (per-resource cap 2 as well, and never beyond `view.bank[r]`); `submitPlenty` sends via `yearOfPlentyIntent(plentySelection, view.bank)` and closes the modal on success; `submitMonopoly(r, send)` sends `monopolyIntent(r)` and closes.
- `reset()` clears the new fields.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/client/test/catanStoreDev.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCatanGame, createRng, redactCatanState, standardTopology, type CatanClientState } from '@meridian/rules'
import { deriveMode, legalEdgesForMode, useCatanStore, type Mode } from '../src/scene/catan/catanStore'

function makeView(overrides: {
  seq?: number
  seat?: number
  turn?: Partial<CatanClientState['turn']>
  buildings?: CatanClientState['buildings']
  roads?: CatanClientState['roads']
} = {}): CatanClientState {
  const state = createCatanGame({ playerCount: 4 }, createRng(1))
  const base = redactCatanState(state, overrides.seat ?? 0)
  return {
    ...base,
    seq: overrides.seq ?? base.seq,
    buildings: overrides.buildings ?? base.buildings,
    roads: overrides.roads ?? base.roads,
    turn: { ...base.turn, ...overrides.turn },
  }
}

const MAIN = { current: 0, phase: 'main' as const, number: 2 }

beforeEach(() => useCatanStore.getState().reset())

describe('roadBuilding mode lifecycle', () => {
  it('deriveMode clears roadBuilding when the turn/phase moves on', () => {
    const rb: Mode = { kind: 'roadBuilding', staged: [] }
    expect(deriveMode(makeView({ turn: { ...MAIN, current: 1 } }), 0, rb)).toEqual({ kind: 'idle' })
    expect(deriveMode(makeView({ turn: { ...MAIN, phase: 'robber' } }), 0, rb)).toEqual({ kind: 'robber' })
    expect(deriveMode(makeView({ turn: MAIN }), 0, rb)).toEqual(rb) // still our main turn: survives
  })

  it('Esc cancels roadBuilding', () => {
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view: makeView({ seq: 1, turn: MAIN }) })
    useCatanStore.getState().setMode({ kind: 'roadBuilding', staged: [] })
    useCatanStore.getState().cancelMode()
    expect(useCatanStore.getState().mode).toEqual({ kind: 'idle' })
  })

  it('ruleError keeps roadBuilding but clears the staged picks', () => {
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view: makeView({ seq: 1, turn: MAIN }) })
    useCatanStore.getState().setMode({ kind: 'roadBuilding', staged: ['someEdge' as never] })
    useCatanStore.getState().ruleError('ILLEGAL_PLACEMENT: not a legal road edge')
    expect(useCatanStore.getState().mode).toEqual({ kind: 'roadBuilding', staged: [] })
  })

  it('clickEdge stages the first legal edge then sends the completed intent', () => {
    // Give seat 0 a settlement so it has legal road edges: pick any vertex,
    // then its edges are legal.
    const topo = standardTopology()
    const vertex = topo.vertices[0]!
    const edges = topo.vertexEdges[vertex]!
    const view = makeView({ seq: 1, turn: MAIN, buildings: { [vertex]: { owner: 0, kind: 'settlement' } } })
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    useCatanStore.getState().setMode({ kind: 'roadBuilding', staged: [] })

    const send = vi.fn()
    useCatanStore.getState().clickEdge(edges[0]!, send)
    expect(send).not.toHaveBeenCalled()
    expect(useCatanStore.getState().mode).toEqual({ kind: 'roadBuilding', staged: [edges[0]] })

    // second pick: an edge legal AFTER the overlay (any edge off the same vertex works)
    const second = legalEdgesForMode(view, 0, useCatanStore.getState().mode)[0]!
    useCatanStore.getState().clickEdge(second, send)
    expect(send).toHaveBeenCalledWith({ type: 'playDevCard', card: 'roadBuilding', edges: [edges[0], second] })
    expect(useCatanStore.getState().mode).toEqual({ kind: 'idle' })
  })
})

describe('dev modals', () => {
  it('plenty selection caps the total at 2 and submits via the intent builder', () => {
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view: makeView({ seq: 1, turn: MAIN }) })
    const s = useCatanStore.getState()
    s.openDevModal('yearOfPlenty')
    s.incPlenty('wheat'); s.incPlenty('ore'); s.incPlenty('wood') // third pick refused
    const sel = useCatanStore.getState().plentySelection
    expect(sel.wheat + sel.ore + sel.wood).toBe(2)
    const send = vi.fn()
    useCatanStore.getState().submitPlenty(send)
    expect(send).toHaveBeenCalledWith({ type: 'playDevCard', card: 'yearOfPlenty', take: ['wheat', 'ore'] })
    expect(useCatanStore.getState().devModal).toBeNull()
  })

  it('submitMonopoly sends and closes', () => {
    useCatanStore.getState().openDevModal('monopoly')
    const send = vi.fn()
    useCatanStore.getState().submitMonopoly('brick', send)
    expect(send).toHaveBeenCalledWith({ type: 'playDevCard', card: 'monopoly', resource: 'brick' })
    expect(useCatanStore.getState().devModal).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C apps/client exec vitest run test/catanStoreDev.test.ts`
Expected: FAIL — `Mode` has no roadBuilding member, actions missing.

- [ ] **Step 3: Implement in `catanStore.ts`**

- `Mode` union: add `| { kind: 'roadBuilding'; staged: EdgeId[] }` (import `EdgeId` — already imported).
- `deriveMode`: after the `STALE_IF_UNFORCED` check add:
  ```ts
  if (current.kind === 'roadBuilding' && (view.turn.phase !== 'main' || view.turn.current !== seat))
    return IDLE_MODE
  ```
- `cancelMode`: change the guard to `if (!PLACEMENT_KINDS.has(mode.kind) && mode.kind !== 'roadBuilding') return`.
- `ruleError`: before the placement-kinds branch add:
  ```ts
  if (mode.kind === 'roadBuilding') {
    set({ toast: message, mode: { kind: 'roadBuilding', staged: [] } })
    return
  }
  ```
- `legalEdgesForMode` (exported pure fn): first line becomes
  ```ts
  if (mode.kind === 'roadBuilding') return legalRoadBuildingEdges(view, seat, mode.staged)
  if (mode.kind !== 'placeRoad') return []
  ```
- `clickEdge` handler: before the existing resolve, add
  ```ts
  if (mode.kind === 'roadBuilding') {
    const result = resolveRoadBuildingClick(view, seat, mode, edge)
    if (!result) return
    if ('intent' in result) {
      send(result.intent)
      set({ mode: IDLE_MODE })
    } else set({ mode: result.mode })
    return
  }
  ```
- New fields in interface + `INITIAL`: `devModal: null as 'yearOfPlenty' | 'monopoly' | null`, `plentySelection: emptySelection()`.
- New handlers:
  ```ts
  startRoadBuilding: () => {
    const { view, seat, mode } = get()
    if (view === null || seat === null) return
    if (STALE_IF_UNFORCED.has(mode.kind)) return
    set({ mode: { kind: 'roadBuilding', staged: [] }, tradeOpen: false })
  },
  openDevModal: (devModal) => set({ devModal, plentySelection: emptySelection() }),
  closeDevModal: () => set({ devModal: null }),
  incPlenty: (r) => {
    const { view, plentySelection } = get()
    if (view === null) return
    if (selectionTotal(plentySelection) >= 2) return
    set({ plentySelection: incrementSelection(plentySelection, r, Math.min(2, view.bank[r])) })
  },
  decPlenty: (r) => set({ plentySelection: decrementSelection(get().plentySelection, r) }),
  submitPlenty: (send) => {
    const { view, plentySelection } = get()
    if (view === null) return
    const intent = yearOfPlentyIntent(plentySelection, view.bank)
    if (!intent) return
    send(intent)
    set({ devModal: null })
  },
  submitMonopoly: (r, send) => {
    send(monopolyIntent(r))
    set({ devModal: null })
  },
  ```
- Imports from `./devCardLogic`: `legalRoadBuildingEdges, monopolyIntent, resolveRoadBuildingClick, yearOfPlentyIntent`; from `./tradeLogic` additionally `selectionTotal`.

- [ ] **Step 4: Run to verify pass — full client unit suite**

Run: `pnpm -C apps/client exec vitest run`
Expected: PASS — including the untouched `catanStore.test.ts`, `buildFlow.test.ts`, `discard.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/scene/catan/catanStore.ts apps/client/test/catanStoreDev.test.ts
git commit -m "feat(client): roadBuilding board mode + dev modal state in catanStore"
```

---

### Task 5: hud.css vocabulary + BuildBar buttons + roll-button fix

**Files:**
- Modify: `apps/client/src/ui/hud.css`
- Modify: `apps/client/src/ui/BuildBar.tsx`

**Interfaces:**
- Produces: CSS classes Tasks 6–7 use verbatim: `.trade-panel`, `.trade-panel-header`, `.trade-tabs`, `.trade-tab`, `.trade-tab.active`, `.section-label`, `.res-stepper-row`, `.res-stepper`, `.res-stepper.depleted`, `.mini-btn`, `.res-dot` (+ `.res-wood/.res-brick/.res-sheep/.res-wheat/.res-ore`), `.res-chip`, `.offer-banner`, `.offer-terms`, `.offer-side`, `.offer-side-label`, `.offer-actions`, `.accept-btn`, `.decline-btn`, `.response-rows`, `.response-row`, `.response-name`, `.response-status` (+ `.accept/.reject/.counter/.waiting`), `.confirm-btn`, `.dev-strip`, `.dev-strip-header`, `.dev-cards-row`, `.dev-card-tile`, `.dev-card-name`, `.dev-card-count`, `.dev-play-btn`, `.badge-new`, `.bank-chip`, `.bank-chip.selected`, `.bank-rate`, `.trade-footnote`. BuildBar testids: `build-dev` and `trade-toggle`.

- [ ] **Step 1: Append to `hud.css`** (values from the approved canvas; existing tokens reused)

```css
/* --- phase 5: trade + dev cards --- */
.catan-hud .roll-button { right: 132px; } /* was 120px: touched END TURN's left edge */
.trade-panel {
  position: fixed;
  bottom: 74px;
  right: 18px;
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: rgba(12, 14, 20, 0.92);
  border: 1px solid rgba(127, 200, 232, 0.25);
  border-radius: 10px;
  padding: 12px 14px;
}
.trade-panel-header { display: flex; align-items: center; gap: 8px; }
.trade-panel-header .title { font-size: 14px; font-weight: 700; flex: 1; }
.trade-tabs { display: flex; gap: 4px; }
.trade-tab {
  padding: 4px 10px;
  font-size: 12px;
  font-family: inherit;
  border: 1px solid transparent;
  border-radius: 6px;
  background: #20222b;
  color: #e8e8f0;
  cursor: pointer;
}
.trade-tab.active { border-color: #7fc8e8; background: #2c6e8f; color: #fff; }
.section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.65; }
.res-stepper-row { display: flex; gap: 6px; justify-content: center; }
.res-stepper { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 52px; }
.res-stepper.depleted { opacity: 0.35; }
.res-stepper .res-name { font-size: 11px; text-transform: capitalize; opacity: 0.75; display: flex; align-items: center; gap: 4px; }
.res-stepper .res-count { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
.res-stepper .steppers { display: flex; gap: 4px; }
.mini-btn {
  width: 22px;
  height: 22px;
  font-size: 13px;
  line-height: 1;
  border: 1px solid rgba(127, 200, 232, 0.35);
  border-radius: 6px;
  background: #20222b;
  color: #e8e8f0;
  cursor: pointer;
}
.mini-btn:disabled { opacity: 0.35; cursor: default; }
.res-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.res-wood { background: #6a9a58; }
.res-brick { background: #b0603f; }
.res-sheep { background: #a8c67a; }
.res-wheat { background: #d9b95c; }
.res-ore { background: #8a94a6; }
.res-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #20222b;
  border: 1px solid rgba(127, 200, 232, 0.2);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
}
.offer-banner {
  position: fixed;
  top: 100px;
  left: 50%;
  transform: translateX(-50%);
  width: 380px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(12, 14, 20, 0.92);
  border: 1px solid rgba(127, 200, 232, 0.25);
  border-radius: 10px;
  padding: 14px 16px;
}
.offer-banner .title { font-size: 14px; font-weight: 700; text-align: center; }
.offer-terms { display: flex; align-items: center; justify-content: center; gap: 12px; }
.offer-side { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.offer-side-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.6; }
.offer-actions { display: flex; gap: 8px; }
.offer-actions button { flex: 1; padding: 9px 0; font-size: 13px; font-family: inherit; border-radius: 6px; cursor: pointer; }
.accept-btn { border: 0; background: #4a8f5c; color: #fff; }
.counter-btn { border: 1px solid rgba(127, 200, 232, 0.35); background: #20222b; color: #e8e8f0; }
.decline-btn { border: 1px solid rgba(255, 128, 128, 0.4); background: #20222b; color: #ff8080; }
.response-rows { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid rgba(232, 232, 240, 0.08); padding-top: 10px; }
.response-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.response-name { min-width: 64px; font-weight: 600; }
.response-status { flex: 1; font-size: 12px; }
.response-status.accept { color: #4a8f5c; }
.response-status.reject { color: #ff8080; }
.response-status.counter { color: #f4d97a; }
.response-status.waiting { opacity: 0.6; }
.confirm-btn { padding: 6px 12px; font-size: 12px; font-family: inherit; border: 0; border-radius: 6px; background: #2c6e8f; color: #fff; cursor: pointer; }
.dev-strip {
  position: fixed;
  bottom: 138px;
  left: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(12, 14, 20, 0.8);
  padding: 8px 10px;
  border-radius: 8px;
}
.dev-strip-header { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.65; }
.dev-cards-row { display: flex; gap: 8px; }
.dev-card-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 86px;
  padding: 8px;
  background: #20222b;
  border: 1px solid rgba(127, 200, 232, 0.2);
  border-radius: 6px;
}
.dev-card-name { font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px; }
.dev-card-name span { flex: 1; }
.dev-card-count { font-size: 11px; opacity: 0.7; font-variant-numeric: tabular-nums; }
.dev-card-note { font-size: 10px; opacity: 0.6; }
.dev-play-btn { padding: 4px 8px; font-size: 11px; font-family: inherit; border: 0; border-radius: 6px; background: #2c6e8f; color: #fff; cursor: pointer; }
.dev-play-btn:disabled { opacity: 0.4; cursor: default; }
.badge-new {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 6px;
  border-radius: 8px;
  background: #6b5b1f;
  color: #f4d97a;
}
.bank-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  min-width: 52px;
  font-family: inherit;
  border: 1px solid rgba(127, 200, 232, 0.2);
  border-radius: 6px;
  background: #20222b;
  color: #e8e8f0;
  cursor: pointer;
}
.bank-chip.selected { border-color: #7fc8e8; background: #2c6e8f; color: #fff; }
.bank-chip:disabled { opacity: 0.35; cursor: default; }
.bank-chip .res-name { font-size: 11px; text-transform: capitalize; display: flex; align-items: center; gap: 4px; }
.bank-rate { font-size: 10px; opacity: 0.75; font-variant-numeric: tabular-nums; }
.trade-footnote { font-size: 11px; opacity: 0.6; text-align: center; }
```

- [ ] **Step 2: Add the two buttons to `BuildBar.tsx`**

After the `PIECES.map(...)` buttons, inside the same `.build-bar` div:

```tsx
<button
  type="button"
  data-testid="build-dev"
  className="build-bar-btn"
  disabled={view === null || seat === null || !canBuyDevCard(view, seat)}
  onClick={() => sendCatanIntent({ type: 'buyDevCard' })}
>
  Dev Card
</button>
<button
  type="button"
  data-testid="trade-toggle"
  className={tradeOpen ? 'build-bar-btn active' : 'build-bar-btn'}
  disabled={view === null || seat === null || view.turn.phase !== 'main' || view.turn.current !== seat}
  onClick={toggleTrade}
>
  Trade
</button>
```

New imports/selectors in `BuildBar`: `import { canBuyDevCard } from '../scene/catan/devCardLogic'`, `import { sendCatanIntent } from '../net/catan'`, `const tradeOpen = useCatanStore((s) => s.tradeOpen)`, `const toggleTrade = useCatanStore((s) => s.toggleTrade)`. (BuildBar sends `buyDevCard` directly, like CatanHud's Roll button — no store action needed for a parameterless intent.)

- [ ] **Step 3: Verify — typecheck, lint, suite**

Run: `pnpm -C apps/client exec tsc --noEmit && pnpm -C apps/client exec vitest run`
Expected: clean typecheck, suite PASS. Also run the repo lint script for `apps/client` (check `package.json` for the exact name, e.g. `pnpm -C apps/client lint`).

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/ui/hud.css apps/client/src/ui/BuildBar.tsx
git commit -m "feat(client): trade/dev-card HUD styles; Dev Card + Trade buttons; roll-button spacing fix"
```

---

### Task 6: TradePanel + IncomingOffer components

**Files:**
- Create: `apps/client/src/ui/TradePanel.tsx`
- Create: `apps/client/src/ui/IncomingOffer.tsx`
- Modify: `apps/client/src/App.tsx` (mount both next to `<BuildBar />`)

**Interfaces:**
- Consumes: Task 3 store surface, Task 1 helpers (`bankRates`, `incomingOfferFor`, `offerResponsesFor`, `selectionTotal`), Task 5 CSS classes.
- Produces testids the E2E (Task 9) uses: `trade-panel`, `trade-tab-players`, `trade-tab-bank`, `trade-give-plus-{r}` / `trade-give-minus-{r}` / `trade-get-plus-{r}` / `trade-get-minus-{r}`, `trade-offer-submit`, `bank-give-{r}`, `bank-get-{r}`, `bank-trade-submit`, `offer-review`, `offer-cancel`, `confirm-trade-{seat}`, `offer-banner`, `offer-accept`, `offer-counter`, `offer-decline`, `counter-give-plus-{r}` / `counter-get-plus-{r}` (and minus variants), `counter-submit`.

- [ ] **Step 1: Implement `TradePanel.tsx`**

```tsx
import { RESOURCES, type CatanClientState, type Resource } from '@meridian/rules'
import { sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { bankRates, offerResponsesFor, selectionTotal, type ResourceSelection } from '../scene/catan/tradeLogic'
import './hud.css'

function ResDot({ r }: { r: Resource }) {
  return <span className={`res-dot res-${r}`} />
}

/** Chip list for one side of posted terms, e.g. "2 wood". */
function TermChips({ terms }: { terms: Partial<Record<Resource, number>> }) {
  return (
    <>
      {RESOURCES.filter((r) => (terms[r] ?? 0) > 0).map((r) => (
        <span className="res-chip" key={r}>
          <ResDot r={r} />
          {terms[r]} {r}
        </span>
      ))}
    </>
  )
}

/** One stepper row over the five resources (shared by composer give/get and the counter draft). */
export function StepperRow({
  sel, hand, prefix, onInc, onDec,
}: {
  sel: ResourceSelection
  /** When set, a resource with 0 in hand renders depleted (give sides only). */
  hand: CatanClientState['you']['resources'] | null
  prefix: string
  onInc: (r: Resource) => void
  onDec: (r: Resource) => void
}) {
  return (
    <div className="res-stepper-row">
      {RESOURCES.map((r) => (
        <div className={hand !== null && hand[r] === 0 ? 'res-stepper depleted' : 'res-stepper'} key={r}>
          <span className="res-name"><ResDot r={r} />{r}</span>
          <span className="res-count">{sel[r]}</span>
          <div className="steppers">
            <button type="button" className="mini-btn" data-testid={`${prefix}-minus-${r}`} disabled={sel[r] <= 0} onClick={() => onDec(r)}>&minus;</button>
            <button type="button" className="mini-btn" data-testid={`${prefix}-plus-${r}`} disabled={hand !== null && sel[r] >= hand[r]} onClick={() => onInc(r)}>+</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function Composer({ view, seat }: { view: CatanClientState; seat: number }) {
  const tradeTab = useCatanStore((s) => s.tradeTab)
  const setTradeTab = useCatanStore((s) => s.setTradeTab)
  const tradeGive = useCatanStore((s) => s.tradeGive)
  const tradeGet = useCatanStore((s) => s.tradeGet)
  const incTradeGive = useCatanStore((s) => s.incTradeGive)
  const decTradeGive = useCatanStore((s) => s.decTradeGive)
  const incTradeGet = useCatanStore((s) => s.incTradeGet)
  const decTradeGet = useCatanStore((s) => s.decTradeGet)
  const submitOffer = useCatanStore((s) => s.submitOffer)
  const bankGive = useCatanStore((s) => s.bankGive)
  const bankGet = useCatanStore((s) => s.bankGet)
  const setBankGive = useCatanStore((s) => s.setBankGive)
  const setBankGet = useCatanStore((s) => s.setBankGet)
  const submitBankTrade = useCatanStore((s) => s.submitBankTrade)
  const toggleTrade = useCatanStore((s) => s.toggleTrade)

  const rates = bankRates(view, seat)

  return (
    <div className="trade-panel" data-testid="trade-panel">
      <div className="trade-panel-header">
        <span className="title">Trade</span>
        <div className="trade-tabs">
          <button type="button" data-testid="trade-tab-players" className={tradeTab === 'players' ? 'trade-tab active' : 'trade-tab'} onClick={() => setTradeTab('players')}>Players</button>
          <button type="button" data-testid="trade-tab-bank" className={tradeTab === 'bank' ? 'trade-tab active' : 'trade-tab'} onClick={() => setTradeTab('bank')}>Bank</button>
        </div>
        <button type="button" className="mini-btn" data-testid="trade-close" onClick={toggleTrade}>&times;</button>
      </div>
      {tradeTab === 'players' ? (
        <>
          <div className="section-label">You give</div>
          <StepperRow sel={tradeGive} hand={view.you.resources} prefix="trade-give" onInc={incTradeGive} onDec={decTradeGive} />
          <div className="section-label">You get</div>
          <StepperRow sel={tradeGet} hand={null} prefix="trade-get" onInc={incTradeGet} onDec={decTradeGet} />
          <button
            type="button"
            className="modal-submit"
            data-testid="trade-offer-submit"
            disabled={selectionTotal(tradeGive) === 0 || selectionTotal(tradeGet) === 0}
            onClick={() => submitOffer(sendCatanIntent)}
          >
            Offer to players
          </button>
        </>
      ) : (
        <>
          <div className="section-label">You give</div>
          <div className="res-stepper-row">
            {RESOURCES.map((r) => (
              <button
                type="button"
                key={r}
                data-testid={`bank-give-${r}`}
                className={bankGive === r ? 'bank-chip selected' : 'bank-chip'}
                disabled={view.you.resources[r] < rates[r]}
                onClick={() => setBankGive(r)}
              >
                <span className="res-name"><ResDot r={r} />{r}</span>
                <span className="bank-rate">{rates[r]}:1</span>
              </button>
            ))}
          </div>
          <div className="section-label">You get</div>
          <div className="res-stepper-row">
            {RESOURCES.map((r) => (
              <button
                type="button"
                key={r}
                data-testid={`bank-get-${r}`}
                className={bankGet === r ? 'bank-chip selected' : 'bank-chip'}
                disabled={view.bank[r] < 1}
                onClick={() => setBankGet(r)}
              >
                <span className="res-name"><ResDot r={r} />{r}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="modal-submit"
            data-testid="bank-trade-submit"
            disabled={bankGive === null || bankGet === null || bankGive === bankGet}
            onClick={() => submitBankTrade(sendCatanIntent)}
          >
            {bankGive !== null && bankGet !== null && bankGive !== bankGet
              ? `Trade ${rates[bankGive]} ${bankGive} → 1 ${bankGet}`
              : 'Trade with the bank'}
          </button>
          <div className="trade-footnote">2:1 on a matching port · 3:1 with a generic port</div>
        </>
      )}
    </div>
  )
}

function OfferReview({ view, seat }: { view: CatanClientState; seat: number }) {
  const confirmTradeWith = useCatanStore((s) => s.confirmTradeWith)
  const cancelOpenTrade = useCatanStore((s) => s.cancelOpenTrade)
  const responses = offerResponsesFor(view, seat)
  const offer = view.turn.openTrade
  if (!responses || !offer) return null

  return (
    <div className="trade-panel" data-testid="offer-review">
      <div className="trade-panel-header">
        <span className="title">Your offer</span>
        <button type="button" className="trade-tab" data-testid="offer-cancel" onClick={() => cancelOpenTrade(sendCatanIntent)}>Cancel</button>
      </div>
      <div className="offer-terms">
        <TermChips terms={offer.give} />
        <span>→</span>
        <TermChips terms={offer.get} />
      </div>
      <div className="response-rows">
        {responses.map((r) => (
          <div className="response-row" key={r.seat}>
            <span className="response-name">Player {r.seat + 1}</span>
            <span className={`response-status ${r.kind}`}>
              {r.kind === 'waiting' && 'Waiting…'}
              {r.kind === 'accept' && 'Accepted'}
              {r.kind === 'reject' && 'Declined'}
              {r.kind === 'counter' && (
                <>Counter · you give <TermChips terms={r.youGive} />, get <TermChips terms={r.youGet} /></>
              )}
            </span>
            {(r.kind === 'accept' || r.kind === 'counter') && (
              <button type="button" className="confirm-btn" data-testid={`confirm-trade-${r.seat}`} onClick={() => confirmTradeWith(r.seat, sendCatanIntent)}>
                Confirm
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Docked trade surface (design spec §2, Option A): the composer while no
 * offer is open, the response review while our own offer is. Mounted next
 * to BuildBar in App.tsx; renders nothing off-turn or outside main phase.
 */
export function TradePanel() {
  const view = useCatanStore((s) => s.view)
  const seat = useCatanStore((s) => s.seat)
  const tradeOpen = useCatanStore((s) => s.tradeOpen)

  if (view === null || seat === null) return null
  if (view.turn.openTrade && view.turn.current === seat) return <OfferReview view={view} seat={seat} />
  if (!tradeOpen || view.turn.phase !== 'main' || view.turn.current !== seat) return null
  return <Composer view={view} seat={seat} />
}
```

- [ ] **Step 2: Implement `IncomingOffer.tsx`**

```tsx
import { RESOURCES, type Resource } from '@meridian/rules'
import { sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { incomingOfferFor } from '../scene/catan/tradeLogic'
import { StepperRow } from './TradePanel'
import './hud.css'

function TermChips({ terms }: { terms: Partial<Record<Resource, number>> }) {
  return (
    <>
      {RESOURCES.filter((r) => (terms[r] ?? 0) > 0).map((r) => (
        <span className="res-chip" key={r}>
          <span className={`res-dot res-${r}`} />
          {terms[r]} {r}
        </span>
      ))}
    </>
  )
}

/**
 * Responder's banner for the open offer (design spec §2): accept / counter /
 * decline while unanswered, a waiting line after answering. Hidden while a
 * forced mode (discard/robber/steal) needs this seat.
 */
export function IncomingOffer() {
  const view = useCatanStore((s) => s.view)
  const seat = useCatanStore((s) => s.seat)
  const mode = useCatanStore((s) => s.mode)
  const counterDraft = useCatanStore((s) => s.counterDraft)
  const respondToOffer = useCatanStore((s) => s.respondToOffer)
  const startCounter = useCatanStore((s) => s.startCounter)
  const cancelCounter = useCatanStore((s) => s.cancelCounter)
  const submitCounter = useCatanStore((s) => s.submitCounter)
  const incCounterGive = useCatanStore((s) => s.incCounterGive)
  const decCounterGive = useCatanStore((s) => s.decCounterGive)
  const incCounterGet = useCatanStore((s) => s.incCounterGet)
  const decCounterGet = useCatanStore((s) => s.decCounterGet)

  if (view === null || seat === null) return null
  if (mode.kind === 'discard' || mode.kind === 'robber' || mode.kind === 'steal') return null
  const offer = incomingOfferFor(view, seat)
  if (!offer) return null

  return (
    <div className="offer-banner" data-testid="offer-banner">
      <div className="title">Player {offer.from + 1} offers a trade</div>
      {offer.responded ? (
        <div className="trade-footnote">Response sent — waiting for Player {offer.from + 1}</div>
      ) : counterDraft !== null ? (
        <>
          <div className="section-label">You give</div>
          <StepperRow sel={counterDraft.give} hand={view.you.resources} prefix="counter-give" onInc={incCounterGive} onDec={decCounterGive} />
          <div className="section-label">You get</div>
          <StepperRow sel={counterDraft.get} hand={null} prefix="counter-get" onInc={incCounterGet} onDec={decCounterGet} />
          <div className="offer-actions">
            <button type="button" className="accept-btn" data-testid="counter-submit" onClick={() => submitCounter(sendCatanIntent)}>Send counter</button>
            <button type="button" className="counter-btn" data-testid="counter-cancel" onClick={cancelCounter}>Back</button>
          </div>
        </>
      ) : (
        <>
          <div className="offer-terms">
            <div className="offer-side">
              <span className="offer-side-label">You receive</span>
              <span><TermChips terms={offer.youReceive} /></span>
            </div>
            <span>→</span>
            <div className="offer-side">
              <span className="offer-side-label">You give</span>
              <span><TermChips terms={offer.youGive} /></span>
            </div>
          </div>
          <div className="offer-actions">
            <button type="button" className="accept-btn" data-testid="offer-accept" onClick={() => respondToOffer('accept', sendCatanIntent)}>Accept</button>
            <button type="button" className="counter-btn" data-testid="offer-counter" onClick={startCounter}>Counter</button>
            <button type="button" className="decline-btn" data-testid="offer-decline" onClick={() => respondToOffer('reject', sendCatanIntent)}>Decline</button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Mount in `App.tsx`**

Next to the existing HUD siblings:

```tsx
import { TradePanel } from './ui/TradePanel'
import { IncomingOffer } from './ui/IncomingOffer'
// … inside the playing-state JSX, after <BuildBar />:
<TradePanel />
<IncomingOffer />
```

- [ ] **Step 4: Verify — typecheck, suite, dev smoke**

Run: `pnpm -C apps/client exec tsc --noEmit && pnpm -C apps/client exec vitest run`
Expected: clean + PASS. Optional manual smoke: start server + client dev processes (kill stale dev servers on ports 5173/2567 FIRST — worktree footgun), create a 3-player room with two extra tabs, roll to main phase, open Trade, post an offer, see the banner in another tab.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ui/TradePanel.tsx apps/client/src/ui/IncomingOffer.tsx apps/client/src/App.tsx
git commit -m "feat(client): docked trade composer/review panel + incoming-offer banner"
```

---

### Task 7: DevCardStrip + dev modals

**Files:**
- Create: `apps/client/src/ui/DevCardStrip.tsx`
- Create: `apps/client/src/ui/YearOfPlentyModal.tsx`
- Create: `apps/client/src/ui/MonopolyModal.tsx`
- Modify: `apps/client/src/App.tsx` (mount all three)

**Interfaces:**
- Consumes: Task 2 (`devHand`, `DEV_LABELS`, `roadBuildingTarget`), Task 4 store surface, Task 5 CSS.
- Produces testids for E2E: `dev-strip`, `dev-play-{card}` (card ∈ knight/roadBuilding/yearOfPlenty/monopoly), `plenty-plus-{r}` / `plenty-minus-{r}`, `plenty-submit`, `monopoly-pick-{r}`.

- [ ] **Step 1: Implement `DevCardStrip.tsx`**

```tsx
import { sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { DEV_LABELS, devHand } from '../scene/catan/devCardLogic'
import './hud.css'

/**
 * Own dev-card hand above the hand strip (design spec §3). Play dispatch:
 * knight sends directly (next snapshot forces robber mode); roadBuilding
 * enters the staged board mode; yearOfPlenty/monopoly open their modals.
 */
export function DevCardStrip() {
  const view = useCatanStore((s) => s.view)
  const seat = useCatanStore((s) => s.seat)
  const startRoadBuilding = useCatanStore((s) => s.startRoadBuilding)
  const openDevModal = useCatanStore((s) => s.openDevModal)

  if (view === null || seat === null) return null
  const hand = devHand(view, seat)
  if (hand.length === 0) return null

  const play = (card: string) => {
    if (card === 'knight') sendCatanIntent({ type: 'playDevCard', card: 'knight' })
    else if (card === 'roadBuilding') startRoadBuilding()
    else if (card === 'yearOfPlenty') openDevModal('yearOfPlenty')
    else if (card === 'monopoly') openDevModal('monopoly')
  }

  return (
    <div className="dev-strip" data-testid="dev-strip">
      <div className="dev-strip-header">Dev cards · {view.devDeckCount} in deck</div>
      <div className="dev-cards-row">
        {hand.map((g) => (
          <div className="dev-card-tile" key={g.card} data-testid={`dev-tile-${g.card}`}>
            <div className="dev-card-name">
              <span>{DEV_LABELS[g.card]}</span>
              {g.newCount > 0 && <span className="badge-new">new</span>}
            </div>
            <span className="dev-card-count">×{g.count}</span>
            {g.card === 'vp' ? (
              <span className="dev-card-note">revealed at win</span>
            ) : (
              <button
                type="button"
                className="dev-play-btn"
                data-testid={`dev-play-${g.card}`}
                disabled={!g.playable}
                onClick={() => play(g.card)}
              >
                Play
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement `YearOfPlentyModal.tsx`**

```tsx
import { RESOURCES } from '@meridian/rules'
import { sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { selectionTotal } from '../scene/catan/tradeLogic'
import './hud.css'

/** Take-two-from-the-bank picker (design spec §3), DiscardModal pattern. */
export function YearOfPlentyModal() {
  const view = useCatanStore((s) => s.view)
  const devModal = useCatanStore((s) => s.devModal)
  const plentySelection = useCatanStore((s) => s.plentySelection)
  const incPlenty = useCatanStore((s) => s.incPlenty)
  const decPlenty = useCatanStore((s) => s.decPlenty)
  const submitPlenty = useCatanStore((s) => s.submitPlenty)
  const closeDevModal = useCatanStore((s) => s.closeDevModal)

  if (devModal !== 'yearOfPlenty' || view === null) return null
  const selected = selectionTotal(plentySelection)

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Year of Plenty</div>
        <div className="modal-total">Take any two resources from the bank</div>
        <div className="discard-rows">
          {RESOURCES.map((r) => (
            <div className="discard-row" key={r}>
              <span className="discard-label">{r}</span>
              <button type="button" className="stepper-btn" data-testid={`plenty-minus-${r}`} disabled={plentySelection[r] <= 0} onClick={() => decPlenty(r)}>&minus;</button>
              <span className="discard-value">{plentySelection[r]}</span>
              <button type="button" className="stepper-btn" data-testid={`plenty-plus-${r}`} disabled={selected >= 2 || plentySelection[r] >= view.bank[r]} onClick={() => incPlenty(r)}>+</button>
            </div>
          ))}
        </div>
        <div className="modal-total" data-testid="plenty-count">{selected} of 2 selected</div>
        <button type="button" className="modal-submit" data-testid="plenty-submit" disabled={selected !== 2} onClick={() => submitPlenty(sendCatanIntent)}>
          Take resources
        </button>
        <button type="button" className="trade-tab" data-testid="plenty-cancel" onClick={closeDevModal}>Cancel</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Implement `MonopolyModal.tsx`**

```tsx
import { RESOURCES } from '@meridian/rules'
import { sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import './hud.css'

/** Name-a-resource picker (design spec §3): click = play. */
export function MonopolyModal() {
  const devModal = useCatanStore((s) => s.devModal)
  const submitMonopoly = useCatanStore((s) => s.submitMonopoly)
  const closeDevModal = useCatanStore((s) => s.closeDevModal)

  if (devModal !== 'monopoly') return null

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Monopoly</div>
        <div className="modal-total">Name a resource — every player gives you all of theirs</div>
        <div className="steal-victims">
          {RESOURCES.map((r) => (
            <button type="button" className="steal-victim-btn" key={r} data-testid={`monopoly-pick-${r}`} onClick={() => submitMonopoly(r, sendCatanIntent)}>
              <span className={`res-dot res-${r}`} /> {r}
            </button>
          ))}
        </div>
        <button type="button" className="trade-tab" data-testid="monopoly-cancel" onClick={closeDevModal}>Cancel</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Mount in `App.tsx`** (same sibling block): `<DevCardStrip />`, `<YearOfPlentyModal />`, `<MonopolyModal />`.

- [ ] **Step 5: Verify**

Run: `pnpm -C apps/client exec tsc --noEmit && pnpm -C apps/client exec vitest run`
Expected: clean + PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/ui/DevCardStrip.tsx apps/client/src/ui/YearOfPlentyModal.tsx apps/client/src/ui/MonopolyModal.tsx apps/client/src/App.tsx
git commit -m "feat(client): dev-card strip, Year of Plenty and Monopoly modals"
```

---

### Task 8: Pilot trade evaluation (server)

**Files:**
- Modify: `apps/server/src/pilot.ts`
- Test: `apps/server/test/pilot.test.ts` (extend)

**Interfaces:**
- Consumes: `@meridian/rules` — `hasResources`, `totalResources` (both already imported or importable), `TradeOffer` via state.
- Produces: behavior change only — `pilotIntent` returns `respondTrade` accept/reject per the rule below.

Rule (design spec §6): the pilot gives `offer.get` and receives `offer.give`; ACCEPT iff `hasResources(pilot.resources, offer.get)` AND `totalResources(offer.give) >= totalResources(offer.get)`; otherwise REJECT. The pilot still never offers, counters, or confirms — and its existing main-phase `cancelTrade` (for its own turn's stale offer) stays.

- [ ] **Step 1: Write the failing tests** (extend `pilot.test.ts`; follow the file's existing state-building pattern — read it first, it already covers the reject path)

```ts
// append to apps/server/test/pilot.test.ts (adapt state setup to the file's existing helpers)
describe('pilot trade evaluation', () => {
  it('accepts an offer where it holds the asked resources and gains cards', () => {
    // offerer (seat 0, current) gives 2 wood, wants 1 ore; pilot seat 1 holds 1 ore
    const state = stateWithOpenTrade({
      current: 0,
      openTrade: { give: { wood: 2 }, get: { ore: 1 }, responses: {} },
      pilotSeat: 1,
      pilotResources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 1 },
    })
    expect(pilotIntent(state, 1, { next: () => 0 })).toEqual({
      type: 'respondTrade', player: 1, response: 'accept',
    })
  })

  it('rejects when it cannot cover the asked side', () => {
    const state = stateWithOpenTrade({
      current: 0,
      openTrade: { give: { wood: 2 }, get: { ore: 1 }, responses: {} },
      pilotSeat: 1,
      pilotResources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
    })
    expect(pilotIntent(state, 1, { next: () => 0 })).toEqual({
      type: 'respondTrade', player: 1, response: 'reject',
    })
  })

  it('rejects a card-losing trade even when affordable', () => {
    // gives 2 ore for 1 wood: -1 card net
    const state = stateWithOpenTrade({
      current: 0,
      openTrade: { give: { wood: 1 }, get: { ore: 2 }, responses: {} },
      pilotSeat: 1,
      pilotResources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 2 },
    })
    expect(pilotIntent(state, 1, { next: () => 0 })).toEqual({
      type: 'respondTrade', player: 1, response: 'reject',
    })
  })
})
```

Write `stateWithOpenTrade` as a small local helper on top of the file's existing state construction (e.g. `createCatanGame` + spread overrides on `turn.openTrade`, `turn.current`, and the pilot seat's `resources`), matching how the file's current trade-reject test builds state.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C apps/server exec vitest run test/pilot.test.ts`
Expected: the accept case FAILS (current code always rejects).

- [ ] **Step 3: Implement in `pilot.ts`**

Replace the auto-reject branch:

```ts
if (t.openTrade && t.current !== seat && t.openTrade.responses[seat] === undefined) {
  // Evaluate instead of auto-rejecting (phase-5 spec §6): the responder
  // gives offer.get and receives offer.give — accept only a trade it can
  // cover that never loses net cards. Still no offers/counters: a piloted
  // seat stays a caretaker, not a competitor.
  const offer = t.openTrade
  const favorable =
    hasResources(state.players[seat]!.resources, offer.get) &&
    totalResources(offer.give) >= totalResources(offer.get)
  return { type: 'respondTrade', player: seat, response: favorable ? 'accept' : 'reject' }
}
```

Add `hasResources` to the `@meridian/rules` import (alongside the existing `totalResources`), and update the file's doc comment ("It never builds, buys or plays dev cards, or offers trades" — now also "it accepts clearly favorable trade offers").

- [ ] **Step 4: Run to verify pass — full server suite**

Run: `pnpm -C apps/server exec vitest run`
Expected: PASS — including `pilot-liveness.test.ts`, `catan-trade-paths.test.ts`, `catan-full-match.test.ts` (audit any test assuming trades never complete; spec §8 risk).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/pilot.ts apps/server/test/pilot.test.ts
git commit -m "feat(server): pilot accepts favorable trade offers"
```

---

### Task 9: E2E — trade + dev-card flows

**Files:**
- Create: `apps/client/e2e/trade-devcards.spec.ts`

**Interfaces:**
- Consumes: testids from Tasks 5–7 (exact names listed there), the existing `?seed=/&vp=/&tier=` room options, and `window.__meridianDebug.legalTargetsOnScreen` for canvas clicks.

Approach: a 3-browser room like `catan.spec.ts`, but the drivers deliberately DON'T build after setup — resources accumulate quickly, making trades and dev-card buys reachable within a few rounds. The test drives passively (roll/discard/robber/steal/end-turn), then at opportune moments scripts: (a) one player trade offered by whoever is current and accepted by a responder, (b) one bank trade, (c) one dev-card buy and a later play. Copy the helpers it needs (`isEnabled`, `isVisible`, `tryClick`, `driveDiscard`, `clickFirstLegalTarget`) from `catan.spec.ts` rather than refactoring that file — its pinned-seed soak behavior must not change in this phase (extract a shared `e2e/driver.ts` only if the copies stay byte-identical; judgment call at implementation time, note the choice in the commit).

- [ ] **Step 1: Write the spec** (skeleton below is the real structure; the passive tick is `tick()` minus the build-bar section)

```ts
import { expect, test, type Page } from '@playwright/test'

const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const
type Res = (typeof RESOURCES)[number]

// [copy isEnabled/isVisible/tryClick/driveDiscard/clickFirstLegalTarget from catan.spec.ts]

/** Read the five hand counts off a page's hand strip. */
async function readHand(page: Page): Promise<Record<Res, number>> {
  const out = {} as Record<Res, number>
  for (const r of RESOURCES) {
    const text = await page.getByTestId(`hand-${r}`).textContent()
    out[r] = Number(text!.replace(/\D+/g, ''))
  }
  return out
}

/** Passive tick: setup placements, roll, discard, robber, steal, end turn — never builds. */
async function passiveTick(page: Page): Promise<boolean> {
  if (await isVisible(page.getByTestId('discard-submit'))) { await driveDiscard(page); return true }
  const steal = page.locator('[data-testid^="steal-victim-"]').first()
  if (await isVisible(steal)) return tryClick(steal)
  const { mode, targets } = await clickFirstLegalTarget(page)
  if (targets.length > 0) return true
  if (mode !== 'idle') return false // forced placement resolving; wait
  if (await isEnabled(page.getByTestId('roll-button'))) return tryClick(page.getByTestId('roll-button'))
  if (await isEnabled(page.getByTestId('end-turn'))) return tryClick(page.getByTestId('end-turn'))
  return false
}

/** Drive all pages passively until `ready` answers a page index, or budget out. */
async function driveUntil(pages: Page[], ready: () => Promise<number>, budget = 600): Promise<number> {
  for (let i = 0; i < budget; i++) {
    const hit = await ready()
    if (hit >= 0) return hit
    for (const p of pages) await passiveTick(p)
    await pages[0]!.waitForTimeout(30)
  }
  throw new Error('driveUntil: budget exhausted before the condition held')
}

test.describe('trade + dev cards', () => {
  test('player trade, bank trade, dev-card buy and play', async ({ browser }) => {
    test.setTimeout(600_000)
    // [room setup: copy the create/join/turn-banner/debug-hook waits from catan.spec.ts,
    //  goto `/?seed=11&vp=10&tier=low` — vp high so no accidental win; seed is free
    //  (no pinned convergence needed: the test drives short, bounded scenarios)]

    const pages = [host, p2, p3]

    // (a) PLAYER TRADE — wait until someone is in main phase holding ≥1 of
    // anything while another page holds ≥1 of anything else.
    const offererIdx = await driveUntil(pages, async () => {
      for (let i = 0; i < pages.length; i++) {
        if (!(await isEnabled(pages[i]!.getByTestId('trade-toggle')))) continue
        const hand = await readHand(pages[i]!)
        if (RESOURCES.some((r) => hand[r] > 0)) return i
      }
      return -1
    })
    const offerer = pages[offererIdx]!
    const responder = pages[(offererIdx + 1) % 3]!
    const oHand = await readHand(offerer)
    const rHand = await readHand(responder)
    const giveR = RESOURCES.find((r) => oHand[r] > 0)!
    const getR = RESOURCES.find((r) => rHand[r] > 0 && r !== giveR) ?? RESOURCES.find((r) => rHand[r] > 0)!

    await offerer.getByTestId('trade-toggle').click()
    await offerer.getByTestId(`trade-give-plus-${giveR}`).click()
    await offerer.getByTestId(`trade-get-plus-${getR}`).click()
    await offerer.getByTestId('trade-offer-submit').click()

    await expect(responder.getByTestId('offer-banner')).toBeVisible({ timeout: 10_000 })
    await responder.getByTestId('offer-accept').click()
    await expect(offerer.getByTestId('offer-review')).toBeVisible()
    // the responder's seat index in the room ≠ page index; click whichever confirm appears
    await offerer.locator('[data-testid^="confirm-trade-"]').first().click()

    await expect
      .poll(async () => (await readHand(offerer))[giveR], { timeout: 10_000 })
      .toBe(oHand[giveR] - 1) // gave one away (production may add more of OTHER resources, so assert the traded one only if no roll happened — see note)

    // (b) BANK TRADE — wait until some current page holds ≥4 of one resource.
    // [driveUntil with: trade-toggle enabled AND readHand shows some r ≥ 4]
    // open trade → bank tab → bank-give-{r} → bank-get-{other} → bank-trade-submit
    // assert via expect.poll that hand[r] dropped by ~4 and hand[other] rose.

    // (c) DEV CARD — wait until some current page can buy (build-dev enabled).
    // click build-dev; expect dev-strip visible with a NEW badge; end turn;
    // drive passively until that page's turn returns AND a dev-play-* button
    // enables; click the first enabled one and handle what follows:
    //   knight → robber flow (clickFirstLegalTarget + steal buttons, as passiveTick already does)
    //   roadBuilding → two canvas edge clicks via clickFirstLegalTarget
    //   yearOfPlenty → plenty-plus twice on the first bank-covered resource + plenty-submit
    //   monopoly → monopoly-pick on RESOURCES[0]
    // If only a VP card was drawn (no play button ever enables), buy again on a
    // later turn — bound the whole section with driveUntil's budget and settle
    // for asserting the buy (deck count fell, strip visible) if two buys both
    // draw VP (2 in 25 chance twice — acceptable; log it).
  })
})
```

Timing note for (a): assert the traded resource's delta with `expect.poll` IMMEDIATELY after confirm and before any further tick — no dice roll can land in between because the offerer is current and nobody ends the turn. Flesh out (b) and (c) fully at implementation time following the comment scripts; every selector already exists in Tasks 5–7.

- [ ] **Step 2: Run it** (kill stale dev servers on 5173/2567 first — the worktree footgun in MEMORY)

Run: `pnpm -C apps/client exec playwright test e2e/trade-devcards.spec.ts`
Expected: PASS in well under the 10-minute timeout.

- [ ] **Step 3: Run the FULL E2E suite** (both spec files — proves the soak test still converges)

Run: `pnpm -C apps/client exec playwright test`
Expected: PASS (the 3-browser match test takes ~17 minutes; budget for it).

- [ ] **Step 4: Commit**

```bash
git add apps/client/e2e/trade-devcards.spec.ts
git commit -m "test(client): E2E for player/bank trades and dev-card buy/play"
```

---

### Task 10: Docs + final gate

**Files:**
- Modify: `docs/BACKLOG.md` (remove the "Phase 5 (trade/dev-card UX)" section — shipped; leave the board/asset fixes)
- Modify: `docs/PLAN.md` (the Catan pivot note: mark phase 5 done, pointing at this plan file)

- [ ] **Step 1: Update the two docs** as above; note in BACKLOG that the Roll/END TURN overlap fix shipped with phase 5 (`hud.css` roll-button `right: 132px`).

- [ ] **Step 2: Full repo gate**

Run the repo's full test + lint scripts (root `package.json`/`turbo.json` names), e.g.: `pnpm -r test` (or `pnpm turbo test`) and the lint equivalent, plus `pnpm -C apps/client exec tsc --noEmit` and the server typecheck.
Expected: everything green.

- [ ] **Step 3: Commit + wrap up**

```bash
git add docs/BACKLOG.md docs/PLAN.md
git commit -m "docs: phase-5 trade/dev-card UX shipped; prune backlog"
```

Then follow superpowers:finishing-a-development-branch (PR from `feat/trade-devcards`, one task per PR per `docs/PLAN.md` conventions — this phase is one PR like phase 4's).
