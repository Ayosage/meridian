import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../src/index'
import { CODE_ROUTE, MAX_BODY_BYTES, clientIp, overLimit, readCapped } from '../src/guard'

const json = (body: string) =>
  SELF.fetch('https://x/matches/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })

describe('overLimit', () => {
  /** Stands in for the platform binding, which vitest does not provide. */
  const limiterAllowing = (n: number): RateLimit => {
    const seen = new Map<string, number>()
    return {
      limit: async ({ key }: { key?: string }) => {
        const used = (seen.get(key ?? '') ?? 0) + 1
        seen.set(key ?? '', used)
        return { success: used <= n }
      },
    } as RateLimit
  }

  it('passes callers until the window is spent, then refuses', async () => {
    const rl = limiterAllowing(2)
    expect(await overLimit(rl, 'open:1.1.1.1')).toBe(false)
    expect(await overLimit(rl, 'open:1.1.1.1')).toBe(false)
    expect(await overLimit(rl, 'open:1.1.1.1')).toBe(true)
  })

  it('counts each key on its own, so one address cannot spend another budget', async () => {
    const rl = limiterAllowing(1)
    expect(await overLimit(rl, 'open:1.1.1.1')).toBe(false)
    expect(await overLimit(rl, 'open:2.2.2.2')).toBe(false)
    expect(await overLimit(rl, 'lookup:1.1.1.1')).toBe(false)
    expect(await overLimit(rl, 'open:1.1.1.1')).toBe(true)
  })

  it('never refuses when the binding is missing, so a local run still works', async () => {
    expect(await overLimit(undefined, 'open:1.1.1.1')).toBe(false)
  })
})

describe('CODE_ROUTE', () => {
  it('matches a room read and its socket, and nothing else', () => {
    expect(CODE_ROUTE.test('/matches/ABCD')).toBe(true)
    expect(CODE_ROUTE.test('/matches/ABCD/ws')).toBe(true)
    expect(CODE_ROUTE.test('/matches/open')).toBe(false)
    expect(CODE_ROUTE.test('/matches')).toBe(false)
    expect(CODE_ROUTE.test('/healthz')).toBe(false)
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

  /** The real env, minus the knob that waves E2E suites past the ceilings. */
  const live = (limiters: Partial<Record<'OPEN_LIMIT' | 'LOOKUP_LIMIT', RateLimit>>) => ({
    ...env,
    TEST_KNOBS: undefined,
    ...limiters,
  })

  const spent: RateLimit = { limit: async () => ({ success: false }) } as RateLimit

  it('refuses a room when the open ceiling is spent, and says how long to wait', async () => {
    const res = await worker.fetch(
      new Request('https://x/matches/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' },
        body: JSON.stringify({ players: 4, bots: 0 }),
      }),
      live({ OPEN_LIMIT: spent }) as never,
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  })

  it('refuses a code lookup when the lookup ceiling is spent', async () => {
    const res = await worker.fetch(
      new Request('https://x/matches/ABCD', { headers: { 'cf-connecting-ip': '9.9.9.9' } }),
      live({ LOOKUP_LIMIT: spent }) as never,
    )
    expect(res.status).toBe(429)
  })

  it('leaves the launcher route alone, so one Steward is not throttled for everyone', async () => {
    const res = await worker.fetch(
      new Request('https://x/matches', {
        method: 'POST',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ players: 4, bots: 0 }),
      }),
      live({ OPEN_LIMIT: spent, LOOKUP_LIMIT: spent }) as never,
    )
    expect(res.status).toBe(201)
  })

  it('spends the open and lookup budgets under separate keys', async () => {
    const keys: string[] = []
    const record: RateLimit = { limit: async ({ key }) => (keys.push(key ?? ''), { success: true }) } as RateLimit
    await worker.fetch(
      new Request('https://x/matches/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' },
        body: JSON.stringify({ players: 4, bots: 0 }),
      }),
      live({ OPEN_LIMIT: record }) as never,
    )
    await worker.fetch(
      new Request('https://x/matches/ABCD', { headers: { 'cf-connecting-ip': '9.9.9.9' } }),
      live({ LOOKUP_LIMIT: record }) as never,
    )
    expect(keys).toEqual(['open:9.9.9.9', 'lookup:9.9.9.9'])
  })
})
