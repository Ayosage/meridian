import { Room, type Client } from 'colyseus'

type Delayed = ReturnType<Room['clock']['setTimeout']>
import {
  applyCatanIntent,
  companionIntent,
  createCatanGame,
  createRng,
  isCatanRuleError,
  redactCatanState,
  stubRng,
  type CatanIntent,
  type CatanPlayerCount,
  type CatanState,
  type CompanionOpts,
  type Rng,
} from '@meridian/rules'
import { catanIntentSchema, MSG, type CatanEvent, type CatanSnapshotPayload } from '@meridian/protocol'
import { deriveCatanEvents, redactEventForSeat } from '../events'
import { pilotIntent } from '../pilot'
import { CatanLobbyState } from '../schema/CatanLobbyState'
import { generateRoomId, releaseRoomId } from '../room-id'

interface CreateOptions {
  players: number
  bots?: number
  layout?: 'beginner' | 'random'
  pilotDelayMs?: number
  botDelayMs?: number
  /** How long a bot's own trade offer stays open for human responses. */
  offerWindowMs?: number
  abandonMinutes?: number
  seed?: number
  /** TEST-ONLY: forces the room rng to a scripted value list. */
  rngScript?: number[]
  /** TEST-ONLY: lower victory-point target so seeded E2E matches finish fast. */
  targetVp?: number
}

export class CatanRoom extends Room<CatanLobbyState> {
  private game: CatanState | null = null
  private rng: Rng = createRng(0)
  private layout: 'beginner' | 'random' = 'random'
  private pilotDelayMs = 600
  private botCount = 0
  private botDelayMs = 900
  private offerWindowMs = 10_000
  private abandonMs = 10 * 60_000
  /** connected client per seat; null = pilot/companion drives */
  private seatClients: (Client | null)[] = []
  private seatKinds: ('human' | 'bot')[] = []
  /** Per-bot-seat turn memory (design spec §2): reset when turn.number moves. */
  private botMemory = new Map<number, { turn: number; proposed: boolean; bankTrades: number }>()
  private targetVp: number | undefined
  private pilotTimer: Delayed | null = null
  private abandonTimer: Delayed | null = null
  private offerTimer: Delayed | null = null
  private offerDeadlineHit = false

  async onCreate(options: CreateOptions) {
    if (!Number.isInteger(options.players) || options.players < 3 || options.players > 8)
      throw new Error('players must be 3..8')
    const bots = options.bots ?? 0
    if (!Number.isInteger(bots) || bots < 0 || bots > options.players - 1)
      throw new Error('bots must be an integer in 0..players-1')
    this.botCount = bots
    this.roomId = await generateRoomId(this.presence)
    this.maxClients = options.players - bots
    this.layout = options.layout ?? 'random'
    this.pilotDelayMs = options.pilotDelayMs ?? 600
    this.botDelayMs = options.botDelayMs ?? 900
    this.offerWindowMs = options.offerWindowMs ?? 10_000
    this.abandonMs = (options.abandonMinutes ?? 10) * 60_000
    this.targetVp = options.targetVp
    this.rng = options.rngScript
      ? stubRng(options.rngScript)
      : createRng(options.seed ?? Math.floor(Math.random() * 2 ** 31))
    this.setState(new CatanLobbyState())
    this.state.targetPlayers = options.players
    this.state.botCount = bots

    this.onMessage(MSG.INTENT, (client, raw: unknown) => this.handleIntent(client, raw))
    this.onMessage(MSG.START, (client) => this.handleStart(client))
  }

  onJoin(client: Client) {
    this.state.seats.push(client.sessionId)
    this.state.connected.push(true)
    this.seatClients.push(client)
    this.seatKinds.push('human')
    if (this.state.seats.length === this.state.targetPlayers - this.botCount) this.startGame()
  }

  private handleStart(client: Client) {
    if (this.seatOf(client) !== 0)
      return client.send(MSG.RULE_ERROR, { code: 'NOT_HOST', message: 'only the host can start early' })
    if (
      this.state.phase !== 'waiting' ||
      this.state.seats.length < 3 ||
      this.state.seats.length !== this.state.targetPlayers - 1 ||
      this.botCount !== 0
    )
      return client.send(MSG.RULE_ERROR, {
        code: 'BAD_START',
        message: `early start needs exactly ${this.state.targetPlayers - 1} seated players`,
      })
    this.startGame()
  }

  private startGame() {
    for (let i = 0; i < this.botCount; i++) {
      this.state.seats.push(`bot-${i + 1}`)
      this.state.connected.push(true)
      this.seatClients.push(null)
      this.seatKinds.push('bot')
    }
    const n = this.state.seats.length as CatanPlayerCount
    this.game = createCatanGame({ playerCount: n, layout: this.layout, targetVp: this.targetVp }, this.rng)
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
      if (errorTo) {
        errorTo.send(MSG.RULE_ERROR, { code: result.code, message: result.message })
        return
      }
      // A driven seat has no client to correct it and nothing pending, so
      // returning here would freeze the match outright. Re-arm and shout: the
      // brains are meant to never reach this, so a warn means a real bug.
      console.warn(
        `[CatanRoom ${this.roomId}] driven seat ${intent.player} intent ${intent.type} rejected: ${result.code} — ${result.message}`,
      )
      this.schedulePilot()
      return
    }
    const before = this.game
    this.game = result
    this.broadcastViews(deriveCatanEvents(before, intent, result))
    if (this.game.winner !== null) {
      this.state.phase = 'ended'
      this.broadcast(MSG.MATCH_ENDED, { reason: 'win', winner: this.game.winner })
    }
    this.schedulePilot()
    this.syncOfferWindow()
  }

  private broadcastViews(events?: readonly CatanEvent[]) {
    if (!this.game) return
    for (let seat = 0; seat < this.seatClients.length; seat++) {
      const client = this.seatClients[seat]
      if (!client) continue
      const payload: CatanSnapshotPayload = {
        seq: this.game.seq,
        view: redactCatanState(this.game, seat),
        ...(events && events.length > 0
          ? { events: events.map((e) => redactEventForSeat(e, seat)) }
          : {}),
      }
      client.send(MSG.SNAPSHOT, payload)
    }
  }

  /** Compute the driving intent for a seat with no client: competent brain for bot seats, caretaker for absent humans. */
  private drivenIntent(seat: number, rng: Rng): CatanIntent | null {
    if (!this.game) return null
    if (this.seatKinds[seat] !== 'bot') return pilotIntent(this.game, seat, rng)
    return companionIntent(this.game, seat, rng, this.companionOpts(seat))
  }

  private companionOpts(seat: number): CompanionOpts {
    const turn = this.game!.turn.number
    let mem = this.botMemory.get(seat)
    if (!mem || mem.turn !== turn) {
      mem = { turn, proposed: false, bankTrades: 0 }
      this.botMemory.set(seat, mem)
    }
    return { proposedThisTurn: mem.proposed, resolveOfferNow: this.offerDeadlineHit, bankTradesThisTurn: mem.bankTrades }
  }

  /** Fire the pilot/companion for at most one absent seat that the game waits on. */
  private schedulePilot() {
    if (this.pilotTimer) {
      this.pilotTimer.clear()
      this.pilotTimer = null
    }
    if (!this.game || this.state.phase !== 'playing') return
    if (this.humansConnected() === 0) return // paused while abandoned (spec §4)
    const seat = this.nextDrivenSeat()
    if (seat === null) return
    const delay = this.seatKinds[seat] === 'bot' ? this.botDelayMs : this.pilotDelayMs
    this.pilotTimer = this.clock.setTimeout(() => {
      this.pilotTimer = null
      if (!this.game || this.state.phase !== 'playing') return
      if (this.humansConnected() === 0) return
      // fallback: re-derive if the captured seat no longer needs driving
      // (e.g. its human reconnected while the timer was pending)
      const s = this.seatClients[seat] === null ? seat : this.nextDrivenSeat()
      if (s === null) return
      const intent = this.drivenIntent(s, this.rng)
      if (intent && this.seatKinds[s] === 'bot') {
        const mem = this.botMemory.get(s)
        if (mem) {
          if (intent.type === 'offerTrade') mem.proposed = true
          if (intent.type === 'bankTrade') mem.bankTrades++
        }
      }
      if (intent) this.applyAndBroadcast(intent)
    }, delay)
  }

  private nextDrivenSeat(): number | null {
    if (!this.game) return null
    for (let seat = 0; seat < this.seatClients.length; seat++) {
      if (this.seatClients[seat] !== null) continue
      // probe rng: this call only asks "is anything mandatory?" — the real
      // rng is consumed exclusively inside the timer callback's drivenIntent
      if (this.drivenIntent(seat, { next: () => 0 }) !== null) return seat
    }
    return null
  }

  /** Arm a response window while a bot's own offer is open; force confirm-or-cancel at the deadline. */
  private syncOfferWindow() {
    const open = this.game?.turn.openTrade != null && this.seatKinds[this.game!.turn.current] === 'bot'
    if (!open) {
      this.offerTimer?.clear()
      this.offerTimer = null
      this.offerDeadlineHit = false
      return
    }
    // The window only exists to bound how long we wait on responses that
    // might still arrive. Once every other seat has answered, none can — and
    // the proposer parks (companionIntent returns null while its own offer is
    // open and unconfirmable), leaving no pending timer. Resolve immediately
    // instead of idling out the rest of the window.
    if (this.everySeatAnswered()) {
      this.offerTimer?.clear()
      this.offerTimer = null
      this.offerDeadlineHit = true
      this.schedulePilot() // applyAndBroadcast already ran it with the flag unset
      return
    }
    if (this.offerTimer) return // already armed for this offer
    this.offerTimer = this.clock.setTimeout(() => {
      this.offerTimer = null
      this.offerDeadlineHit = true
      this.schedulePilot()
    }, this.offerWindowMs)
  }

  /** True once every seat but the proposer has answered the open offer. */
  private everySeatAnswered(): boolean {
    const offer = this.game?.turn.openTrade
    if (!offer) return false
    for (let seat = 0; seat < this.seatClients.length; seat++) {
      if (seat === this.game!.turn.current) continue
      if (offer.responses[seat] === undefined) return false
    }
    return true
  }

  async onLeave(client: Client) {
    if (this.state.phase === 'waiting') {
      const idx = this.seatOf(client)
      if (idx !== -1) {
        this.state.seats.splice(idx, 1)
        this.state.connected.splice(idx, 1)
        this.seatClients.splice(idx, 1)
        this.seatKinds.splice(idx, 1) // bots never leave; only humans can be in seats while waiting
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

    // Reclaimable until game end or abandonment disposal (spec §4).
    // Deliberately NOT awaited: onLeave must return so the transport closes
    // (client.leave() blocks on it); the deferred resolves on reconnect.
    this.allowReconnection(client, 'manual')
      .then((rejoined) => {
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
      })
      .catch(() => {
        // reconnection cancelled (room disposing) — nothing to do
      })
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
