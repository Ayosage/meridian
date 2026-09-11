import { randomCode } from '@meridian/match-core'
import { handleCreateMatch } from './launch'
import type { CatanMatch } from './match'
export { CatanMatch } from './match'

export interface Env {
  MATCH: DurableObjectNamespace<CatanMatch>
  LAUNCH_TOKEN: string
  CLIENT_ORIGIN: string
  APP_VERSION: string
  TEST_KNOBS?: string
}

const CODE_ROUTE = /^\/matches\/([A-Z0-9]{1,12})(\/ws)?$/

/** Every HTTP response is pinned to the one client origin. WebSocket upgrades bypass this (browsers apply no CORS to them). */
function cors(env: Env, res: Response): Response {
  const h = new Headers(res.headers)
  h.set('access-control-allow-origin', env.CLIENT_ORIGIN)
  h.set('access-control-allow-headers', 'authorization, content-type')
  h.set('access-control-allow-methods', 'GET, POST, OPTIONS')
  h.set('vary', 'origin')
  return new Response(res.body, { status: res.status, headers: h })
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return cors(env, new Response(null, { status: 204 }))
    if (url.pathname === '/healthz') return cors(env, json({ ok: true, version: env.APP_VERSION }))

    if (url.pathname === '/matches' && request.method === 'POST') {
      let body: unknown = null
      try {
        body = await request.json()
      } catch {
        return cors(env, json({ error: 'body must be JSON' }, 422))
      }
      const result = await handleCreateMatch(request.headers.get('authorization') ?? undefined, body, {
        createRoom: (code, options) => env.MATCH.getByName(code).create({ ...options, clientOrigin: env.CLIENT_ORIGIN }),
        newCode: randomCode,
        clientOrigin: env.CLIENT_ORIGIN,
        launchToken: env.LAUNCH_TOKEN,
        now: Date.now,
      })
      return cors(env, json(result.body, result.status))
    }

    const m = url.pathname.match(CODE_ROUTE)
    if (m && request.method === 'GET') {
      const stub = env.MATCH.getByName(m[1]!)
      if (m[2]) {
        // 404 before opening a socket when the room does not exist
        if ((await stub.lobby()) === null) return cors(env, new Response('no such match', { status: 404 }))
        return stub.fetch(request)
      }
      const lobby = await stub.lobby()
      return cors(env, lobby ? json(lobby) : new Response('no such match', { status: 404 }))
    }
    return cors(env, new Response('not found', { status: 404 }))
  },
} satisfies ExportedHandler<Env>
