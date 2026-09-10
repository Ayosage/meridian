import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import appConfig from '../src/app.config'

let server: ColyseusTestServer
beforeAll(async () => {
  process.env.LAUNCH_TOKEN = 'test-token'
  process.env.CLIENT_ORIGIN = 'http://localhost:5173'
  server = await boot(appConfig)
})
afterAll(async () => {
  await server.shutdown()
})

describe('GET /healthz', () => {
  it('answers ok with a version and no caching', async () => {
    const res = await fetch('http://127.0.0.1:2568/healthz')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as { ok: boolean; version: string; uptime: number }
    expect(body.ok).toBe(true)
    expect(typeof body.version).toBe('string')
    expect(body.uptime).toBeGreaterThanOrEqual(0)
  })
})

describe('POST /matches over HTTP', () => {
  it('creates a joinable room', async () => {
    const res = await fetch('http://127.0.0.1:2568/matches', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ players: 4, bots: 3 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { code: string; joinUrl: string; expiresAt: string }
    expect(body.joinUrl).toBe(`http://localhost:5173/?join=${body.code}`)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())
    const room = await server.sdk.joinById(body.code)
    await room.leave()
  })

  it('carries seatNames into the room lobby state', async () => {
    const res = await fetch('http://127.0.0.1:2568/matches', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ players: 4, bots: 3, seatNames: ['Alice'] }),
    })
    expect(res.status).toBe(201)
    const { code } = (await res.json()) as { code: string }
    const room = await server.sdk.joinById<{ seatNames: string[] }>(code)
    await new Promise((r) => setTimeout(r, 50))
    expect(room.state.seatNames[0]).toBe('Alice')
    await room.leave()
  })

  it('401 without the token', async () => {
    const res = await fetch('http://127.0.0.1:2568/matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ players: 4 }),
    })
    expect(res.status).toBe(401)
  })

  it('422 on a bad player count', async () => {
    const res = await fetch('http://127.0.0.1:2568/matches', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ players: 11 }),
    })
    expect(res.status).toBe(422)
  })
})
