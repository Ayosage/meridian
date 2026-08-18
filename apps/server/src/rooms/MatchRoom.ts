import { Room, type Client } from 'colyseus'
import {
  applyIntent,
  initialState,
  isRuleError,
  placeholderRuleset,
  type GameState,
} from '@meridian/rules'
import { MSG, clientIntentSchema } from '@meridian/protocol'
import { MatchState, syncFromGameState } from '../schema/MatchState'
import { generateRoomId, releaseRoomId } from '../room-id'

interface CreateOptions {
  graceSeconds?: number
}

export class MatchRoom extends Room<MatchState> {
  maxClients = 2

  private game: GameState | null = null
  private graceSeconds = 60

  async onCreate(options: CreateOptions) {
    this.roomId = await generateRoomId(this.presence)
    this.graceSeconds = options.graceSeconds ?? 60
    this.setState(new MatchState())

    this.onMessage(MSG.INTENT, (client, raw: unknown) => this.handleIntent(client, raw))
  }

  onJoin(client: Client) {
    this.state.seats.push(client.sessionId)
    if (this.state.seats.length === 2) {
      this.game = initialState(placeholderRuleset)
      this.state.phase = 'playing'
      syncFromGameState(this.state, this.game)
      this.lock()
    }
  }

  private seatOf(client: Client): number {
    return this.state.seats.findIndex((s) => s === client.sessionId)
  }

  private handleIntent(client: Client, raw: unknown) {
    const parsed = clientIntentSchema.safeParse(raw)
    if (!parsed.success) {
      client.send(MSG.RULE_ERROR, { code: 'BAD_MESSAGE', message: 'malformed intent' })
      return
    }
    if (this.state.phase !== 'playing' || !this.game) {
      client.send(MSG.RULE_ERROR, { code: 'NOT_PLAYING', message: 'match is not in progress' })
      return
    }
    const seat = this.seatOf(client)
    const result = applyIntent(this.game, { ...parsed.data, player: seat })
    if (isRuleError(result)) {
      client.send(MSG.RULE_ERROR, { code: result.code, message: result.message })
      return
    }
    this.game = result
    syncFromGameState(this.state, this.game)
    if (this.game.winner !== null) {
      this.state.phase = 'ended'
      this.broadcast(MSG.MATCH_ENDED, { reason: 'win', winner: this.game.winner })
    }
  }

  async onLeave(client: Client, consented: boolean) {
    // Reconnection handling lands in the next task; for now a leave during
    // play simply keeps the seat (sessionId stays in seats).
    void client
    void consented
  }

  async onDispose() {
    await releaseRoomId(this.presence, this.roomId)
  }
}
