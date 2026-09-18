/**
 * Abuse guards that run before match-core's router: a body cap and per-IP
 * ceilings on the two unauthenticated routes. `POST /matches/open` needs no
 * token and spawns a Durable Object per call, and `GET /matches/CODE` is how
 * a caller walks the four-letter code space looking for someone's game.
 * Without these, one script can mint rooms as fast as it can post, and any
 * route will happily buffer a megabyte of JSON.
 *
 * The ceilings are Cloudflare's rate limit bindings, declared in
 * wrangler.jsonc. Cloudflare counts them per location, cached per machine and
 * updated asynchronously, and calls them "permissive, eventually consistent,
 * and intentionally designed to not be used as an accurate accounting
 * system". So this is a speed bump, not a quota: a caller spread across fresh
 * connections still gets through. What it is not carrying any more is the
 * cost of a probe, which match-core fixed at the source by building a room's
 * schema on first write rather than in the object's constructor.
 */

/**
 * Largest body any route here has a use for. The biggest real one is a launch
 * with eight seat names and a callback, which is a few hundred bytes.
 */
export const MAX_BODY_BYTES = 16 * 1024

/** Both windows are a minute wide, so this is what a refused caller waits. */
export const RETRY_AFTER_SECONDS = 60

export interface Limiters {
  /** Bound in wrangler.jsonc. Absent under vitest and a plain `wrangler dev`, which then do not throttle. */
  OPEN_LIMIT?: RateLimit
  LOOKUP_LIMIT?: RateLimit
}

/** A GET that reads one room by code: `/matches/ABCD`, with or without the socket upgrade. */
export const CODE_ROUTE = /^\/matches\/[A-Z0-9]{1,12}(\/ws)?$/

/** True when this caller has spent the window. An unbound limiter never refuses. */
export async function overLimit(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return false
  const { success } = await limiter.limit({ key })
  return !success
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
