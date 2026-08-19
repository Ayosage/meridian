import type { GameState, Piece } from './state'
import type { Ruleset } from './ruleset'

/** Build the turn-zero GameState for a ruleset. Piece ids are `p{player}-{index}`. */
export function initialState(ruleset: Ruleset): GameState {
  const perPlayerCount = new Map<number, number>()
  const pieces: Piece[] = ruleset.setup.map((entry) => {
    const index = perPlayerCount.get(entry.player) ?? 0
    perPlayerCount.set(entry.player, index + 1)
    return { id: `p${entry.player}-${index}`, owner: entry.player, type: entry.type, at: entry.at }
  })
  return { ruleset, seq: 0, currentPlayer: 0, pieces, winner: null }
}
