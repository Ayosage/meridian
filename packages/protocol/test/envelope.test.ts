import { describe, expect, it } from 'vitest'
import { clientEnvelopeSchema, serverEnvelopeSchema } from '../src/envelope'

describe('envelope', () => {
  it('accepts the three client messages and rejects unknown keys', () => {
    expect(clientEnvelopeSchema.safeParse({ t: 'hello' }).success).toBe(true)
    expect(
      clientEnvelopeSchema.safeParse({ t: 'hello', token: 'tok', seatToken: 'st_1', displayName: 'Alice' }).success,
    ).toBe(true)
    expect(clientEnvelopeSchema.safeParse({ t: 'intent', intent: { type: 'rollDice' } }).success).toBe(true)
    expect(clientEnvelopeSchema.safeParse({ t: 'start' }).success).toBe(true)
    expect(clientEnvelopeSchema.safeParse({ t: 'start', extra: 1 }).success).toBe(false)
    expect(clientEnvelopeSchema.safeParse({ t: 'nope' }).success).toBe(false)
  })
  it('accepts the host configure message and rejects a malformed one', () => {
    expect(clientEnvelopeSchema.safeParse({ t: 'configure', players: 4, bots: 1 }).success).toBe(true)
    expect(clientEnvelopeSchema.safeParse({ t: 'configure', players: 4 }).success).toBe(false)
    expect(clientEnvelopeSchema.safeParse({ t: 'configure', players: 'four', bots: 0 }).success).toBe(false)
    expect(clientEnvelopeSchema.safeParse({ t: 'configure', players: 4, bots: -1 }).success).toBe(false)
  })
  it('accepts the five server messages', () => {
    const ok = (m: unknown) => expect(serverEnvelopeSchema.safeParse(m).success).toBe(true)
    ok({ t: 'welcome', seat: 0, token: 'tok' })
    ok({ t: 'lobby', phase: 'waiting', seats: ['a'], connected: [true], targetPlayers: 4, botCount: 0, seatNames: [] })
    ok({ t: 'snapshot', seq: 3, view: { any: 'thing' } })
    ok({ t: 'snapshot', seq: 3, view: {}, events: [{ kind: 'roll' }] })
    ok({ t: 'error', code: 'BAD_PHASE', message: 'not now' })
    ok({ t: 'ended', reason: 'win', winner: 2 })
    expect(serverEnvelopeSchema.safeParse({ t: 'welcome', seat: -1, token: 't' }).success).toBe(false)
  })
})
