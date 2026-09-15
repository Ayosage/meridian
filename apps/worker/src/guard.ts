/**
 * Abuse guards that run before match-core's router: a body cap and a per-IP
 * ceiling on room creation. `POST /matches/open` needs no token and spawns a
 * Durable Object per call, so without these one script can mint rooms as fast
 * as it can post, and any route will happily buffer a megabyte of JSON.
 *
 * Both are pure enough to test without a Worker: index.ts owns the wiring.
 */

/**
 * Largest body any route here has a use for. The biggest real one is a launch
 * with eight seat names and a callback, which is a few hundred bytes.
 */
export const MAX_BODY_BYTES = 16 * 1024

export interface RateSpec {
  /** Requests allowed per window, per key. */
  limit: number
  windowMs: number
  /** Keys tracked before the oldest are dropped; bounds the map's memory. */
  maxKeys: number
}

/** Room creation: generous for a person at a keyboard, closed to a loop. */
export const OPEN_RATE: RateSpec = { limit: 6, windowMs: 60_000, maxKeys: 4096 }

export type RateVerdict = { ok: true } | { ok: false; retryAfterSeconds: number }

/**
 * Sliding-window counter held in the isolate.
 *
 * Deliberately not durable: the point is to stop one address hammering one
 * Worker instance, which is where a burst lands, and doing it in memory costs
 * no storage and nothing to run. An attacker spread across many colos (or
 * many addresses) still gets through, so this is a speed bump, not a quota.
 * A global ceiling would need a shared counter (a Durable Object, or
 * Cloudflare's rate-limiting binding).
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(private readonly spec: RateSpec) {}

  /** Records an attempt for `key`, and says whether it is allowed. */
  take(key: string, now: number): RateVerdict {
    const cutoff = now - this.spec.windowMs
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff)
    if (recent.length >= this.spec.limit) {
      this.hits.set(key, recent)
      const oldest = recent[0] ?? now
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.spec.windowMs - now) / 1000)) }
    }
    recent.push(now)
    this.hits.set(key, recent)
    if (this.hits.size > this.spec.maxKeys) this.prune(cutoff)
    return { ok: true }
  }

  /** Drop keys with nothing left in the window, then the oldest until we fit. */
  private prune(cutoff: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= cutoff)) this.hits.delete(key)
    }
    // Map iterates in insertion order, so this sheds the least recently seen.
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.spec.maxKeys) break
      this.hits.delete(key)
    }
  }
}

/** The caller's address, as Cloudflare saw it. */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown'
}

/**
 * Reads the body with a hard ceiling, and hands back a Request the router can
 * still consume. Streams rather than buffering blind, so an oversized upload
 * is cut off at the cap instead of after it has all arrived. `content-length`
 * is only a first look: it is the client's claim, and chunked bodies omit it.
 */
export async function readCapped(request: Request, max: number): Promise<Request | 'too-large'> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) return 'too-large'
  if (request.body === null) return request

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined) continue
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return 'too-large'
    }
    chunks.push(value)
  }

  const body = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    body.set(chunk, at)
    at += chunk.byteLength
  }
  return new Request(request, { body })
}
