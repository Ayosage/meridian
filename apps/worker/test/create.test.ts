import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const origin = 'http://localhost:5173'

describe('CatanMatch.create', () => {
  it('creates a waiting room and reports its lobby', async () => {
    const stub = env.MATCH.getByName('AAAA')
    expect(await stub.create({ players: 4, bots: 1, clientOrigin: origin })).toEqual({ status: 'created' })
    expect(await stub.lobby()).toEqual({
      phase: 'waiting',
      seats: [],
      connected: [],
      targetPlayers: 4,
      botCount: 1,
      seatNames: [],
    })
  })
  it('refuses a second create on the same name', async () => {
    const stub = env.MATCH.getByName('AAAB')
    await stub.create({ players: 3, bots: 0, clientOrigin: origin })
    expect(await stub.create({ players: 3, bots: 0, clientOrigin: origin })).toEqual({ status: 'conflict' })
  })
  it('validates player and bot counts like the Colyseus room did', async () => {
    const stub = env.MATCH.getByName('AAAC')
    expect(await stub.create({ players: 2, bots: 0, clientOrigin: 'x' })).toMatchObject({ status: 'invalid', message: expect.stringMatching(/players/) })
    expect(await stub.create({ players: 4, bots: 4, clientOrigin: 'x' })).toMatchObject({ status: 'invalid', message: expect.stringMatching(/bots/) })
    expect(await stub.lobby()).toBeNull()
  })
  it('an unknown name has no lobby', async () => {
    expect(await env.MATCH.getByName('NOPE').lobby()).toBeNull()
  })
})
