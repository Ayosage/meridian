import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema'
import type { GameState } from '@meridian/rules'

export class PieceSchema extends Schema {
  @type('string') id = ''
  @type('number') owner = 0
  @type('string') pieceType = ''
  @type('number') q = 0
  @type('number') r = 0
}

export class MatchState extends Schema {
  @type('string') phase: 'waiting' | 'playing' | 'ended' = 'waiting'
  @type('number') currentPlayer = 0
  /** -1 = no winner yet (schema numbers cannot be null) */
  @type('number') winner = -1
  @type('number') seq = 0
  @type({ map: PieceSchema }) pieces = new MapSchema<PieceSchema>()
  /** sessionIds by seat index */
  @type(['string']) seats = new ArraySchema<string>()
}

/** Mirror the authoritative plain GameState into the synced schema tree. */
export function syncFromGameState(target: MatchState, gs: GameState): void {
  target.currentPlayer = gs.currentPlayer
  target.winner = gs.winner ?? -1
  target.seq = gs.seq

  const liveIds = new Set<string>()
  for (const piece of gs.pieces) {
    liveIds.add(piece.id)
    let entry = target.pieces.get(piece.id)
    if (!entry) {
      entry = new PieceSchema()
      target.pieces.set(piece.id, entry)
    }
    entry.id = piece.id
    entry.owner = piece.owner
    entry.pieceType = piece.type
    entry.q = piece.at.q
    entry.r = piece.at.r
  }
  for (const key of [...target.pieces.keys()]) {
    if (!liveIds.has(key)) target.pieces.delete(key)
  }
}
