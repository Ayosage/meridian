import { describe, expect, it, vi } from 'vitest'
import { handleCreateMatch, LAUNCH_EXPIRE_MS, type LaunchDeps } from '../src/launch'

function deps(overrides: Partial<LaunchDeps> = {}): LaunchDeps {
  return {
    createRoom: vi.fn(async () => ({ status: 'created' as const })),
    newCode: vi.fn(() => 'ABCD'),
    clientOrigin: 'https://play.example',
    launchToken: 'sekrit',
    now: () => 1_000_000,
    ...overrides,
  }
}

describe('handleCreateMatch', () => {
  it('creates a room and shapes the contract response', async () => {
    const d = deps()
    const r = await handleCreateMatch('Bearer sekrit', { players: 4, bots: 1 }, d)
    expect(r.status).toBe(201)
    expect(r.body).toEqual({
      code: 'ABCD',
      joinUrl: 'https://play.example/?join=ABCD',
      expiresAt: new Date(1_000_000 + LAUNCH_EXPIRE_MS).toISOString(),
    })
    expect(d.createRoom).toHaveBeenCalledWith('ABCD', { players: 4, bots: 1, launched: true })
  })

  it('401 on a missing or wrong bearer token, without touching the objects', async () => {
    const d = deps()
    expect((await handleCreateMatch(undefined, { players: 4 }, d)).status).toBe(401)
    expect((await handleCreateMatch('Bearer wrong', { players: 4 }, d)).status).toBe(401)
    expect(d.createRoom).not.toHaveBeenCalled()
  })

  it('401 always when the worker has no token configured, even on an "empty" match', async () => {
    const d = deps({ launchToken: '' })
    expect((await handleCreateMatch('Bearer ', { players: 4 }, d)).status).toBe(401)
    expect((await handleCreateMatch(undefined, { players: 4 }, d)).status).toBe(401)
    expect(d.createRoom).not.toHaveBeenCalled()
  })

  it('422 when the object rejects the options (bad counts)', async () => {
    const d = deps({ createRoom: vi.fn(async () => ({ status: 'invalid' as const, message: 'players must be 3..8' })) })
    const r = await handleCreateMatch('Bearer sekrit', { players: 11 }, d)
    expect(r.status).toBe(422)
    expect(r.body.error).toMatch(/players/)
  })

  it('422 when players is missing or not a number', async () => {
    const d = deps()
    expect((await handleCreateMatch('Bearer sekrit', {}, d)).status).toBe(422)
    expect((await handleCreateMatch('Bearer sekrit', { players: 'four' }, d)).status).toBe(422)
    expect(d.createRoom).not.toHaveBeenCalled()
  })

  it('passes seatNames through only when they are an array of strings', async () => {
    const d = deps()
    await handleCreateMatch('Bearer sekrit', { players: 4, seatNames: ['Alice', 'Bob'] }, d)
    expect(d.createRoom).toHaveBeenCalledWith('ABCD', { players: 4, bots: 0, launched: true, seatNames: ['Alice', 'Bob'] })
    const r = await handleCreateMatch('Bearer sekrit', { players: 4, seatNames: 'Alice' }, d)
    expect(r.status).toBe(422)
  })

  it('accepts the v1 launch shape: seats with display names and a result callback', async () => {
    const d = deps()
    const r = await handleCreateMatch(
      'Bearer sekrit',
      { players: 4, bots: 0, seats: [{ seatToken: 'st_1', displayName: 'Alice' }], callback: { url: 'https://s/w', token: 'cb' } },
      d,
    )
    expect(r.status).toBe(201)
    expect(d.createRoom).toHaveBeenCalledWith('ABCD', {
      players: 4,
      bots: 0,
      launched: true,
      seatNames: ['Alice'],
      callback: { url: 'https://s/w', token: 'cb' },
    })
    expect((await handleCreateMatch('Bearer sekrit', { players: 4, callback: { url: 1 } }, d)).status).toBe(422)
  })

  it('retries a taken code and gives up with 503 when none is free', async () => {
    let n = 0
    const d = deps({
      newCode: vi.fn(() => ['AAAA', 'BBBB'][n++] ?? 'ZZZZ'),
      createRoom: vi.fn(async (code: string) => ({ status: code === 'AAAA' ? ('conflict' as const) : ('created' as const) })),
    })
    const r = await handleCreateMatch('Bearer sekrit', { players: 4 }, d)
    expect(r.status).toBe(201)
    expect(r.body.code).toBe('BBBB')
    const full = deps({ createRoom: vi.fn(async () => ({ status: 'conflict' as const })) })
    expect((await handleCreateMatch('Bearer sekrit', { players: 4 }, full)).status).toBe(503)
  })
})
