import type { Coord } from './coord'
import type { PlayerId } from './state'

export interface MoveIntent {
  type: 'move'
  player: PlayerId
  pieceId: string
  to: Coord
}

export interface EndTurnIntent {
  type: 'endTurn'
  player: PlayerId
}

export type Intent = MoveIntent | EndTurnIntent

export type RuleErrorCode =
  | 'GAME_OVER'
  | 'NOT_YOUR_TURN'
  | 'UNKNOWN_PIECE'
  | 'NOT_PIECE_OWNER'
  | 'OFF_BOARD'
  | 'OUT_OF_RANGE'
  | 'OCCUPIED_BY_FRIENDLY'

export interface RuleError {
  error: true
  code: RuleErrorCode
  message: string
}

export function ruleError(code: RuleErrorCode, message: string): RuleError {
  return { error: true, code, message }
}

export function isRuleError(v: unknown): v is RuleError {
  return typeof v === 'object' && v !== null && (v as { error?: unknown }).error === true
}
