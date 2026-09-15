import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { MAX_BODY_BYTES, OPEN_RATE, RateLimiter, clientIp, readCapped } from '../src/guard'

const json = (body: string) =>
  SELF.fetch('https://x/matches/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })

describe('RateLimiter', () => {
  const spec = { limit: 3, windowMs: 1000, maxKeys: 8 }

  it('allows up to the limit, then refuses with a retry-after', () => {
    const rl = new RateLimiter(spec)
    expect(rl.take('1.1.1.1', 0)).toEqual({ ok: true })
    expect(rl.take('1.1.1.1', 100)).toEqual({ ok: true })
    expect(rl.take('1.1.1.1', 200)).toEqual({ ok: true })
    expect(rl.take('1.1.1.1', 300)).toEqual({ ok: false, retryAfterSeconds: 1 })
  })

  it('counts each address on its own', () => {
    const rl = new RateLimiter(spec)
    for (const t of [0, 1, 2]) rl.take('1.1.1.1', t)
    expect(rl.take('2.2.2.2', 3)).toEqual({ ok: true })
  })

  it('lets the window slide', () => {
    const rl = new RateLimiter(spec)
    for (const t of [0, 100, 200]) rl.take('1.1.1.1', t)
    expect(rl.take('1.1.1.1', 900).ok).toBe(false)
    expect(rl.take('1.1.1.1', 1201)).toEqual({ ok: true })
  })

  it('stays bounded when every request brings a new address', () => {
    const rl = new RateLimiter(spec)
    for (let i = 0; i < 500; i++) rl.take(`10.0.0.${i}`, i)
    // still counting: the most recent key is fresh, not evicted mid-window
    expect(rl.take('10.0.0.499', 500)).toEqual({ ok: true })
  })
})

describe('clientIp', () => {
  it('reads the address Cloudflare saw, or says unknown', () => {
    expect(clientIp(new Request('https://x', { headers: { 'cf-connecting-ip': '9.9.9.9' } }))).toBe('9.9.9.9')
    expect(clientIp(new Request('https://x'))).toBe('unknown')
  })
})

describe('readCapped', () => {
  it('passes a small body through intact', async () => {
    const req = new Request('https://x', { method: 'POST', body: '{"players":4}' })
    const out = await readCapped(req, MAX_BODY_BYTES)
    expect(out).not.toBe('too-large')
    expect(await (out as Request).text()).toBe('{"players":4}')
  })

  it('refuses a body over the cap', async () => {
    const req = new Request('https://x', { method: 'POST', body: 'x'.repeat(MAX_BODY_BYTES + 1) })
    expect(await readCapped(req, MAX_BODY_BYTES)).toBe('too-large')
  })

  it('refuses on a content-length claim alone, without reading', async () => {
    const req = new Request('https://x', {
      method: 'POST',
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
      body: 'small',
    })
    expect(await readCapped(req, MAX_BODY_BYTES)).toBe('too-large')
  })
})

describe('worker guards', () => {
  it('413s an oversized body instead of creating a room', async () => {
    const res = await json(JSON.stringify({ players: 4, bots: 0, pad: 'x'.repeat(1024 * 1024) }))
    expect(res.status).toBe(413)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('16384') })
  })

  it('still creates a room from a normal body', async () => {
    expect((await json(JSON.stringify({ players: 4, bots: 0 }))).status).toBe(201)
  })

  it('the open ceiling is a minute wide and single digit', () => {
    expect(OPEN_RATE.limit).toBeLessThan(10)
    expect(OPEN_RATE.windowMs).toBe(60_000)
  })
})
