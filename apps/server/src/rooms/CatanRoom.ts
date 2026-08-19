import { Room, type Client } from 'colyseus'

type Delayed = ReturnType<Room['clock']['setTimeout']>
import {
  applyCatanIntent,
  createCatanGame,
  createRng,
  isCatanRuleError,
  redactCatanState,
  stubRng,
  type CatanIntent,
  type CatanState,
  type Rng,
} from '@meridian/rules'
import { catanIntentSchema, MSG, type CatanSnapshotPayload } from '@meridian/protocol'
import { pilotIntent } from '../pilot'
import { CatanLobbyState } from '../schema/CatanLobbyState'
import { generateRoomId, releaseRoomId } from '../room-id'

interface CreateOptions {
  players: 3 | 4
  layout?: 'beginner' | 'random'
  pilotDelayMs?: number
  abandonMinutes?: number
  seed?: number
  /** TEST-ONLY: forces the room rng to a scripted value list. */
  rngScript?: number[]
}

export class CatanRoom extends Room<CatanLobbyState> {
  private game: CatanState | null = null
  private rng: Rng = createRng(0)
  private layout: 'beginner' | 'random' = 'random'
  private pilotDelayMs = 600
  private abandonMs = 10 * 60_000
  /** connected client per seat; null = pilot drives */
  private seatClients: (Client | null)[] = []
  private pilotTimer: Delayed | null = null
  private abandonTimer: Delayed | null = null

  async onCreate(options: CreateOptions) {
    if (options.players !== 3 && options.players !== 4) throw new Error('players must be 3 or 4')
    this.roomId = await generateRoomId(this.presence)
    this.maxClients = options.players
    this.layout = options.layout ?? 'random'
    this.pilotDelayMs = options.pilotDelayMs ?? 600
    this.abandonMs = (options.abandonMinutes ?? 10) * 60_000
    this.rng = options.rngScript
      ? stubRng(options.rngScript)
      : createRng(options.seed ?? Math.floor(Math.random() * 2 ** 31))
    this.setState(new CatanLobbyState())
    this.state.targetPlayers = options.players

    this.onMessage(MSG.INTENT, (client, raw: unknown) => this.handleIntent(client, raw))
    this.onMessage(MSG.START, (client) => this.handleStart(client))
  }

  onJoin(client: Client) {
    this.state.seats.push(client.sessionId)
    this.state.connected.push(true)
    this.seatClients.push(client)
    if (this.state.seats.length === this.state.targetPlayers) this.startGame()
  }

  private handleStart(client: Client) {
    if (this.seatOf(client) !== 0)
      return client.send(MSG.RULE_ERROR, { code: 'NOT_HOST', message: 'only the host can start early' })
    if (this.state.phase !== 'waiting' || this.state.seats.length !== 3 || this.state.targetPlayers !== 4)
      return client.send(MSG.RULE_ERROR, {
        code: 'BAD_START',
        message: 'early start needs exactly 3 seated players in a 4-room',
      })
    this.startGame()
  }

  private startGame() {
    const n = this.state.seats.length as 3 | 4
    this.game = createCatanGame({ playerCount: n, layout: this.layout }, this.rng)
    this.state.phase = 'playing'
    this.lock()
    this.broadcastViews()
    this.schedulePilot()
  }

  private seatOf(client: Client): number {
    return this.state.seats.findIndex((s) => s === client.sessionId)
  }

  private humansConnected(): number {
    return this.seatClients.filter((c) => c !== null).length
  }

  private handleIntent(client: Client, raw: unknown) {
    const parsed = catanIntentSchema.safeParse(raw)
    if (!parsed.success)
      return client.send(MSG.RULE_ERROR, { code: 'BAD_MESSAGE', message: 'malformed intent' })
    if (this.state.phase !== 'playing' || !this.game)
      return client.send(MSG.RULE_ERROR, { code: 'NOT_PLAYING', message: 'match is not in progress' })
    const seat = this.seatOf(client)
    if (seat === -1) return
    this.applyAndBroadcast({ ...parsed.data, player: seat } as CatanIntent, client)
  }

  /** Single choke point: EVERY state change flows through here. */
  private applyAndBroadcast(intent: CatanIntent, errorTo?: Client) {
    if (!this.game) return
    const result = applyCatanIntent(this.game, intent, this.rng)
    if (isCatanRuleError(result)) {
      errorTo?.send(MSG.RULE_ERROR, { code: result.code, message: result.message })
      return
    }
    this.game = result
    this.broadcastViews()
    if (this.game.winner !== null) {
      this.state.phase = 'ended'
      this.broadcast(MSG.MATCH_ENDED, { reason: 'win', winner: this.game.winner })
    }
    this.schedulePilot()
  }

  private broadcastViews() {
    if (!this.game) return
    for (let seat = 0; seat < this.seatClients.length; seat++) {
      const client = this.seatClients[seat]
      if (!client) continue
      const payload: CatanSnapshotPayload = {
        seq: this.game.seq,
        view: redactCatanState(this.game, seat),
      }
      client.send(MSG.SNAPSHOT, payload)
    }
  }

  /** Fire the pilot for at most one absent seat that the game waits on. */
  private schedulePilot() {
    if (this.pilotTimer) {
      this.pilotTimer.clear()
      this.pilotTimer = null
    }
    if (!this.game || this.state.phase !== 'playing') return
    if (this.humansConnected() === 0) return // paused while abandoned (spec §4)
    if (this.nextPilotSeat() === null) return
    this.pilotTimer = this.clock.setTimeout(() => {
      this.pilotTimer = null
      if (!this.game || this.state.phase !== 'playing') return
      if (this.humansConnected() === 0) return
      const s = this.nextPilotSeat()
      if (s === null) return
      const intent = pilotIntent(this.game, s, this.rng)
      if (intent) this.applyAndBroadcast(intent)
    }, this.pilotDelayMs)
  }

  private nextPilotSeat(): number | null {
    if (!this.game) return null
    for (let seat = 0; seat < this.seatClients.length; seat++) {
      if (this.seatClients[seat] !== null) continue
      // probe rng: this call only asks "is anything mandatory?" — the real
      // rng is consumed exclusively inside the timer callback's pilotIntent
      if (pilotIntent(this.game, seat, { next: () => 0 }) !== null) return seat
    }
    return null
  }

  async onLeave(client: Client) {
    if (this.state.phase === 'waiting') {
      const idx = this.seatOf(client)
      if (idx !== -1) {
        this.state.seats.splice(idx, 1)
        this.state.connected.splice(idx, 1)
        this.seatClients.splice(idx, 1)
      }
      if (this.state.seats.length === 0) this.resetAutoDisposeTimeout(30)
      return
    }
    if (this.state.phase !== 'playing') return

    const seat = this.seatOf(client)
    if (seat === -1) return
    this.seatClients[seat] = null
    this.state.connected[seat] = false
    this.schedulePilot()
    if (this.humansConnected() === 0) this.startAbandonTimer()

    try {
      // reclaimable until game end or abandonment disposal (spec §4)
      const rejoined = await this.allowReconnection(client, 'manual')
      this.seatClients[seat] = rejoined
      this.state.connected[seat] = true
      this.stopAbandonTimer()
      if (this.game)
        rejoined.send(
          MSG.SNAPSHOT,
          { seq: this.game.seq, view: redactCatanState(this.game, seat) },
          { afterNextPatch: true },
        )
      this.schedulePilot()
    } catch {
      // reconnection cancelled (room disposing) — nothing to do
    }
  }

  private startAbandonTimer() {
    if (this.abandonTimer) return
    this.abandonTimer = this.clock.setTimeout(() => {
      void this.disconnect()
    }, this.abandonMs)
  }

  private stopAbandonTimer() {
    if (this.abandonTimer) {
      this.abandonTimer.clear()
      this.abandonTimer = null
    }
  }

  async onDispose() {
    await releaseRoomId(this.presence, this.roomId)
  }
}
