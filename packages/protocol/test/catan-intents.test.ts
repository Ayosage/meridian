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
    expect(
      catanIntentSchema.safeParse({ type: 'moveRobber', hex: { q: 0.5, r: 0 }, stealFrom: null }).success,
    ).toBe(false)
  })

  it('exposes MSG.START', () => {
    expect(MSG.START).toBe('start')
  })
})
