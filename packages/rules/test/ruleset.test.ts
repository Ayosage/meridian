import { describe, expect, it } from 'vitest'
import { initialState, loadRuleset, placeholderRuleset } from '../src/index'

function validRuleset(): Record<string, unknown> {
  return {
    name: 'Test',
    board: { shape: 'hex', radius: 2 },
    playerCount: 2,
    pieces: [
      {
        type: 'runner',
        movement: { pattern: 'step', range: 1 },
        capture: { rule: 'displace' },
      },
    ],
    setup: [
      { player: 0, type: 'runner', at: { q: -2, r: 0 } },
      { player: 1, type: 'runner', at: { q: 2, r: 0 } },
    ],
    win: { rule: 'lastPlayerStanding' },
  }
}

describe('loadRuleset', () => {
  it('accepts a valid ruleset', () => {
    const rs = loadRuleset(validRuleset())
    expect(rs.name).toBe('Test')
    expect(rs.board.radius).toBe(2)
  })

  it('rejects a setup coordinate off the board', () => {
    const bad = validRuleset()
    ;(bad.setup as { at: { q: number; r: number } }[])[0]!.at = { q: 3, r: 0 }
    expect(() => loadRuleset(bad)).toThrow(/off the board/i)
  })

  it('rejects a setup entry with an unknown piece type', () => {
    const bad = validRuleset()
    ;(bad.setup as { type: string }[])[0]!.type = 'dragon'
    expect(() => loadRuleset(bad)).toThrow(/unknown piece type/i)
  })

  it('rejects a setup player index out of range', () => {
    const bad = validRuleset()
    ;(bad.setup as { player: number }[])[0]!.player = 2
    expect(() => loadRuleset(bad)).toThrow(/player index/i)
  })

  it('rejects duplicate setup coordinates', () => {
    const bad = validRuleset()
    ;(bad.setup as { at: { q: number; r: number } }[])[1]!.at = { q: -2, r: 0 }
    expect(() => loadRuleset(bad)).toThrow(/duplicate/i)
  })

  it('rejects structurally invalid data', () => {
    expect(() => loadRuleset({ name: 'x' })).toThrow()
    expect(() => loadRuleset(null)).toThrow()
    const bad = validRuleset()
    ;(bad.board as { shape: string }).shape = 'square'
    expect(() => loadRuleset(bad)).toThrow()
  })
})

describe('placeholder ruleset', () => {
  it('loads and matches the brief: hex radius 3, 2 players, 3 runners each', () => {
    expect(placeholderRuleset.board).toEqual({ shape: 'hex', radius: 3 })
    expect(placeholderRuleset.playerCount).toBe(2)
    expect(placeholderRuleset.setup).toHaveLength(6)
    expect(placeholderRuleset.setup.filter((s) => s.player === 0)).toHaveLength(3)
    expect(placeholderRuleset.setup.filter((s) => s.player === 1)).toHaveLength(3)
  })
})

describe('initialState', () => {
  it('places all setup pieces with deterministic ids and starting player 0', () => {
    const state = initialState(placeholderRuleset)
    expect(state.seq).toBe(0)
    expect(state.currentPlayer).toBe(0)
    expect(state.winner).toBeNull()
    expect(state.pieces).toHaveLength(6)
    const p00 = state.pieces.find((p) => p.id === 'p0-0')
    expect(p00).toMatchObject({ owner: 0, type: 'runner', at: { q: -3, r: 0 } })
    const p12 = state.pieces.find((p) => p.id === 'p1-2')
    expect(p12).toMatchObject({ owner: 1, type: 'runner', at: { q: 3, r: -2 } })
    expect(state.ruleset).toBe(placeholderRuleset)
  })
})
