import type { GameState, Piece, Ruleset } from '@meridian/rules'
import type { ClientMatchState } from './types'

/**
 * Reconstruct the plain engine GameState from the synced schema plus the
 * bundled ruleset (the schema does not carry the ruleset — spec §2).
 * Pieces are sorted by id: MapSchema iteration order is not guaranteed.
 */
export function toGameState(schema: ClientMatchState, ruleset: Ruleset): GameState {
  const pieces: Piece[] = []
  schema.pieces.forEach((p) => {
    pieces.push({ id: p.id, owner: p.owner, type: p.pieceType, at: { q: p.q, r: p.r } })
  })
  pieces.sort((a, b) => a.id.localeCompare(b.id))
  return {
    ruleset,
    seq: schema.seq,
    currentPlayer: schema.currentPlayer,
    pieces,
    winner: schema.winner === -1 ? null : schema.winner,
  }
}
