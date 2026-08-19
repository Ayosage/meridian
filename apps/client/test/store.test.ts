import { beforeEach, describe, expect, it } from 'vitest'
import { applyIntent, initialState, isRuleError, placeholderRuleset } from '@meridian/rules'
import { useMeridianStore } from '../src/store'

function fresh() {
  return initialState(placeholderRuleset)
}

beforeEach(() => {
  useMeridianStore.getState().reset()
})

describe('selection rules', () => {
  it('selecting an own piece on own turn computes legal targets', () => {
    const s = useMeridianStore.getState()
    s.setSeat(0)
    s.setGame(fresh())
    useMeridianStore.getState().selectPiece('p0-0')
    const after = useMeridianStore.getState()
    expect(after.selectedPieceId).toBe('p0-0')
    expect(after.legalTargets).toEqual(new Set(['-2,0', '-2,-1']))
  })

  it("refuses to select the opponent's piece or out of turn", () => {
    const s = useMeridianStore.getState()
    s.setSeat(0)
    s.setGame(fresh())
    useMeridianStore.getState().selectPiece('p1-0') // opponent's
    expect(useMeridianStore.getState().selectedPieceId).toBeNull()

    useMeridianStore.getState().setSeat(1) // now we're seat 1, but currentPlayer is 0
    useMeridianStore.getState().selectPiece('p1-0')
    expect(useMeridianStore.getState().selectedPieceId).toBeNull()
  })

  it('a new game state after our move clears the stale selection', () => {
    const s = useMeridianStore.getState()
    s.setSeat(0)
    s.setGame(fresh())
    useMeridianStore.getState().selectPiece('p0-0')
    const moved = applyIntent(fresh(), { type: 'move', player: 0, pieceId: 'p0-0', to: { q: -2, r: 0 } })
    if (isRuleError(moved)) throw new Error(moved.message)
    useMeridianStore.getState().setGame(moved) // turn is now seat 1's
    const after = useMeridianStore.getState()
    expect(after.selectedPieceId).toBeNull()
    expect(after.legalTargets.size).toBe(0)
  })
})

describe('status transitions', () => {
  it('setJoined enters waiting with the code', () => {
    useMeridianStore.getState().setJoined('ABCD')
    const s = useMeridianStore.getState()
    expect(s.status).toBe('waiting')
    expect(s.joinCode).toBe('ABCD')
  })

  it('setGame flips to playing, or ended when a winner exists', () => {
    useMeridianStore.getState().setGame(fresh())
    expect(useMeridianStore.getState().status).toBe('playing')
    useMeridianStore.getState().setGame({ ...fresh(), winner: 1 })
    expect(useMeridianStore.getState().status).toBe('ended')
  })

  it('setMatchResult ends the match and clears selection', () => {
    const s = useMeridianStore.getState()
    s.setSeat(0)
    s.setGame(fresh())
    useMeridianStore.getState().selectPiece('p0-0')
    useMeridianStore.getState().setMatchResult({ reason: 'forfeit', winner: 0 })
    const after = useMeridianStore.getState()
    expect(after.status).toBe('ended')
    expect(after.matchResult).toEqual({ reason: 'forfeit', winner: 0 })
    expect(after.selectedPieceId).toBeNull()
  })
})
