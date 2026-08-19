import type { Coord } from './coord'
import type { Ruleset } from './ruleset'

export type PlayerId = number

export interface Piece {
  id: string
  owner: PlayerId
  type: string
  at: Coord
}

export interface GameState {
  ruleset: Ruleset
  seq: number
  currentPlayer: PlayerId
  pieces: readonly Piece[]
  winner: PlayerId | null
}
