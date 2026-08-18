import { coordsEqual, distance, inRadius, type Coord } from './coord'
import type { GameState } from './state'

/**
 * Destinations for a piece: on the board, within its movement range,
 * not its own hex, not friendly-occupied. Enemy-occupied hexes are
 * included — capture is by displacement.
 */
export function legalMoves(state: GameState, pieceId: string): Coord[] {
  const piece = state.pieces.find((p) => p.id === pieceId)
  if (!piece) return []
  const def = state.ruleset.pieces.find((d) => d.type === piece.type)
  if (!def) return []
  const range = def.movement.range
  const radius = state.ruleset.board.radius
  const out: Coord[] = []
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const c = { q, r }
      if (!inRadius(c, radius)) continue
      const d = distance(piece.at, c)
      if (d === 0 || d > range) continue
      const occupant = state.pieces.find((p) => coordsEqual(p.at, c))
      if (occupant && occupant.owner === piece.owner) continue
      out.push(c)
    }
  }
  return out
}
