import { describe, expect, it } from 'vitest'
import {
  advanceTurn,
  applyIntent,
  initialState,
  isRuleError,
  loadRuleset,
  placeholderRuleset,
  type GameState,
} from '../src/index'

/** State where player 1 has a single piece adjacent to a player-0 piece. */
function nearWinState(): GameState {
  const base = initialState(placeholderRuleset)
  return {
    ...base,
    pieces: [
      { id: 'p0-0', owner: 0, type: 'runner', at: { q: 0, r: 0 } },
      { id: 'p1-0', owner: 1, type: 'runner', at: { q: 1, r: 0 } },
    ],
  }
}

describe('win detection', () => {
  it('capturing the last enemy piece sets the winner', () => {
    const result = applyIntent(nearWinState(), {
      type: 'move',
      player: 0,
      pieceId: 'p0-0',
      to: { q: 1, r: 0 },
    })
    if (isRuleError(result)) throw new Error(result.message)
    expect(result.winner).toBe(0)
    expect(result.pieces).toHaveLength(1)
  })

  it('a non-final capture does not set a winner', () => {
    const state = initialState(placeholderRuleset)
    const rigged: GameState = {
      ...state,
      pieces: state.pieces.map((p) => (p.id === 'p0-0' ? { ...p, at: { q: 2, r: 0 } } : p)),
    }
    const result = applyIntent(rigged, { type: 'move', player: 0, pieceId: 'p0-0', to: { q: 3, r: 0 } })
    if (isRuleError(result)) throw new Error(result.message)
    expect(result.winner).toBeNull()
  })

  it('after a win, further intents are rejected with GAME_OVER', () => {
    const won = applyIntent(nearWinState(), {
      type: 'move',
      player: 0,
      pieceId: 'p0-0',
      to: { q: 1, r: 0 },
    })
    if (isRuleError(won)) throw new Error(won.message)
    const after = applyIntent(won, { type: 'endTurn', player: won.currentPlayer })
    if (!isRuleError(after)) throw new Error('expected RuleError')
    expect(after.code).toBe('GAME_OVER')
  })
})

describe('turn rotation', () => {
  it('rotation skips eliminated players (3-player ruleset)', () => {
    const three = loadRuleset({
      name: 'Three',
      board: { shape: 'hex', radius: 3 },
      playerCount: 3,
      pieces: [
        { type: 'runner', movement: { pattern: 'step', range: 1 }, capture: { rule: 'displace' } },
      ],
      setup: [
        { player: 0, type: 'runner', at: { q: -3, r: 0 } },
        { player: 1, type: 'runner', at: { q: 3, r: 0 } },
        { player: 2, type: 'runner', at: { q: 0, r: 3 } },
      ],
      win: { rule: 'lastPlayerStanding' },
    })
    const base = initialState(three)
    // Player 1 eliminated: remove their piece; players 0 and 2 remain.
    const state: GameState = { ...base, pieces: base.pieces.filter((p) => p.owner !== 1) }
    const next = advanceTurn(state)
    expect(next.currentPlayer).toBe(2)
    expect(next.seq).toBe(1)
    expect(next.winner).toBeNull()
  })

  it('two live players rotate 0 -> 1 -> 0', () => {
    const s0 = initialState(placeholderRuleset)
    const s1 = advanceTurn(s0)
    expect(s1.currentPlayer).toBe(1)
    const s2 = advanceTurn(s1)
    expect(s2.currentPlayer).toBe(0)
    expect(s2.seq).toBe(2)
  })
})
