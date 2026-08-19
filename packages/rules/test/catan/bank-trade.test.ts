import { describe, expect, it } from 'vitest'
import { bankTradeRate } from '../../src/index'
import { apply, expectError, inMain, setupComplete, withResources } from './helpers'

describe('bankTradeRate', () => {
  it('reads ports off the players buildings', () => {
    const state = setupComplete()
    expect(bankTradeRate(state, 0, 'brick')).toBe(2) // brick port
    expect(bankTradeRate(state, 0, 'wood')).toBe(4) // brick port does not help wood
    expect(bankTradeRate(state, 2, 'wheat')).toBe(2) // wheat port
    expect(bankTradeRate(state, 3, 'ore')).toBe(3) // generic port
    expect(bankTradeRate(state, 1, 'ore')).toBe(3) // generic port (second settlement)
  })
})

describe('bankTrade', () => {
  it('4:1 with no port', () => {
    let state = withResources(inMain(), 0, { wood: 4 })
    const bankWood = state.bank.wood
    state = apply(state, { type: 'bankTrade', player: 0, give: 'wood', get: 'sheep' })
    expect(state.players[0]!.resources.wood).toBe(0)
    expect(state.players[0]!.resources.sheep).toBe(1)
    expect(state.bank.wood).toBe(bankWood + 4)
  })

  it('2:1 on a matching port', () => {
    let state = withResources(inMain(), 0, { brick: 2 })
    state = apply(state, { type: 'bankTrade', player: 0, give: 'brick', get: 'wheat' })
    expect(state.players[0]!.resources.brick).toBe(0)
    expect(state.players[0]!.resources.wheat).toBe(1)
  })

  it('rejects self-trades, unaffordable trades, empty bank, wrong phase', () => {
    const state = withResources(inMain(), 0, { brick: 2 })
    expectError(state, { type: 'bankTrade', player: 0, give: 'brick', get: 'brick' }, 'BAD_TRADE')
    expectError(state, { type: 'bankTrade', player: 0, give: 'wood', get: 'sheep' }, 'CANT_AFFORD')
    const drained = { ...state, bank: { ...state.bank, wheat: 0 } }
    expectError(drained, { type: 'bankTrade', player: 0, give: 'brick', get: 'wheat' }, 'BANK_SHORT')
    expectError(setupComplete(), { type: 'bankTrade', player: 0, give: 'brick', get: 'wheat' }, 'BAD_PHASE')
  })
})
