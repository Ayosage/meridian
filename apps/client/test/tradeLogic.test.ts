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
