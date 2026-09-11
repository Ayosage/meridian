import { env, SELF } from 'cloudflare:test'
import type { ServerEnvelope } from '@meridian/protocol'

const ORIGIN = 'http://localhost:5173'

export async function createRoom(code: string, players = 4, bots = 3, extra: Record<string, unknown> = {}) {
  const stub = env.MATCH.getByName(code)
  const result = await stub.create({
    players,
    bots,
    clientOrigin: ORIGIN,
    seed: 7,
    knobs: { botDelayMs: 5, pilotDelayMs: 5, ...extra },
  })
  if (result.status !== 'created') throw new Error(`createRoom ${code}: ${JSON.stringify(result)}`)
  return stub
}

type Waiter = (m: ServerEnvelope) => boolean

/** One connected client. Messages queue in `inbox`; `next(t)` consumes the first of a type. */
export class Seat {
  private ws!: WebSocket
  readonly inbox: ServerEnvelope[] = []
  private waiters: Waiter[] = []
  closed = false

  static async open(code: string, hello: Record<string, unknown> = {}): Promise<Seat> {
    const s = new Seat()
    const res = await SELF.fetch(`https://x/matches/${code}/ws`, { headers: { Upgrade: 'websocket' } })
    if (!res.webSocket) throw new Error(`no websocket: ${res.status} ${await res.text()}`)
    s.ws = res.webSocket
    s.ws.accept()
    s.ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data)) as ServerEnvelope
      s.inbox.push(m)
      for (const w of [...s.waiters]) {
        if (w(m)) {
          s.waiters.splice(s.waiters.indexOf(w), 1)
          break
        }
      }
    })
    s.ws.addEventListener('close', () => {
      s.closed = true
    })
    s.send({ t: 'hello', ...hello })
    return s
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg))
  }

  /** Next message of type t (already received or upcoming). */
  next<T extends ServerEnvelope['t']>(t: T, timeoutMs = 3000): Promise<Extract<ServerEnvelope, { t: T }>> {
    const idx = this.inbox.findIndex((m) => m.t === t)
    if (idx >= 0) return Promise.resolve(this.inbox.splice(idx, 1)[0] as Extract<ServerEnvelope, { t: T }>)
    return new Promise((resolve, reject) => {
      const check: Waiter = (m) => {
        if (m.t !== t) return false
        clearTimeout(timer)
        this.inbox.splice(this.inbox.indexOf(m), 1)
        resolve(m as Extract<ServerEnvelope, { t: T }>)
        return true
      }
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(check), 1)
        reject(new Error(`no ${t} within ${timeoutMs}ms; inbox: ${this.inbox.map((m) => m.t).join(',') || 'empty'}`))
      }, timeoutMs)
      this.waiters.push(check)
    })
  }

  /** Drain every queued snapshot and return the latest one, or null. */
  latestSnapshot(): Extract<ServerEnvelope, { t: 'snapshot' }> | null {
    let last: Extract<ServerEnvelope, { t: 'snapshot' }> | null = null
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      if (this.inbox[i]!.t === 'snapshot') {
        if (!last) last = this.inbox[i] as Extract<ServerEnvelope, { t: 'snapshot' }>
        this.inbox.splice(i, 1)
      }
    }
    return last
  }

  close(): void {
    this.ws.close(1000, 'bye')
  }
}
