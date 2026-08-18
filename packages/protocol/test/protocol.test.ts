import { describe, expect, it } from 'vitest'
import type { Intent, PlayerId } from '@meridian/rules'
import {
  MSG,
  clientIntentSchema,
  matchEndedPayloadSchema,
  ruleErrorPayloadSchema,
  type ClientIntent,
} from '../src/index'

describe('clientIntentSchema', () => {
  it('accepts a move intent', () => {
    const parsed = clientIntentSchema.parse({
      type: 'move',
      pieceId: 'p0-0',
      to: { q: -2, r: 0 },
    })
    expect(parsed.type).toBe('move')
  })

  it('accepts an endTurn intent', () => {
    expect(clientIntentSchema.parse({ type: 'endTurn' }).type).toBe('endTurn')
  })

  it('rejects a client-supplied player field', () => {
    const r = clientIntentSchema.safeParse({
      type: 'endTurn',
      player: 1,
    })
    // strict schema: unknown keys rejected so clients cannot smuggle a seat
    expect(r.success).toBe(false)
  })

  it('rejects malformed payloads', () => {
    expect(clientIntentSchema.safeParse({ type: 'move' }).success).toBe(false)
    expect(clientIntentSchema.safeParse({ type: 'move', pieceId: '', to: { q: 0, r: 0 } }).success).toBe(false)
    expect(clientIntentSchema.safeParse({ type: 'teleport', pieceId: 'x', to: { q: 0, r: 0 } }).success).toBe(false)
    expect(clientIntentSchema.safeParse({ type: 'move', pieceId: 'x', to: { q: 0.5, r: 0 } }).success).toBe(false)
    expect(clientIntentSchema.safeParse(null).success).toBe(false)
  })

  it('a parsed ClientIntent plus a server seat is a valid engine Intent (compile-time)', () => {
    const clientIntent: ClientIntent = { type: 'endTurn' }
    const seat: PlayerId = 0
    const engineIntent: Intent = { ...clientIntent, player: seat }
    expect(engineIntent.player).toBe(0)
  })
})

describe('server payload schemas', () => {
  it('validates rule error payloads', () => {
    expect(
      ruleErrorPayloadSchema.parse({ code: 'NOT_YOUR_TURN', message: 'wait' }).code,
    ).toBe('NOT_YOUR_TURN')
    expect(ruleErrorPayloadSchema.safeParse({ code: 'X' }).success).toBe(false)
  })

  it('validates match ended payloads', () => {
    expect(matchEndedPayloadSchema.parse({ reason: 'forfeit', winner: 1 }).reason).toBe('forfeit')
    expect(matchEndedPayloadSchema.safeParse({ reason: 'ragequit', winner: 1 }).success).toBe(false)
  })

  it('exposes stable message-type names', () => {
    expect(MSG).toEqual({
      INTENT: 'intent',
      RULE_ERROR: 'ruleError',
      SNAPSHOT: 'snapshot',
      MATCH_ENDED: 'matchEnded',
    })
  })
})
