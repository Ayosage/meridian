import { coordKey, coordsEqual, distance, inRadius } from './coord'
import { ruleError, type Intent, type RuleError } from './intent'
import type { GameState } from './state'
import { advanceTurn } from './win'

/** Pure reducer: returns a new state or a RuleError; never mutates input. */
export function applyIntent(state: GameState, intent: Intent): GameState | RuleError {
  if (state.winner !== null) return ruleError('GAME_OVER', 'the match is already decided')
  if (intent.player !== state.currentPlayer)
    return ruleError('NOT_YOUR_TURN', `it is player ${state.currentPlayer}'s turn`)

  if (intent.type === 'endTurn') return advanceTurn(state)

  const piece = state.pieces.find((p) => p.id === intent.pieceId)
  if (!piece) return ruleError('UNKNOWN_PIECE', `no piece "${intent.pieceId}"`)
  if (piece.owner !== intent.player)
    return ruleError('NOT_PIECE_OWNER', `piece "${piece.id}" belongs to player ${piece.owner}`)

  const def = state.ruleset.pieces.find((d) => d.type === piece.type)
  if (!def) return ruleError('UNKNOWN_PIECE', `no piece definition for type "${piece.type}"`)

  if (!inRadius(intent.to, state.ruleset.board.radius))
    return ruleError('OFF_BOARD', `${coordKey(intent.to)} is off the board`)

  const d = distance(piece.at, intent.to)
  if (d === 0 || d > def.movement.range)
    return ruleError('OUT_OF_RANGE', `${coordKey(intent.to)} is out of range for "${piece.type}"`)

  const occupant = state.pieces.find((p) => coordsEqual(p.at, intent.to))
  if (occupant && occupant.owner === intent.player)
    return ruleError('OCCUPIED_BY_FRIENDLY', `${coordKey(intent.to)} is occupied by your own piece`)

  const pieces = state.pieces
    .filter((p) => p !== occupant)
    .map((p) => (p.id === piece.id ? { ...p, at: intent.to } : p))

  return advanceTurn({ ...state, pieces })
}
