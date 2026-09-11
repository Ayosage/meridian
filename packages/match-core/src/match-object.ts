import { DurableObject } from 'cloudflare:workers'
import { clientEnvelopeSchema, type LobbyPayload, type ServerEnvelope } from '@meridian/protocol'
import { isRuleError, type DriveKind, type GameAdapter } from './adapter'
import { intentRng } from './rng'
import { NO_DEADLINES, dueKeys, earliest, type Deadlines } from './timers'

export interface CreateOptions {
  players: number
  bots: number
  seed?: number
  launched?: boolean
  seatNames?: string[]
  callback?: { url: string; token: string }
  /** The launcher's host: whoever arrives with this seat token takes seat 0, even if others came first. */
  host?: { seatToken: string; displayName?: string }
  clientOrigin: string
  /** Test-only knobs (delays, targetVp, layout); ignored unless env.TEST_KNOBS === '1'. */
  knobs?: Record<string, unknown>
}

/** Validation problems come back as values, not throws: a throw inside the object is logged as an uncaught exception by the runtime. */
export type CreateResult = { status: 'created' } | { status: 'conflict' } | { status: 'invalid'; message: string }

interface MatchEnv {
  TEST_KNOBS?: string
}

interface Meta {
  phase: 'waiting' | 'playing' | 'ended'
  targetPlayers: number
  botCount: number
  seed: number
  seq: number
  launched: number
  clientOrigin: string
  callbackUrl: string | null
  callbackToken: string | null
  knobs: string
  createdAt: number
}

/** A `seats` row. A type alias (not an interface) so it satisfies SqlStorage's Record constraint. */
type SeatRow = {
  seat: number
  kind: 'human' | 'bot'
  token: string | null
  seatToken: string | null
  displayName: string | null
  connected: number
}

/** Attached to each hibernating socket so a wake-up knows who is who. */
interface Attachment {
  seat: number
  token: string
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seats (seat INTEGER PRIMARY KEY, kind TEXT NOT NULL, token TEXT, seatToken TEXT, displayName TEXT, connected INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS timers (k TEXT PRIMARY KEY, at INTEGER);
CREATE TABLE IF NOT EXISTS memory (seat INTEGER PRIMARY KEY, json TEXT NOT NULL);
`

export function createMatchObject<S, I, V, E>(adapter: GameAdapter<S, I, V, E>) {
  return class MatchObject extends DurableObject<MatchEnv> {
    constructor(ctx: DurableObjectState, env: MatchEnv) {
      super(ctx, env)
      ctx.blockConcurrencyWhile(async () => {
        this.ctx.storage.sql.exec(SCHEMA)
      })
    }

    // ---- storage helpers ---------------------------------------------------

    protected getMeta(): Meta | null {
      const rows = this.ctx.storage.sql.exec<{ k: string; v: string }>('SELECT k, v FROM meta').toArray()
      if (rows.length === 0) return null
      const m: Record<string, string> = {}
      for (const r of rows) m[r.k] = r.v
      return {
        phase: m.phase as Meta['phase'],
        targetPlayers: Number(m.targetPlayers),
        botCount: Number(m.botCount),
        seed: Number(m.seed),
        seq: Number(m.seq),
        launched: Number(m.launched),
        clientOrigin: m.clientOrigin ?? '',
        callbackUrl: m.callbackUrl || null,
        callbackToken: m.callbackToken || null,
        knobs: m.knobs ?? '{}',
        createdAt: Number(m.createdAt),
      }
    }

    /** Upsert meta keys. Extra keys beyond `Meta` (seatNames, result, webhook bookkeeping) are allowed. */
    protected setMeta(patch: Record<string, string | number | null | undefined>): void {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue
        this.ctx.storage.sql.exec(
          'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
          k,
          v === null ? '' : String(v),
        )
      }
    }

    protected metaValue(k: string): string | null {
      const row = this.ctx.storage.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0]
      return row ? row.v : null
    }

    protected seats(): SeatRow[] {
      return this.ctx.storage.sql
        .exec<SeatRow>('SELECT seat, kind, token, seatToken, displayName, connected FROM seats ORDER BY seat')
        .toArray()
    }

    protected deadlines(): Deadlines {
      const d: Deadlines = { ...NO_DEADLINES }
      for (const r of this.ctx.storage.sql
        .exec<{ k: keyof Deadlines; at: number | null }>('SELECT k, at FROM timers')
        .toArray())
        d[r.k] = r.at
      return d
    }

    protected setDeadline(k: keyof Deadlines, at: number | null): void {
      this.ctx.storage.sql.exec('INSERT INTO timers (k, at) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET at = excluded.at', k, at)
    }

    /** One alarm per object: always the earliest stored deadline. */
    protected armAlarm(): void {
      const at = earliest(this.deadlines())
      if (at === null) void this.ctx.storage.deleteAlarm()
      else void this.ctx.storage.setAlarm(at)
    }

    // ---- RPC ---------------------------------------------------------------

    async create(opts: CreateOptions): Promise<CreateResult> {
      if (this.getMeta() !== null) return { status: 'conflict' }
      if (
        !Number.isInteger(opts.players) ||
        opts.players < adapter.players.min ||
        opts.players > adapter.players.max
      )
        return { status: 'invalid', message: `players must be ${adapter.players.min}..${adapter.players.max}` }
      if (!Number.isInteger(opts.bots) || opts.bots < 0 || opts.bots > opts.players - 1)
        return { status: 'invalid', message: 'bots must be an integer in 0..players-1' }
      const testing = this.env.TEST_KNOBS === '1'
      const knobs = testing ? (opts.knobs ?? {}) : {}
      const wanted = typeof opts.seed === 'number' ? opts.seed : knobs.seed
      const seed = testing && typeof wanted === 'number' ? wanted : Math.floor(Math.random() * 2 ** 31)
      const now = Date.now()
      this.setMeta({
        phase: 'waiting',
        targetPlayers: opts.players,
        botCount: opts.bots,
        seed,
        seq: 0,
        launched: opts.launched ? 1 : 0,
        clientOrigin: opts.clientOrigin,
        callbackUrl: opts.callback?.url ?? null,
        callbackToken: opts.callback?.token ?? null,
        knobs: JSON.stringify(knobs),
        createdAt: now,
        // seatNames from a launch pre-label seats in order as humans arrive
        seatNames: JSON.stringify(opts.seatNames ?? []),
        hostSeatToken: opts.host?.seatToken ?? null,
        hostDisplayName: opts.host?.displayName ?? null,
      })
      if (opts.launched) {
        const expireMs = typeof knobs.launchExpireMs === 'number' ? knobs.launchExpireMs : 30 * 60_000
        this.setDeadline('expiry', now + expireMs)
        this.armAlarm()
      }
      return { status: 'created' }
    }

    lobby(): LobbyPayload | null {
      const meta = this.getMeta()
      if (!meta) return null
      const seats = this.seats()
      const names = JSON.parse(this.metaValue('seatNames') ?? '[]') as string[]
      return {
        phase: meta.phase,
        seats: seats.map((s) => (s.kind === 'bot' ? `bot-${s.seat}` : `seat-${s.seat}`)),
        connected: seats.map((s) => s.connected === 1),
        targetPlayers: meta.targetPlayers,
        botCount: meta.botCount,
        // Positional: seat i reads seatNames[i]; '' means unnamed (the client falls back to Player N).
        seatNames: seats.map((s, i) => s.displayName ?? names[i] ?? ''),
      }
    }

    // ---- sockets -----------------------------------------------------------

    async fetch(request: Request): Promise<Response> {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
      if (this.getMeta() === null) return new Response('no such match', { status: 404 })
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
      // Not yet a seat: hello assigns one and writes the attachment.
      this.ctx.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    protected send(ws: WebSocket, msg: ServerEnvelope): void {
      try {
        ws.send(JSON.stringify(msg))
      } catch {
        // closed between wake and send; webSocketClose will follow
      }
    }

    protected attachment(ws: WebSocket): Attachment | null {
      return (ws.deserializeAttachment() as Attachment | null | undefined) ?? null
    }

    protected sendToSeat(seat: number, msg: ServerEnvelope): void {
      for (const ws of this.ctx.getWebSockets()) {
        if (this.attachment(ws)?.seat === seat) this.send(ws, msg)
      }
    }

    protected broadcastLobby(): void {
      const lobby = this.lobby()
      if (!lobby) return
      for (const ws of this.ctx.getWebSockets()) this.send(ws, { t: 'lobby', ...lobby })
    }

    async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
      let parsed: unknown
      try {
        parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
      } catch {
        return this.send(ws, { t: 'error', code: 'BAD_MESSAGE', message: 'malformed message' })
      }
      const env = clientEnvelopeSchema.safeParse(parsed)
      if (!env.success) return this.send(ws, { t: 'error', code: 'BAD_MESSAGE', message: 'malformed message' })
      const att = this.attachment(ws)
      switch (env.data.t) {
        case 'hello':
          return this.handleHello(ws, env.data)
        case 'start':
          return att ? this.handleStart(att.seat) : undefined
        case 'configure':
          return att ? this.handleConfigure(att.seat, env.data.players, env.data.bots) : undefined
        case 'intent':
          return att ? this.handleIntent(att.seat, env.data.intent) : undefined
      }
    }

    protected handleHello(ws: WebSocket, hello: { token?: string; seatToken?: string; displayName?: string }): void {
      const meta = this.getMeta()
      if (!meta) return this.send(ws, { t: 'error', code: 'NOT_FOUND', message: 'no such match' })
      const already = this.attachment(ws)
      if (already) return this.send(ws, { t: 'welcome', seat: already.seat, token: already.token })
      // Reconnect: token matches a human seat.
      if (hello.token) {
        const row = this.seats().find((s) => s.kind === 'human' && s.token === hello.token)
        if (!row) return this.send(ws, { t: 'error', code: 'BAD_TOKEN', message: 'token invalid or expired' })
        return this.seatSocket(ws, row.seat, row.token!, true)
      }
      if (meta.phase !== 'waiting')
        return this.send(ws, { t: 'error', code: 'NOT_WAITING', message: 'match already started' })
      const seats = this.seats()
      const humansWanted = meta.targetPlayers - meta.botCount
      if (seats.filter((s) => s.kind === 'human').length >= humansWanted)
        return this.send(ws, { t: 'error', code: 'FULL', message: 'match is full' })
      const hostToken = this.metaValue('hostSeatToken')
      const isHost = !!hostToken && hello.seatToken === hostToken
      const displayName = hello.displayName ?? (isHost ? this.metaValue('hostDisplayName') : null)
      let seat = seats.length
      const token = crypto.randomUUID()
      this.ctx.storage.sql.exec(
        'INSERT INTO seats (seat, kind, token, seatToken, displayName, connected) VALUES (?, ?, ?, ?, ?, 1)',
        seat,
        'human',
        token,
        hello.seatToken ?? null,
        displayName,
      )
      if (isHost && seat !== 0) {
        // The launcher's host owns seat 0: swap with whoever sat there and tell them their new seat.
        this.ctx.storage.sql.exec('UPDATE seats SET seat = -1 WHERE seat = 0')
        this.ctx.storage.sql.exec('UPDATE seats SET seat = 0 WHERE seat = ?', seat)
        this.ctx.storage.sql.exec('UPDATE seats SET seat = ? WHERE seat = -1', seat)
        for (const o of this.ctx.getWebSockets()) {
          const a = this.attachment(o)
          if (a?.seat === 0) {
            o.serializeAttachment({ ...a, seat })
            this.send(o, { t: 'welcome', seat, token: a.token })
          }
        }
        seat = 0
      }
      this.seatSocket(ws, seat, token, false)
      if (seats.length + 1 === humansWanted) this.startGame()
    }

    /** Host only, while waiting: resize the table. Starts the match if the seated humans now fill it. */
    protected handleConfigure(seat: number, players: number, bots: number): void {
      const meta = this.getMeta()!
      if (seat !== 0)
        return this.sendToSeat(seat, { t: 'error', code: 'NOT_HOST', message: 'Only the host can change the table.' })
      if (meta.phase !== 'waiting')
        return this.sendToSeat(seat, { t: 'error', code: 'NOT_WAITING', message: 'The match has already started.' })
      const { min, max } = adapter.players
      if (!Number.isInteger(players) || players < min || players > max)
        return this.sendToSeat(seat, { t: 'error', code: 'BAD_CONFIG', message: `Players must be ${min} to ${max}.` })
      if (!Number.isInteger(bots) || bots < 0 || bots > players - 1)
        return this.sendToSeat(seat, { t: 'error', code: 'BAD_CONFIG', message: `Bots must be 0 to ${players - 1}.` })
      const humans = this.seats().filter((s) => s.kind === 'human').length
      if (humans > players - bots)
        return this.sendToSeat(seat, {
          t: 'error',
          code: 'BAD_CONFIG',
          message: `${humans} players are already seated, so that table needs at least ${humans} human seats.`,
        })
      this.setMeta({ targetPlayers: players, botCount: bots })
      this.broadcastLobby()
      if (humans === players - bots) this.startGame()
    }

    /** Bind the socket to a seat, welcome it, and tell everyone the lobby changed. */
    protected seatSocket(ws: WebSocket, seat: number, token: string, rejoin: boolean): void {
      ws.serializeAttachment({ seat, token } satisfies Attachment)
      this.ctx.storage.sql.exec('UPDATE seats SET connected = 1 WHERE seat = ?', seat)
      this.send(ws, { t: 'welcome', seat, token })
      this.broadcastLobby()
      if (rejoin) this.onRejoin(seat)
    }

    // ---- state -------------------------------------------------------------

    protected loadState(): S | null {
      const row = this.ctx.storage.sql.exec<{ json: string }>('SELECT json FROM state WHERE id = 1').toArray()[0]
      return row ? (JSON.parse(row.json) as S) : null
    }

    protected saveState(state: S, seq: number): void {
      // Two writes, no await between them: coalesced into one transaction.
      this.ctx.storage.sql.exec(
        'INSERT INTO state (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
        JSON.stringify(state),
      )
      this.setMeta({ seq })
    }

    protected knobs(): Record<string, unknown> {
      return JSON.parse(this.metaValue('knobs') ?? '{}') as Record<string, unknown>
    }

    /** Seat the bots after the humans present, create the game for the seated count, and go. */
    protected startGame(): void {
      const meta = this.getMeta()!
      const humans = this.seats().length
      for (let i = 0; i < meta.botCount; i++) {
        this.ctx.storage.sql.exec(
          'INSERT INTO seats (seat, kind, token, seatToken, displayName, connected) VALUES (?, ?, NULL, NULL, ?, 1)',
          humans + i,
          'bot',
          `Bot ${i + 1}`,
        )
      }
      // Same as the Colyseus room: an early start plays with the seats that exist, not the target.
      const playerCount = this.seats().length
      const knobs = this.knobs()
      const state = adapter.create({ ...knobs, playerCount, seed: meta.seed }, intentRng(meta.seed, 0))
      this.saveState(state, 0)
      this.setMeta({ phase: 'playing' })
      this.setDeadline('expiry', null)
      this.broadcastLobby()
      this.broadcastViews()
      this.scheduleDriving()
    }

    /** Host only, while waiting: start with the people present; bots take every empty seat. */
    protected handleStart(seat: number): void {
      const meta = this.getMeta()!
      if (seat !== 0)
        return this.sendToSeat(seat, { t: 'error', code: 'NOT_HOST', message: 'Only the host can start the match.' })
      if (meta.phase !== 'waiting')
        return this.sendToSeat(seat, { t: 'error', code: 'NOT_WAITING', message: 'The match has already started.' })
      const humans = this.seats().length
      this.setMeta({ botCount: meta.targetPlayers - humans })
      this.startGame()
    }

    protected handleIntent(seat: number, raw: unknown): void {
      const parsed = adapter.intentSchema.safeParse(raw)
      if (!parsed.success)
        return this.sendToSeat(seat, { t: 'error', code: 'BAD_MESSAGE', message: 'Malformed intent.' })
      const meta = this.getMeta()!
      if (meta.phase !== 'playing')
        return this.sendToSeat(seat, { t: 'error', code: 'NOT_PLAYING', message: 'The match is not in progress.' })
      this.applyAndBroadcast({ ...(parsed.data as object), player: seat } as I & { player: number }, seat)
    }

    /** Single choke point: every state change flows through here. The SQLite write lands before any send. */
    protected applyAndBroadcast(intent: I & { player: number }, errorTo?: number): void {
      const meta = this.getMeta()!
      const state = this.loadState()
      if (!state || meta.phase !== 'playing') return
      const result = adapter.apply(state, intent, intentRng(meta.seed, meta.seq + 1))
      if (isRuleError(result)) {
        if (errorTo !== undefined)
          return this.sendToSeat(errorTo, { t: 'error', code: result.code, message: result.message })
        // A driven seat has no client to correct it; re-arm and shout, since the brains should never reach this.
        console.warn(
          `[match ${this.ctx.id.name ?? this.ctx.id.toString().slice(0, 8)}] driven seat ${intent.player} rejected: ${result.code} ${result.message}`,
        )
        this.scheduleDriving()
        return
      }
      const seq = meta.seq + 1
      this.saveState(result, seq)
      const events = adapter.events(state, intent, result)
      this.broadcastViews(events)
      if (adapter.isEnded(result)) {
        this.setMeta({ phase: 'ended' })
        for (const ws of this.ctx.getWebSockets()) this.send(ws, { t: 'ended', reason: 'win', winner: adapter.winner(result) })
        this.onEnded(result)
        return
      }
      this.scheduleDriving()
      this.syncOfferWindow(result)
    }

    protected broadcastViews(events: E[] = []): void {
      const state = this.loadState()
      const meta = this.getMeta()
      if (!state || !meta) return
      for (const row of this.seats()) {
        if (row.kind !== 'human') continue
        const msg: ServerEnvelope = {
          t: 'snapshot',
          seq: meta.seq,
          view: adapter.view(state, row.seat),
          ...(events.length > 0 ? { events: events.map((e) => adapter.redactEvent(e, row.seat)) } : {}),
        }
        this.sendToSeat(row.seat, msg)
      }
    }

    // ---- driving: pilots and bots on the single alarm ------------------------

    protected humansConnected(): number {
      return this.seats().filter((s) => s.kind === 'human' && s.connected === 1).length
    }

    protected memoryFor(seat: number): unknown {
      const row = this.ctx.storage.sql.exec<{ json: string }>('SELECT json FROM memory WHERE seat = ?', seat).toArray()[0]
      return row ? JSON.parse(row.json) : undefined
    }

    protected setMemory(seat: number, memory: unknown): void {
      this.ctx.storage.sql.exec(
        'INSERT INTO memory (seat, json) VALUES (?, ?) ON CONFLICT(seat) DO UPDATE SET json = excluded.json',
        seat,
        JSON.stringify(memory ?? null),
      )
    }

    /**
     * A seat's stored memory plus the live offer-window flag. Both the probe and
     * the real drive must see the same flag: the stored copy is stale the moment
     * the window resolves, and a probe that trusts it never arms the alarm.
     */
    protected driveMemory(seat: number): unknown {
      const offerDeadlineHit = this.metaValue('offerDeadlineHit') === '1'
      const mem = this.memoryFor(seat)
      // A seat that has never driven has no memory yet; the flag must still reach the adapter.
      return { ...(typeof mem === 'object' && mem !== null ? (mem as object) : {}), offerDeadlineHit }
    }

    /** First seat with no human that the game is waiting on, and its kind. */
    protected nextDrivenSeat(state: S): { seat: number; kind: DriveKind } | null {
      for (const row of this.seats()) {
        if (row.kind === 'human' && row.connected === 1) continue
        const kind: DriveKind = row.kind === 'bot' ? 'bot' : 'pilot'
        // The probe rng only asks "is anything pending?"; the real rng is used when the alarm fires.
        const probe = adapter.drive(state, row.seat, kind, { next: () => 0 }, this.driveMemory(row.seat))
        if (probe.intent !== null) return { seat: row.seat, kind }
      }
      return null
    }

    /** Arm (or clear) the pilot deadline for the next driven seat. Replaces the Colyseus room's schedulePilot. */
    protected scheduleDriving(): void {
      const meta = this.getMeta()
      const state = this.loadState()
      if (!meta || !state || meta.phase !== 'playing' || this.humansConnected() === 0) {
        this.setDeadline('pilot', null) // paused while abandoned (spec §4)
        this.armAlarm()
        return
      }
      const next = this.nextDrivenSeat(state)
      if (!next) {
        this.setDeadline('pilot', null)
      } else {
        const knobs = this.knobs()
        const override = next.kind === 'bot' ? knobs.botDelayMs : knobs.pilotDelayMs
        const delay = typeof override === 'number' ? override : adapter.driveDelayMs(next.kind)
        this.setDeadline('pilot', Date.now() + delay)
      }
      this.armAlarm()
    }

    protected firePilot(): void {
      this.setDeadline('pilot', null)
      const meta = this.getMeta()
      const state = this.loadState()
      if (!meta || !state || meta.phase !== 'playing' || this.humansConnected() === 0) return
      // Re-derive: the seat that was pending may have reconnected while the alarm was armed.
      const next = this.nextDrivenSeat(state)
      if (!next) return
      const { intent, memory } = adapter.drive(state, next.seat, next.kind, intentRng(meta.seed, meta.seq + 1), this.driveMemory(next.seat))
      this.setMemory(next.seat, memory)
      if (intent) this.applyAndBroadcast(intent)
      else this.scheduleDriving()
    }

    /** A bot's own offer stays open for offerWindowMs, or until every other seat answered. */
    protected syncOfferWindow(state: S): void {
      const { open, everyoneAnswered } = adapter.offerWindow(state)
      const current = this.seats().find((s) => s.seat === adapter.currentSeat(state))
      if (!open || current?.kind !== 'bot') {
        this.setDeadline('offer', null)
        this.setMeta({ offerDeadlineHit: 0 })
        this.armAlarm()
        return
      }
      if (everyoneAnswered) {
        // Nobody else can answer now; resolve instead of idling out the window.
        this.setDeadline('offer', null)
        this.setMeta({ offerDeadlineHit: 1 })
        this.scheduleDriving()
        return
      }
      if (this.deadlines().offer === null) {
        const knobs = this.knobs()
        const windowMs = typeof knobs.offerWindowMs === 'number' ? knobs.offerWindowMs : adapter.offerWindowMs
        this.setDeadline('offer', Date.now() + windowMs)
        this.armAlarm()
      }
    }

    async alarm(): Promise<void> {
      const now = Date.now()
      for (const key of dueKeys(this.deadlines(), now)) {
        switch (key) {
          case 'pilot':
            this.firePilot()
            break
          case 'offer':
            this.setDeadline('offer', null)
            this.setMeta({ offerDeadlineHit: 1 })
            this.scheduleDriving()
            break
          case 'abandon':
            await this.fireAbandon()
            break
          case 'expiry':
            await this.fireExpiry()
            break
          case 'webhook':
            await this.fireWebhook()
            break
        }
      }
      this.armAlarm()
    }

    /** TEST_KNOBS only: read the game state. */
    stateForTest(): S | null {
      return this.env.TEST_KNOBS === '1' ? this.loadState() : null
    }

    /** TEST_KNOBS only: replace the game state (seq unchanged) and schedule it as if it had just been applied. */
    loadStateForTest(state: S): void {
      if (this.env.TEST_KNOBS !== '1') return
      const meta = this.getMeta()
      if (!meta) return
      this.saveState(state, meta.seq)
      this.scheduleDriving()
      this.syncOfferWindow(state)
    }

    /** TEST_KNOBS only: expose the deadline table. */
    deadlinesForTest(): Deadlines | null {
      return this.env.TEST_KNOBS === '1' ? this.deadlines() : null
    }

    // ---- leave, rejoin, end --------------------------------------------------

    async webSocketClose(ws: WebSocket): Promise<void> {
      const att = this.attachment(ws)
      if (!att) return
      const meta = this.getMeta()
      if (!meta) return
      // another socket for the same seat (duplicate tab) keeps the seat connected
      const stillOpen = this.ctx.getWebSockets().some((o) => o !== ws && this.attachment(o)?.seat === att.seat)
      if (stillOpen) return
      if (meta.phase === 'waiting') {
        // Free the seat and renumber so seats stay 0..n-1 (bots are only added at start).
        const rest = this.seats().filter((r) => r.seat !== att.seat)
        this.ctx.storage.sql.exec('DELETE FROM seats')
        rest.forEach((r, i) =>
          this.ctx.storage.sql.exec(
            'INSERT INTO seats (seat, kind, token, seatToken, displayName, connected) VALUES (?, ?, ?, ?, ?, ?)',
            i, r.kind, r.token, r.seatToken, r.displayName, r.connected,
          ),
        )
        for (const o of this.ctx.getWebSockets()) {
          const a = this.attachment(o)
          if (a && a.seat > att.seat) o.serializeAttachment({ ...a, seat: a.seat - 1 })
        }
        this.broadcastLobby()
        // An empty ad-hoc room goes away after 30s (Colyseus autoDispose); a launched room keeps its invite window.
        if (rest.length === 0 && meta.launched === 0) {
          this.setDeadline('expiry', Date.now() + 30_000)
          this.armAlarm()
        }
        return
      }
      if (meta.phase !== 'playing') return
      this.ctx.storage.sql.exec('UPDATE seats SET connected = 0 WHERE seat = ?', att.seat)
      this.broadcastLobby()
      this.scheduleDriving()
      if (this.humansConnected() === 0) {
        const knobs = this.knobs()
        const abandonMs = typeof knobs.abandonMs === 'number' ? knobs.abandonMs : 10 * 60_000
        if (this.deadlines().abandon === null) this.setDeadline('abandon', Date.now() + abandonMs)
        this.armAlarm()
      }
    }

    async webSocketError(ws: WebSocket): Promise<void> {
      return this.webSocketClose(ws)
    }

    protected onRejoin(seat: number): void {
      this.setDeadline('abandon', null)
      const meta = this.getMeta()!
      const state = this.loadState()
      if (meta.phase !== 'waiting' && state) {
        this.sendToSeat(seat, { t: 'snapshot', seq: meta.seq, view: adapter.view(state, seat) })
        if (meta.phase === 'ended') {
          const reason = this.metaValue('resultStatus') === 'abandoned' ? 'abandoned' : 'win'
          this.sendToSeat(seat, { t: 'ended', reason, winner: adapter.winner(state) })
        }
      }
      this.scheduleDriving()
    }

    protected onEnded(state: S): void {
      this.setDeadline('pilot', null)
      this.setDeadline('offer', null)
      this.setDeadline('abandon', null)
      this.setMeta({ resultStatus: 'completed', resultJson: JSON.stringify(adapter.result(state)) })
      this.setDeadline('webhook', Date.now())
      // ended rooms delete their storage a day later
      this.setDeadline('expiry', Date.now() + 24 * 60 * 60_000)
      this.armAlarm()
    }

    protected async fireAbandon(): Promise<void> {
      this.setDeadline('abandon', null)
      const meta = this.getMeta()
      const state = this.loadState()
      if (!meta || meta.phase !== 'playing' || !state) return
      this.setMeta({ phase: 'ended', resultStatus: 'abandoned', resultJson: JSON.stringify(adapter.result(state)) })
      this.setDeadline('pilot', null)
      this.setDeadline('offer', null)
      for (const ws of this.ctx.getWebSockets()) this.send(ws, { t: 'ended', reason: 'abandoned', winner: null })
      this.setDeadline('webhook', Date.now())
      this.setDeadline('expiry', Date.now() + 24 * 60 * 60_000)
    }

    protected async fireExpiry(): Promise<void> {
      // A waiting room nobody used, or an ended match past its grace: the instance's storage goes away.
      const meta = this.getMeta()
      if (!meta || meta.phase === 'playing') {
        this.setDeadline('expiry', null)
        return
      }
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1000, 'match expired')
        } catch {
          // already gone
        }
      }
      await this.ctx.storage.deleteAll()
      await this.ctx.storage.deleteAlarm()
      // deleteAll drops the tables too; keep this instance answerable (lobby() -> null) until it is evicted.
      this.ctx.storage.sql.exec(SCHEMA)
    }

    protected async fireWebhook(): Promise<void> {
      const meta = this.getMeta()
      if (!meta || !meta.callbackUrl || !meta.callbackToken) {
        this.setDeadline('webhook', null)
        return
      }
      const status = this.metaValue('resultStatus') ?? 'completed'
      const placements = JSON.parse(this.metaValue('resultJson') ?? '[]') as {
        seat: number
        placement: number
        winner: boolean
        stats: Record<string, unknown>
      }[]
      const seats = this.seats()
      const body = {
        code: this.ctx.id.name ?? null,
        status,
        seats: placements.map((p) => {
          const row = seats.find((s) => s.seat === p.seat)
          return {
            ...(row?.seatToken ? { seatToken: row.seatToken } : {}),
            ...(row?.displayName ? { displayName: row.displayName } : {}),
            placement: p.placement,
            winner: p.winner,
            stats: p.stats,
          }
        }),
      }
      const attempt = Number(this.metaValue('webhookAttempts') ?? '0') + 1
      let ok = false
      try {
        const res = await fetch(meta.callbackUrl, {
          method: 'POST',
          headers: { authorization: `Bearer ${meta.callbackToken}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        ok = res.ok
      } catch {
        ok = false
      }
      this.setMeta({ webhookAttempts: attempt })
      if (ok || attempt >= 20) this.setDeadline('webhook', null)
      else this.setDeadline('webhook', Date.now() + Math.min(60 * 60_000, 2 ** attempt * 1000)) // 2s, 4s, ... capped at 1h
    }
  }
}
