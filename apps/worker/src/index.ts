import { matchFetch, type MatchEnv } from '@ayosage/match-core/worker'
import type { CatanMatch } from './match'
import { clientIp, MAX_BODY_BYTES, OPEN_RATE, RateLimiter, readCapped } from './guard'
export { CatanMatch } from './match'

export interface Env extends MatchEnv {
  MATCH: DurableObjectNamespace<CatanMatch>
}

/** Per-isolate; see guard.ts for what that does and does not buy. */
const openLimiter = new RateLimiter(OPEN_RATE)

/**
 * Refusals raised before match-core's router, which means they miss its CORS
 * pass. They repeat the same headers so a browser sees the real status
 * instead of a cross-origin error.
 */
function refuse(env: Env, status: number, error: string, extra: Record<string, string> = {}): Response {
  return Response.json(
    { error },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'access-control-allow-origin': env.CLIENT_ORIGIN,
        vary: 'origin',
        ...extra,
      },
    },
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let incoming = request
    if (request.method === 'POST') {
      const capped = await readCapped(request, MAX_BODY_BYTES)
      if (capped === 'too-large') return refuse(env, 413, `body must be at most ${MAX_BODY_BYTES} bytes`)
      incoming = capped
    }

    // The one unauthenticated route that costs something to serve: each call
    // spawns a Durable Object. TEST_KNOBS marks a local or E2E deployment,
    // where a suite legitimately opens a dozen rooms in a minute.
    const url = new URL(incoming.url)
    if (incoming.method === 'POST' && url.pathname === '/matches/open' && env.TEST_KNOBS !== '1') {
      const ip = clientIp(incoming)
      const verdict = openLimiter.take(ip, Date.now())
      if (!verdict.ok) {
        console.warn(`rate-limited /matches/open from ${ip}: over ${OPEN_RATE.limit} per ${OPEN_RATE.windowMs}ms`)
        return refuse(env, 429, 'Too many matches from this address. Try again in a minute.', {
          'retry-after': String(verdict.retryAfterSeconds),
        })
      }
    }

    return matchFetch(incoming, env)
  },
} satisfies ExportedHandler<Env>
