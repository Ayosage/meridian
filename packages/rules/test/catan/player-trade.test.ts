import { describe, expect, it } from 'vitest'
import type { CatanState } from '../../src/index'
import { apply, expectError, inMain, withResources } from './helpers'

/** P0 in main with 2 wood; P1 holds 1 ore; P2 holds 1 ore + 1 wheat (plus their setup payouts). */
function tradeScene(): CatanState {
  let state = inMain()
  state = withResources(state, 0, { wood: 2 })
  state = withResources(state, 1, { ore: 1 })
  state = withResources(state, 2, { ore: 1, wheat: 1 })
  return state
}

describe('player trading', () => {
  it('offer -> accept -> confirm executes the posted terms', () => {
    let state = tradeScene()
    state = apply(state, { type: 'offerTrade', player: 0, give: { wood: 2 }, get: { ore: 1 } })
    expect(state.turn.openTrade).toMatchObject({ give: { wood: 2 }, get: { ore: 1 } })
    state = apply(state, { type: 'respondTrade', player: 1, response: 'accept' })
    state = apply(state, { type: 'confirmTrade', player: 0, partner: 1 })
    expect(state.turn.openTrade).toBeNull()
    expect(state.players[0]!.resources.wood).toBe(0)
    expect(state.players[0]!.resources.ore).toBe(2) // 1 setup + 1 traded
    expect(state.players[1]!.resources.wood).toBe(2)
    expect(state.players[1]!.resources.ore).toBe(0)
  })

  it('offer -> counter -> confirm executes the countered terms', () => {
    let state = tradeScene()
    state = apply(state, { type: 'offerTrade', player: 0, give: { wood: 2 }, get: { ore: 1 } })
    // P2 counters: they would give 1 wheat and want only 1 wood
    state = apply(state, { type: 'respondTrade', player: 2, response: { give: { wheat: 1 }, get: { wood: 1 } } })
    state = apply(state, { type: 'confirmTrade', player: 0, partner: 2 })
    expect(state.players[0]!.resources.wood).toBe(1)
    expect(state.players[0]!.resources.wheat).toBe(1)
    expect(state.players[2]!.resources.wood).toBe(1)
    expect(state.players[2]!.resources.wheat).toBe(0) // held exactly 1 wheat (setup payout was ore), gave it away
  })

  it('reject cannot be confirmed; cancel clears the offer', () => {
    let state = tradeScene()
    state = apply(state, { type: 'offerTrade', player: 0, give: { wood: 1 }, get: { ore: 1 } })
    state = apply(state, { type: 'respondTrade', player: 1, response: 'reject' })
    expectError(state, { type: 'confirmTrade', player: 0, partner: 1 }, 'BAD_TRADE')
    expectError(state, { type: 'confirmTrade', player: 0, partner: 3 }, 'BAD_TRADE') // never responded
    state = apply(state, { type: 'cancelTrade', player: 0 })
    expect(state.turn.openTrade).toBeNull()
    expectError(state, { type: 'confirmTrade', player: 0, partner: 1 }, 'NO_TRADE')
  })

  it('guards: only current player offers/confirms, only others respond, hands must cover', () => {
    let state = tradeScene()
    expectError(state, { type: 'respondTrade', player: 1, response: 'accept' }, 'NO_TRADE')
    expectError(state, { type: 'offerTrade', player: 1, give: { ore: 1 }, get: { wood: 1 } }, 'NOT_YOUR_TURN')
    expectError(state, { type: 'offerTrade', player: 0, give: { wood: 5 }, get: { ore: 1 } }, 'CANT_AFFORD')
    expectError(state, { type: 'offerTrade', player: 0, give: {}, get: { ore: 1 } }, 'BAD_TRADE')
    expectError(state, { type: 'offerTrade', player: 0, give: { wood: 1 }, get: {} }, 'BAD_TRADE')
    state = apply(state, { type: 'offerTrade', player: 0, give: { wood: 2 }, get: { ore: 1 } })
    expectError(state, { type: 'offerTrade', player: 0, give: { wood: 1 }, get: { ore: 1 } }, 'BAD_TRADE') // one at a time
    expectError(state, { type: 'respondTrade', player: 0, response: 'accept' }, 'BAD_TRADE') // own offer
    expectError(state, { type: 'respondTrade', player: 3, response: { give: { ore: 9 }, get: { wood: 1 } } }, 'CANT_AFFORD')
    // acceptance without the goods dies at confirm time:
    state = apply(state, { type: 'respondTrade', player: 3, response: 'accept' }) // P3 holds 1 brick, no ore
    expectError(state, { type: 'confirmTrade', player: 0, partner: 3 }, 'CANT_AFFORD')
  })
})
