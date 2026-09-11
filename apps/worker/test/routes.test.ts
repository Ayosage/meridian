import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { Seat } from './ws'

const post = (body: unknown, auth = 'Bearer test-token') =>
  SELF.fetch('https://x/matches', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('routes', () => {
  it('healthz answers ok with a version and no caching', async () => {
    const res = await SELF.fetch('https://x/healthz')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ ok: true, version: expect.any(String) })
  })

  it('POST /matches creates a joinable room with the Steward contract shape', async () => {
    const res = await post({ players: 4, bots: 3, callback: { url: 'https://s/webhooks/results', token: 'cb' } })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { code: string; joinUrl: string; expiresAt: string }
    expect(body.code).toMatch(/^[A-Z]{4}$/)
    expect(body.joinUrl).toBe(`http://localhost:5173/?join=${body.code}`)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())
    const lobby = await SELF.fetch(`https://x/matches/${body.code}`)
    expect(lobby.status).toBe(200)
    expect(await lobby.json()).toMatchObject({ phase: 'waiting', targetPlayers: 4, botCount: 3 })
  })

  it('carries launch seat names into the lobby as humans arrive', async () => {
    const res = await post({ players: 4, bots: 2, seats: [{ seatToken: 'st_a', displayName: 'Alice' }] })
    const { code } = (await res.json()) as { code: string }
    const a = await Seat.open(code)
    await a.next('welcome')
    const lobby = (await (await SELF.fetch(`https://x/matches/${code}`)).json()) as { seatNames: string[] }
    expect(lobby.seatNames).toEqual(['Alice'])
  })

  it('401 without the token, 422 on a bad count or a bad body', async () => {
    expect((await post({ players: 4 }, 'Bearer wrong')).status).toBe(401)
    expect((await post({ players: 11 })).status).toBe(422)
    const raw = await SELF.fetch('https://x/matches', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(raw.status).toBe(422)
  })

  it('unknown code is a 404 lobby and a 404 socket', async () => {
    expect((await SELF.fetch('https://x/matches/ZZZZ')).status).toBe(404)
    expect((await SELF.fetch('https://x/matches/ZZZZ/ws', { headers: { Upgrade: 'websocket' } })).status).toBe(404)
  })

  it('CORS is pinned to CLIENT_ORIGIN and preflight answers 204', async () => {
    const res = await SELF.fetch('https://x/healthz', { headers: { Origin: 'https://evil.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    const pre = await SELF.fetch('https://x/matches', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/authorization/)
  })

  it('anything else is a 404', async () => {
    expect((await SELF.fetch('https://x/nope')).status).toBe(404)
    expect((await SELF.fetch('https://x/matches', { method: 'GET' })).status).toBe(404)
  })
})
