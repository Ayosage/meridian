import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/** In-memory Storage polyfill, matching tokenStorage.test.ts's FakeSessionStorage idiom. */
class FakeLocalStorage {
  private data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
}

beforeEach(() => {
  useCatanStore.getState().reset()
  // tradeMute is a device-level preference (deliberately NOT cleared by
  // reset() — see catanStore.ts), so tests must force it back explicitly.
  useCatanStore.setState({ tradeMute: false })
})

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
    const s = useCatanStore.getState()
    s.startCounter()
    s.toggleTrade(); s.incTradeGive('wood'); s.incTradeGet('ore')
    expect(useCatanStore.getState().counterDraft).not.toBeNull()
    expect(useCatanStore.getState().tradeGive.wood).toBe(1)
    expect(useCatanStore.getState().tradeGet.ore).toBe(1)
    useCatanStore.getState().ingestSnapshot({
      seq: 2,
      view: makeView({ seq: 2, turn: { ...MAIN, current: 1, openTrade: null } }),
    })
    expect(useCatanStore.getState().counterDraft).toBeNull()
    expect(useCatanStore.getState().tradeGive.wood).toBe(0)
    expect(useCatanStore.getState().tradeGet.ore).toBe(0)
  })

  it('openTrade appearing on our own turn (our offer posting) resets staged composer selections', () => {
    seed(MAIN, { wood: 4, ore: 1 }) // current: 0 === our seat; openTrade starts null
    const s = useCatanStore.getState()
    s.toggleTrade(); s.incTradeGive('wood'); s.incTradeGet('ore')
    expect(useCatanStore.getState().tradeGive.wood).toBe(1)
    expect(useCatanStore.getState().tradeGet.ore).toBe(1)
    useCatanStore.getState().ingestSnapshot({
      seq: 2,
      view: makeView({ seq: 2, turn: { ...MAIN, current: 0, openTrade: OPEN } }),
    })
    expect(useCatanStore.getState().tradeGive.wood).toBe(0)
    expect(useCatanStore.getState().tradeGet.ore).toBe(0)
  })

  it('a snapshot with openTrade still set (another responder answered) preserves an in-progress counterDraft', () => {
    seed({ ...MAIN, current: 1, openTrade: OPEN }, { wood: 0, ore: 1 })
    useCatanStore.getState().startCounter()
    const draftBefore = useCatanStore.getState().counterDraft
    expect(draftBefore).not.toBeNull()
    // Another player's response lands; our offer is still open (not resolved).
    useCatanStore.getState().ingestSnapshot({
      seq: 2,
      view: makeView({
        seq: 2,
        turn: { ...MAIN, current: 1, openTrade: { ...OPEN, responses: { 2: { kind: 'reject' } } } },
      }),
    })
    expect(useCatanStore.getState().counterDraft).toEqual(draftBefore)
  })
})

describe('trade mute toggle', () => {
  const original = (globalThis as { localStorage?: Storage }).localStorage

  afterEach(() => {
    ;(globalThis as { localStorage?: Storage }).localStorage = original
  })

  it('defaults OFF (defensive read: this test env has no localStorage at module init)', () => {
    expect(useCatanStore.getState().tradeMute).toBe(false)
  })

  it('toggleTradeMute flips state and persists the choice', () => {
    const fake = new FakeLocalStorage()
    ;(globalThis as { localStorage?: Storage }).localStorage = fake as unknown as Storage
    useCatanStore.getState().toggleTradeMute()
    expect(useCatanStore.getState().tradeMute).toBe(true)
    expect(fake.getItem('meridian.tradeMute')).toBe('1')
    useCatanStore.getState().toggleTradeMute()
    expect(useCatanStore.getState().tradeMute).toBe(false)
    expect(fake.getItem('meridian.tradeMute')).toBe('0')
  })

  it('still flips state when storage throws (private mode / disabled storage)', () => {
    ;(globalThis as { localStorage?: Storage }).localStorage = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
      removeItem() {},
    } as unknown as Storage
    expect(() => useCatanStore.getState().toggleTradeMute()).not.toThrow()
    expect(useCatanStore.getState().tradeMute).toBe(true)
  })
})

describe('auto-decline while muted', () => {
  it('sends a reject for an unanswered incoming offer while muted, exactly once', () => {
    seed({ ...MAIN, current: 1, openTrade: OPEN }) // seat 0 is the responder
    useCatanStore.getState().toggleTradeMute()
    const send = vi.fn()
    useCatanStore.getState().autoDeclineIfMuted(send)
    expect(send).toHaveBeenCalledWith({ type: 'respondTrade', response: 'reject' })
    useCatanStore.getState().autoDeclineIfMuted(send) // same snapshot: still pending, must not resend
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does nothing while unmuted', () => {
    seed({ ...MAIN, current: 1, openTrade: OPEN })
    const send = vi.fn()
    useCatanStore.getState().autoDeclineIfMuted(send)
    expect(send).not.toHaveBeenCalled()
  })

  it('the pending guard clears once the offer closes, so the next offer auto-declines too', () => {
    seed({ ...MAIN, current: 1, openTrade: OPEN })
    useCatanStore.getState().toggleTradeMute()
    const send = vi.fn()
    useCatanStore.getState().autoDeclineIfMuted(send)
    expect(send).toHaveBeenCalledTimes(1)

    useCatanStore.getState().ingestSnapshot({
      seq: 2,
      view: makeView({ seq: 2, turn: { ...MAIN, current: 1, openTrade: null } }),
    })
    useCatanStore.getState().ingestSnapshot({
      seq: 3,
      view: makeView({ seq: 3, turn: { ...MAIN, current: 1, openTrade: OPEN } }),
    })
    useCatanStore.getState().autoDeclineIfMuted(send)
    expect(send).toHaveBeenCalledTimes(2)
  })
})
