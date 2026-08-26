import { ArraySchema, Schema, type } from '@colyseus/schema'

/**
 * Lobby plumbing ONLY (server design spec §4): game state never enters
 * Colyseus schema — every game byte a client sees flows through
 * redactCatanState.
 */
export class CatanLobbyState extends Schema {
  @type('string') phase: 'waiting' | 'playing' | 'ended' = 'waiting'
  @type('number') targetPlayers = 4
  /** Trailing seats reserved for native bots (native-bots design spec §2). */
  @type('number') botCount = 0
  /** sessionIds by seat index */
  @type(['string']) seats = new ArraySchema<string>()
  /** per-seat presence — false means the pilot is driving (spec §4) */
  @type(['boolean']) connected = new ArraySchema<boolean>()
  /** Cosmetic seat labels from a Discord launch (docs/DISCORD-LAUNCH.md), first-come first-named. */
  @type(['string']) seatNames = new ArraySchema<string>()
}
