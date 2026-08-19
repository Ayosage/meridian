import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialState, placeholderRuleset } from '@meridian/rules'

const sent: unknown[] = []
vi.mock('../src/net/connection', () => ({
  sendIntent: (intent: unknown) => {
    sent.push(intent)
  },
}))

import { useMeridianStore } from '../src/store'
import { clickPiece, clickTile, endTurn } from '../src/interaction'

beforeEach(() => {
  sent.length = 0
  useMeridianStore.getState().reset()
  useMeridianStore.getState().setSeat(0)
  useMeridianStore.getState().setGame(initialState(placeholderRuleset))
})

describe('click flow', () => {
  it('select own piece, then a legal tile → move intent sent, selection cleared', () => {
    clickPiece('p0-0')
    expect(useMeridianStore.getState().selectedPieceId).toBe('p0-0')
    clickTile({ q: -2, r: 0 })
    expect(sent).toEqual([{ type: 'move', pieceId: 'p0-0', to: { q: -2, r: 0 } }])
    expect(useMeridianStore.getState().selectedPieceId).toBeNull()
  })

  it('clicking an illegal tile clears the selection without sending', () => {
    clickPiece('p0-0')
    clickTile({ q: 0, r: 0 })
    expect(sent).toEqual([])
    expect(useMeridianStore.getState().selectedPieceId).toBeNull()
  })

  it('clicking a tile with no selection is a no-op', () => {
    clickTile({ q: -2, r: 0 })
    expect(sent).toEqual([])
  })

  it("clicking an enemy piece with a selection targets its hex (capture path)", () => {
    // rig: our piece adjacent to the enemy
    const base = initialState(placeholderRuleset)
    const rigged = {
      ...base,
      pieces: base.pieces.map((p) => (p.id === 'p0-0' ? { ...p, at: { q: 2, r: 0 } } : p)),
    }
    useMeridianStore.getState().setGame(rigged)
    clickPiece('p0-0')
    clickPiece('p1-0') // enemy on (3,0) — in legal targets
    expect(sent).toEqual([{ type: 'move', pieceId: 'p0-0', to: { q: 3, r: 0 } }])
  })

  it('endTurn sends the pass intent', () => {
    endTurn()
    expect(sent).toEqual([{ type: 'endTurn' }])
  })
})
