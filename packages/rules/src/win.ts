import type { GameState, PlayerId } from './state'

function playersWithPieces(state: GameState): Set<PlayerId> {
  return new Set(state.pieces.map((p) => p.owner))
}

/**
 * Advance to the next turn: bump seq, detect lastPlayerStanding, rotate to
 * the next player that still owns pieces. When a winner is set the
 * currentPlayer is left as-is (no further turns exist).
 */
export function advanceTurn(state: GameState): GameState {
  const alive = playersWithPieces(state)
  const winner = alive.size === 1 ? [...alive][0]! : null
  if (winner !== null) return { ...state, seq: state.seq + 1, winner }

  const n = state.ruleset.playerCount
  let next = (state.currentPlayer + 1) % n
  while (!alive.has(next)) next = (next + 1) % n
  return { ...state, seq: state.seq + 1, currentPlayer: next }
}
