/** Minimal WebSocket stand-in for the client transport tests. */
export class FakeWs {
  static instances: FakeWs[] = []
  /** Runs right after construction (next microtask) so a test can script open/close per connection. */
  static script: ((ws: FakeWs) => void) | null = null
  static get last(): FakeWs {
    const ws = FakeWs.instances.at(-1)
    if (!ws) throw new Error('no FakeWs constructed yet')
    return ws
  }
  static reset(): void {
    FakeWs.instances = []
    FakeWs.script = null
  }

  readyState = 0
  sent: string[] = []
  private handlers: Record<string, ((e: unknown) => void)[]> = {}

  constructor(public url: string) {
    FakeWs.instances.push(this)
    queueMicrotask(() => FakeWs.script?.(this))
  }
  addEventListener(type: string, cb: (e: unknown) => void): void {
    ;(this.handlers[type] ??= []).push(cb)
  }
  send(s: string): void {
    this.sent.push(s)
  }
  close(code = 1000): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.handlers.close?.forEach((h) => h({ code }))
  }
  // ---- test drivers ----
  open(): void {
    this.readyState = 1
    this.handlers.open?.forEach((h) => h({}))
  }
  receive(m: unknown): void {
    this.handlers.message?.forEach((h) => h({ data: JSON.stringify(m) }))
  }
  fail(): void {
    this.handlers.error?.forEach((h) => h({}))
    this.close(1006)
  }
  sentMessages(): unknown[] {
    return this.sent.map((s) => JSON.parse(s))
  }
}

/** Resolve once at least `n` sockets exist (the transport constructs them after an awaited fetch). */
export async function untilSockets(n: number): Promise<void> {
  for (let i = 0; i < 50 && FakeWs.instances.length < n; i++) await new Promise((r) => setTimeout(r, 0))
  if (FakeWs.instances.length < n) throw new Error(`expected ${n} sockets, saw ${FakeWs.instances.length}`)
}
