import { ArraySchema, Schema, type } from '@colyseus/schema'

/**
 * Lobby plumbing ONLY (server design spec §4): game state never enters
 * Colyseus schema — every game byte a client sees flows through
 * redactCatanState.
 */
export class CatanLobbyState extends Schema {
  @type('string') phase: 'waiting' | 'playing' | 'ended' = 'waiting'
  @type('number') targetPlayers = 4
  /** sessionIds by seat index */
  @type(['string']) seats = new ArraySchema<string>()
  /** per-seat presence — false means the pilot is driving (spec §4) */
  @type(['boolean']) connected = new ArraySchema<boolean>()
}
