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
