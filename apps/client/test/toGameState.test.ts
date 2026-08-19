import { describe, expect, it } from 'vitest'
import { placeholderRuleset } from '@meridian/rules'
import { toGameState } from '../src/net/toGameState'
import type { ClientMatchState, ClientPiece } from '../src/net/types'

function fakeState(pieces: ClientPiece[], overrides: Partial<ClientMatchState> = {}): ClientMatchState {
  return {
    phase: 'playing',
    currentPlayer: 0,
    winner: -1,
    seq: 0,
    pieces: { forEach: (cb) => pieces.forEach(cb) },
    seats: { indexOf: () => -1, length: 2 },
    ...overrides,
  }
}

const P = (id: string, owner: number, q: number, r: number): ClientPiece => ({
  id,
  owner,
  pieceType: 'runner',
  q,
  r,
})

describe('toGameState', () => {
  it('reconstructs pieces with engine field names, sorted by id', () => {
    const gs = toGameState(fakeState([P('p1-0', 1, 3, 0), P('p0-0', 0, -3, 0)]), placeholderRuleset)
    expect(gs.pieces.map((p) => p.id)).toEqual(['p0-0', 'p1-0'])
    expect(gs.pieces[0]).toEqual({ id: 'p0-0', owner: 0, type: 'runner', at: { q: -3, r: 0 } })
    expect(gs.ruleset).toBe(placeholderRuleset)
  })

  it('maps scalar fields and the -1 winner sentinel to null', () => {
    const gs = toGameState(fakeState([], { currentPlayer: 1, seq: 7, winner: -1 }), placeholderRuleset)
    expect(gs.currentPlayer).toBe(1)
    expect(gs.seq).toBe(7)
    expect(gs.winner).toBeNull()
  })

  it('maps a decided winner through', () => {
    const gs = toGameState(fakeState([], { winner: 1 }), placeholderRuleset)
    expect(gs.winner).toBe(1)
  })

  it('the reconstructed state feeds the engine: legalMoves works on it', async () => {
    const { legalMoves, coordKey } = await import('@meridian/rules')
    const gs = toGameState(
      fakeState([P('p0-0', 0, -3, 0), P('p0-1', 0, -3, 1)]),
      placeholderRuleset,
    )
    const keys = new Set(legalMoves(gs, 'p0-0').map(coordKey))
    expect(keys).toEqual(new Set(['-2,0', '-2,-1']))
  })
})
