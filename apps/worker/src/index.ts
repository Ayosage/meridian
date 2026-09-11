import type { CatanMatch } from './match'
export { CatanMatch } from './match'

export interface Env {
  MATCH: DurableObjectNamespace<CatanMatch>
  LAUNCH_TOKEN: string
  CLIENT_ORIGIN: string
  APP_VERSION: string
  TEST_KNOBS?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/healthz') return Response.json({ ok: true, version: env.APP_VERSION })
    const ws = url.pathname.match(/^\/matches\/([A-Z0-9]{1,12})\/ws$/)
    if (ws) return env.MATCH.getByName(ws[1]!).fetch(request)
    return new Response('not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
