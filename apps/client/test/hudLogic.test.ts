import { describe, expect, it } from 'vitest'
import { createCatanGame, createRng, redactCatanState, type CatanClientState } from '@meridian/rules'
import { playerCards } from '../src/scene/catan/hudLogic'

/** Real-engine view; you.devCards / turn overridable per test. */
function makeView(overrides: {
  seat?: number
  devCards?: CatanClientState['you']['devCards']
} = {}): CatanClientState {
  const state = createCatanGame({ playerCount: 4 }, createRng(1))
  const base = redactCatanState(state, overrides.seat ?? 0)
  return {
    ...base,
    you: { ...base.you, devCards: overrides.devCards ?? base.you.devCards },
  }
}

describe('playerCards', () => {
  it('returns one card per seat in seat order, marking the local seat', () => {
    const view = makeView({ seat: 2 })
    const cards = playerCards(view, 2, [true, true, true, true])
    expect(cards.map((c) => c.seat)).toEqual([0, 1, 2, 3])
    expect(cards.map((c) => c.isYou)).toEqual([false, false, true, false])
  })

  it("counts the local seat's hidden VP dev cards in its VP", () => {
    const view = makeView({
      devCards: [
        { card: 'vp', boughtOnTurn: 0 },
        { card: 'vp', boughtOnTurn: 1 },
        { card: 'knight', boughtOnTurn: 1 },
      ],
    })
    const cards = playerCards(view, 0, [true, true, true, true])
    // Fresh game: no buildings/awards, so public VP is 0 for everyone —
    // the self card still shows the two hidden VP cards.
    expect(cards[0]!.vp).toBe(2)
    expect(cards[1]!.vp).toBe(0)
  })

  it('flags autopilot seats from the connected roster', () => {
    const view = makeView()
    const cards = playerCards(view, 0, [true, false, true, true])
    expect(cards.map((c) => c.autopilot)).toEqual([false, true, false, false])
  })

  it('marks no card as you for a null seat (spectator)', () => {
    const view = makeView()
    const cards = playerCards(view, null, [true, true, true, true])
    expect(cards.every((c) => !c.isYou)).toBe(true)
    expect(cards).toHaveLength(4)
  })
})

describe('playerCards at 8 seats', () => {
  it('returns 8 cards in seat order for an 8-player view', () => {
    const state = createCatanGame({ playerCount: 8 }, createRng(1))
    const view = { ...redactCatanState(state, 0) }
    const cards = playerCards(view, 0, new Array(8).fill(true))
    expect(cards).toHaveLength(8)
    expect(cards.map((c) => c.seat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
})
