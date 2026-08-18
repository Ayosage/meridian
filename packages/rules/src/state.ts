import type { Coord } from './coord'

// Replaced by `import type { Ruleset } from './ruleset'` in the ruleset task.
type Ruleset = unknown

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
