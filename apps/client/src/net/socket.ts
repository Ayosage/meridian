import { serverEnvelopeSchema, type ClientEnvelope, type ServerEnvelope } from '@meridian/protocol'

/** `VITE_SERVER_URL` is the Worker's origin (http(s) or ws(s)); the http(s) form, no trailing slash. */
export function httpOrigin(origin: string): string {
  const u = new URL(origin)
  u.protocol = u.protocol === 'wss:' || u.protocol === 'https:' ? 'https:' : 'http:'
  return u.origin
}

/** The match socket url for a room code, derived from the Worker's origin. */
export function wsUrl(origin: string, code: string): string {
  const u = new URL(origin)
  u.protocol = u.protocol === 'wss:' || u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = `/matches/${code}/ws`
  u.search = ''
  u.hash = ''
  return u.toString()
}

/** Thin envelope-aware WebSocket. Reconnection policy lives in net/catan.ts. */
export class MatchSocket {
  private ws: WebSocket | null = null
  private listeners: ((m: ServerEnvelope) => void)[] = []
  private closers: ((code: number) => void)[] = []

  /** Opens the socket and sends `hello` on open. Rejects if it closes or errors first. */
  connect(url: string, hello: ClientEnvelope): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      let opened = false
      ws.addEventListener('open', () => {
        opened = true
        ws.send(JSON.stringify(hello))
        resolve()
      })
      ws.addEventListener('message', (e) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(String((e as MessageEvent).data))
        } catch {
          return
        }
        const env = serverEnvelopeSchema.safeParse(parsed)
        if (!env.success) return
        for (const l of [...this.listeners]) l(env.data)
      })
      ws.addEventListener('close', (e) => {
        const code = (e as CloseEvent).code ?? 1006
        if (!opened) reject(new Error(`socket closed before open (${code})`))
        for (const c of [...this.closers]) c(code)
      })
      ws.addEventListener('error', () => {
        if (!opened) reject(new Error('socket closed before open (error)'))
      })
    })
  }

  send(msg: ClientEnvelope): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg))
  }
  onMessage(cb: (m: ServerEnvelope) => void): void {
    this.listeners.push(cb)
  }
  onClose(cb: (code: number) => void): void {
    this.closers.push(cb)
  }
  /** Deliberate close: nothing is delivered or reported after this. */
  close(): void {
    this.listeners = []
    this.closers = []
    const ws = this.ws
    this.ws = null
    try {
      ws?.close(1000, 'leave')
    } catch {
      // already closed
    }
  }
}
