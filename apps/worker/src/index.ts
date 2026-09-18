import { matchFetch, type MatchEnv } from '@ayosage/match-core/worker'
import type { CatanMatch } from './match'
import {
  clientIp,
  CODE_ROUTE,
  MAX_BODY_BYTES,
  overLimit,
  readCapped,
  RETRY_AFTER_SECONDS,
  type Limiters,
} from './guard'
export { CatanMatch } from './match'

export interface Env extends MatchEnv, Limiters {
  MATCH: DurableObjectNamespace<CatanMatch>
}

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

    // The two routes anyone can call. Opening a room spawns a Durable Object;
    // reading one by code is how the four-letter space gets walked. The
    // bearer-authenticated launcher route (`POST /matches`) is left alone:
    // Steward creates every room it launches, so throttling it by address
    // would throttle the whole Discord bot. TEST_KNOBS marks a local or E2E
    // deployment, where a suite legitimately opens a dozen rooms in a minute.
    const url = new URL(incoming.url)
    if (env.TEST_KNOBS !== '1') {
      const ip = clientIp(incoming)
      const opening = incoming.method === 'POST' && url.pathname === '/matches/open'
      const reading = incoming.method === 'GET' && CODE_ROUTE.test(url.pathname)
      const limiter = opening ? env.OPEN_LIMIT : reading ? env.LOOKUP_LIMIT : undefined
      const what = opening ? 'open' : 'lookup'
      if (await overLimit(limiter, `${what}:${ip}`)) {
        console.warn(`rate-limited ${what} from ${ip}`)
        return refuse(env, 429, 'Too many requests from this address. Try again in a minute.', {
          'retry-after': String(RETRY_AFTER_SECONDS),
        })
      }
    }

    return matchFetch(incoming, env)
  },
} satisfies ExportedHandler<Env>
