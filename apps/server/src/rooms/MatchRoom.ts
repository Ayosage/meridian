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
    if (this.state.phase === 'waiting') {
      // Dropped before the match started: free the seat so the room can
      // still fill instead of wedging with a dead sessionId. Colyseus's
      // default autoDispose would otherwise tear the room down the instant
      // it hits zero clients, orphaning the join code; give it a window to
      // accept a replacement joiner instead.
      const idx = this.seatOf(client)
      if (idx !== -1) this.state.seats.splice(idx, 1)
      if (this.state.seats.length === 0) this.resetAutoDisposeTimeout(this.graceSeconds)
      return
    }

    if (this.state.phase !== 'playing') return

    if (!consented) {
      try {
        await this.allowReconnection(client, this.graceSeconds)
        // Same sessionId, same seat. Schema sync converges the client via
        // the normal state patch; the snapshot is the belt-and-braces
        // full-state resend (spec §4). `afterNextPatch` queues it behind
        // colyseus's own patch broadcast instead of a raw send, so it can't
        // race the client's join handshake — no timer needed. Reading
        // `this.game` here (not a captured local) keeps it current even if
        // an intent lands in the same tick the reconnection resolves.
        if (this.game) client.send(MSG.SNAPSHOT, { state: this.game }, { afterNextPatch: true })
        return
      } catch {
        // grace window expired — fall through to forfeit
      }
    }

    // The match may have already ended while we were awaiting the grace
    // window above (a win, or the opponent's own forfeit/consented leave);
    // don't clobber that outcome with a second matchEnded / winner flip.
    if (this.state.phase !== 'playing') return

    const seat = this.seatOf(client)
    if (seat === -1) return
    const winner = seat === 0 ? 1 : 0
    this.state.phase = 'ended'
    this.state.winner = winner
    this.broadcast(MSG.MATCH_ENDED, { reason: 'forfeit', winner })
  }

  async onDispose() {
    await releaseRoomId(this.presence, this.roomId)
  }
}
