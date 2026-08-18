import { describe, expect, it } from 'vitest'
import { applyIntent, initialState, isRuleError, placeholderRuleset } from '@meridian/rules'
import { MatchState, syncFromGameState } from '../src/schema/MatchState'

describe('syncFromGameState', () => {
  it('mirrors scalars and all pieces of the initial state', () => {
    const gs = initialState(placeholderRuleset)
    const schema = new MatchState()
    syncFromGameState(schema, gs)
    expect(schema.seq).toBe(0)
    expect(schema.currentPlayer).toBe(0)
    expect(schema.winner).toBe(-1)
    expect(schema.pieces.size).toBe(6)
    const p00 = schema.pieces.get('p0-0')
    expect(p00).toBeDefined()
    expect(p00!.owner).toBe(0)
    expect(p00!.pieceType).toBe('runner')
    expect(p00!.q).toBe(-3)
    expect(p00!.r).toBe(0)
  })

  it('re-sync after a capture removes the captured piece and moves the capturer', () => {
    const gs0 = initialState(placeholderRuleset)
    const rigged = {
      ...gs0,
      pieces: gs0.pieces.map((p) => (p.id === 'p0-0' ? { ...p, at: { q: 2, r: 0 } } : p)),
    }
    const schema = new MatchState()
    syncFromGameState(schema, rigged)
    expect(schema.pieces.size).toBe(6)

    const gs1 = applyIntent(rigged, { type: 'move', player: 0, pieceId: 'p0-0', to: { q: 3, r: 0 } })
    if (isRuleError(gs1)) throw new Error(gs1.message)
    syncFromGameState(schema, gs1)
    expect(schema.pieces.size).toBe(5)
    expect(schema.pieces.get('p1-0')).toBeUndefined()
    expect(schema.pieces.get('p0-0')!.q).toBe(3)
    expect(schema.seq).toBe(1)
    expect(schema.currentPlayer).toBe(1)
  })

  it('mirrors a decided winner', () => {
    const gs = { ...initialState(placeholderRuleset), winner: 1 }
    const schema = new MatchState()
    syncFromGameState(schema, gs)
    expect(schema.winner).toBe(1)
  })
})
