import { DurableObject } from 'cloudflare:workers'
import { clientEnvelopeSchema, type LobbyPayload, type ServerEnvelope } from '@meridian/protocol'
import type { GameAdapter } from './adapter'
import { NO_DEADLINES, earliest, type Deadlines } from './timers'

export interface CreateOptions {
  players: number
  bots: number
  seed?: number
  launched?: boolean
  seatNames?: string[]
  callback?: { url: string; token: string }
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
      const seed = typeof opts.seed === 'number' && testing ? opts.seed : Math.floor(Math.random() * 2 ** 31)
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
        seatNames: seats.map((s, i) => s.displayName ?? names[i] ?? '').filter((n) => n.length > 0),
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
      const seat = seats.length
      const token = crypto.randomUUID()
      this.ctx.storage.sql.exec(
        'INSERT INTO seats (seat, kind, token, seatToken, displayName, connected) VALUES (?, ?, ?, ?, ?, 1)',
        seat,
        'human',
        token,
        hello.seatToken ?? null,
        hello.displayName ?? null,
      )
      this.seatSocket(ws, seat, token, false)
      if (seats.length + 1 === humansWanted) this.startGame()
    }

    /** Bind the socket to a seat, welcome it, and tell everyone the lobby changed. */
    protected seatSocket(ws: WebSocket, seat: number, token: string, rejoin: boolean): void {
      ws.serializeAttachment({ seat, token } satisfies Attachment)
      this.ctx.storage.sql.exec('UPDATE seats SET connected = 1 WHERE seat = ?', seat)
      this.send(ws, { t: 'welcome', seat, token })
      this.broadcastLobby()
      if (rejoin) this.onRejoin(seat)
    }

    // Filled in by Task 4 (intent loop) and Task 5/6 (driving, rejoin):
    protected startGame(): void {}
    protected handleStart(_seat: number): void {}
    protected handleIntent(_seat: number, _intent: unknown): void {}
    protected onRejoin(_seat: number): void {}
    async webSocketClose(_ws: WebSocket): Promise<void> {}
    async alarm(): Promise<void> {}
  }
}
