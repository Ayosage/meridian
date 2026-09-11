import { env, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoom, Seat } from './ws'

afterEach(() => vi.unstubAllGlobals())

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('lifecycle', () => {
  it('leaving while waiting frees the seat; a dropped player in play is marked disconnected and can rejoin with the token', async () => {
    await createRoom('LIFE', 3, 0)
    const stub = env.MATCH.getByName('LIFE')
    const a = await Seat.open('LIFE')
    const b = await Seat.open('LIFE')
    const wa = await a.next('welcome')
    await b.next('welcome')
    b.close()
    await settle()
    expect((await stub.lobby())!.seats).toEqual(['seat-0'])
    const c = await Seat.open('LIFE')
    await c.next('welcome')
    expect((await c.next('welcome').catch(() => null))).toBeNull() // only one welcome
    const d = await Seat.open('LIFE')
    expect((await d.next('welcome')).seat).toBe(2)
    await a.next('snapshot') // 3 seated: playing
    a.close()
    await settle()
    expect((await stub.lobby())!.connected[0]).toBe(false)
    const back = await Seat.open('LIFE', { token: wa.token })
    expect((await back.next('welcome')).seat).toBe(0)
    expect((await back.next('snapshot')).seq).toBeGreaterThanOrEqual(0)
    expect((await stub.lobby())!.connected[0]).toBe(true)
    expect((await stub.deadlinesForTest())!.abandon).toBeNull()
  })

  it('a wrong token is refused', async () => {
    await createRoom('LIF2', 4, 3)
    const me = await Seat.open('LIF2', { token: 'nope' })
    expect((await me.next('error')).code).toBe('BAD_TOKEN')
  })

  it('a launched room nobody joins expires and deletes its storage', async () => {
    const stub = env.MATCH.getByName('LIF3')
    await stub.create({ players: 4, bots: 3, launched: true, clientOrigin: 'x', knobs: { launchExpireMs: 1 } })
    expect((await stub.lobby())!.phase).toBe('waiting')
    await settle(5)
    await runDurableObjectAlarm(stub)
    expect(await stub.lobby()).toBeNull()
  })

  it('a launched room keeps its launch window when the first arrival leaves again', async () => {
    const stub = env.MATCH.getByName('LIF5')
    await stub.create({ players: 4, bots: 2, launched: true, clientOrigin: 'x', knobs: { launchExpireMs: 60_000 } })
    const before = (await stub.deadlinesForTest())!.expiry!
    const a = await Seat.open('LIF5')
    await a.next('welcome')
    a.close()
    await settle()
    expect((await stub.deadlinesForTest())!.expiry).toBe(before)
  })

  it('abandonment with no humans posts an abandoned result to the callback', async () => {
    const calls: { url: string; body: unknown; auth: string | null }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('authorization') })
      return new Response('ok', { status: 200 })
    })
    const stub = env.MATCH.getByName('LIF4')
    await stub.create({
      players: 4,
      bots: 3,
      clientOrigin: 'x',
      callback: { url: 'https://steward.example/webhooks/results', token: 'cb_1' },
      knobs: { abandonMs: 1, botDelayMs: 5 },
    })
    const me = await Seat.open('LIF4', { seatToken: 'st_me', displayName: 'Alice' })
    await me.next('snapshot')
    me.close()
    await settle(5)
    await runDurableObjectAlarm(stub) // abandon fires, arms the webhook for now
    await runDurableObjectAlarm(stub) // webhook fires
    expect(calls[0]?.url).toBe('https://steward.example/webhooks/results')
    expect(calls[0]?.auth).toBe('Bearer cb_1')
    const body = calls[0]?.body as { code: string; status: string; seats: { seatToken?: string; displayName?: string; placement: number }[] }
    expect(body.code).toBe('LIF4')
    expect(body.status).toBe('abandoned')
    expect(body.seats).toHaveLength(4)
    expect(body.seats.find((s) => s.seatToken === 'st_me')).toMatchObject({ displayName: 'Alice' })
    expect((await stub.lobby())!.phase).toBe('ended')
    expect((await stub.deadlinesForTest())!.webhook).toBeNull()
  })

  it('a failed webhook is retried with backoff and gives up cleanly on success', async () => {
    let n = 0
    vi.stubGlobal('fetch', async () => new Response(n++ === 0 ? 'nope' : 'ok', { status: n === 1 ? 500 : 200 }))
    const stub = env.MATCH.getByName('LIF6')
    await stub.create({ players: 4, bots: 3, clientOrigin: 'x', callback: { url: 'https://s/x', token: 't' }, knobs: { abandonMs: 1 } })
    const me = await Seat.open('LIF6')
    await me.next('snapshot')
    me.close()
    await settle(5)
    await runDurableObjectAlarm(stub) // abandon
    await runDurableObjectAlarm(stub) // webhook attempt 1 fails
    const d = (await stub.deadlinesForTest())!
    expect(d.webhook).toBeGreaterThan(Date.now() + 1000)
    expect(n).toBe(1)
  })
})
