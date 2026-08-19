import { describe, expect, it } from 'vitest'
import {
  applyIntent,
  coordKey,
  initialState,
  isRuleError,
  legalMoves,
  placeholderRuleset,
  type GameState,
} from '../src/index'

function fresh(): GameState {
  return initialState(placeholderRuleset)
}

function keys(coords: { q: number; r: number }[]): Set<string> {
  return new Set(coords.map(coordKey))
}

describe('legalMoves', () => {
  it('lists on-board, non-friendly neighbor hexes for a corner piece', () => {
    expect(keys(legalMoves(fresh(), 'p0-0'))).toEqual(new Set(['-2,0', '-2,-1']))
  })

  it('includes enemy-occupied hexes (capture) and excludes friendly ones', () => {
    const state = fresh()
    // Move p0-0 adjacent to p1-0 at (3,0) by teleporting the test state
    const rigged: GameState = {
      ...state,
      pieces: state.pieces.map((p) => (p.id === 'p0-0' ? { ...p, at: { q: 2, r: 0 } } : p)),
    }
    const moves = keys(legalMoves(rigged, 'p0-0'))
    expect(moves.has('3,0')).toBe(true) // enemy: capturable
    expect(moves.has('2,0')).toBe(false) // own hex never included
  })

  it('returns [] for an unknown piece id', () => {
    expect(legalMoves(fresh(), 'nope')).toEqual([])
  })
})

describe('applyIntent — legal moves', () => {
  it('moves a piece, increments seq, rotates the turn, leaves input untouched', () => {
    const state = fresh()
    const result = applyIntent(state, {
      type: 'move',
      player: 0,
      pieceId: 'p0-0',
      to: { q: -2, r: 0 },
    })
    if (isRuleError(result)) throw new Error(result.message)
    expect(result.pieces.find((p) => p.id === 'p0-0')?.at).toEqual({ q: -2, r: 0 })
    expect(result.seq).toBe(1)
    expect(result.currentPlayer).toBe(1)
    // input state untouched
    expect(state.pieces.find((p) => p.id === 'p0-0')?.at).toEqual({ q: -3, r: 0 })
    expect(state.seq).toBe(0)
  })

  it('captures by displacement: enemy piece removed, mover takes its hex', () => {
    const state = fresh()
    const rigged: GameState = {
      ...state,
      pieces: state.pieces.map((p) => (p.id === 'p0-0' ? { ...p, at: { q: 2, r: 0 } } : p)),
    }
    const result = applyIntent(rigged, {
      type: 'move',
      player: 0,
      pieceId: 'p0-0',
      to: { q: 3, r: 0 },
    })
    if (isRuleError(result)) throw new Error(result.message)
    expect(result.pieces.find((p) => p.id === 'p1-0')).toBeUndefined()
    expect(result.pieces.find((p) => p.id === 'p0-0')?.at).toEqual({ q: 3, r: 0 })
    expect(result.pieces).toHaveLength(5)
  })

  it('endTurn passes: rotates and increments seq without moving anything', () => {
    const result = applyIntent(fresh(), { type: 'endTurn', player: 0 })
    if (isRuleError(result)) throw new Error(result.message)
    expect(result.currentPlayer).toBe(1)
    expect(result.seq).toBe(1)
    expect(result.pieces).toHaveLength(6)
  })
})

describe('applyIntent — illegal intents (state never changes)', () => {
  const cases: { name: string; code: string; run: (s: GameState) => ReturnType<typeof applyIntent> }[] = [
    {
      name: 'out of turn',
      code: 'NOT_YOUR_TURN',
      run: (s) => applyIntent(s, { type: 'move', player: 1, pieceId: 'p1-0', to: { q: 2, r: 0 } }),
    },
    {
      name: 'unknown piece',
      code: 'UNKNOWN_PIECE',
      run: (s) => applyIntent(s, { type: 'move', player: 0, pieceId: 'ghost', to: { q: -2, r: 0 } }),
    },
    {
      name: "opponent's piece",
      code: 'NOT_PIECE_OWNER',
      run: (s) => applyIntent(s, { type: 'move', player: 0, pieceId: 'p1-0', to: { q: 2, r: 0 } }),
    },
    {
      name: 'destination off board',
      code: 'OFF_BOARD',
      run: (s) => applyIntent(s, { type: 'move', player: 0, pieceId: 'p0-0', to: { q: -4, r: 0 } }),
    },
    {
      name: 'destination beyond range',
      code: 'OUT_OF_RANGE',
      run: (s) => applyIntent(s, { type: 'move', player: 0, pieceId: 'p0-0', to: { q: -1, r: 0 } }),
    },
    {
      name: 'destination equals current hex',
      code: 'OUT_OF_RANGE',
      run: (s) => applyIntent(s, { type: 'move', player: 0, pieceId: 'p0-0', to: { q: -3, r: 0 } }),
    },
    {
      name: 'destination occupied by friendly piece',
      code: 'OCCUPIED_BY_FRIENDLY',
      run: (s) => applyIntent(s, { type: 'move', player: 0, pieceId: 'p0-0', to: { q: -3, r: 1 } }),
    },
  ]

  for (const c of cases) {
    it(`rejects ${c.name} with ${c.code}`, () => {
      const state = fresh()
      const result = c.run(state)
      if (!isRuleError(result)) throw new Error('expected RuleError')
      expect(result.code).toBe(c.code)
      expect(state.seq).toBe(0)
      expect(state.pieces).toHaveLength(6)
    })
  }

  it('rejects any intent once the game is over with GAME_OVER', () => {
    const done: GameState = { ...fresh(), winner: 1 }
    const result = applyIntent(done, { type: 'endTurn', player: 0 })
    if (!isRuleError(result)) throw new Error('expected RuleError')
    expect(result.code).toBe('GAME_OVER')
  })
})
