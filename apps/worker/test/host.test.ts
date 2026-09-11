import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { Seat } from './ws'

const origin = 'http://localhost:5173'

async function launched(code: string, host = { seatToken: 'st_host', displayName: 'Hosty' }) {
  const stub = env.MATCH.getByName(code)
  const r = await stub.create({ players: 4, bots: 0, launched: true, clientOrigin: origin, host })
  if (r.status !== 'created') throw new Error(JSON.stringify(r))
  return stub
}

describe('host seat reservation', () => {
  it('the host token takes seat 0 when it arrives first', async () => {
    const stub = await launched('HST1')
    const h = await Seat.open('HST1', { seatToken: 'st_host' })
    expect((await h.next('welcome')).seat).toBe(0)
    expect((await stub.lobby())!.seatNames).toEqual(['Hosty'])
  })

  it('the host token takes seat 0 even when a friend opened their link first; the friend is moved and told', async () => {
    const stub = await launched('HST2')
    const friend = await Seat.open('HST2', { seatToken: 'st_friend', displayName: 'Fay' })
    const w1 = await friend.next('welcome')
    expect(w1.seat).toBe(0)
    const host = await Seat.open('HST2', { seatToken: 'st_host' })
    expect((await host.next('welcome')).seat).toBe(0)
    const moved = await friend.next('welcome')
    expect(moved.seat).toBe(1)
    expect(moved.token).toBe(w1.token)
    const lobby = (await stub.lobby())!
    expect(lobby.seats).toEqual(['seat-0', 'seat-1'])
    expect(lobby.seatNames).toEqual(['Hosty', 'Fay'])
    // the moved friend's socket now answers as seat 1: a start attempt is refused as not host
    friend.send({ t: 'start' })
    expect((await friend.next('error')).code).toBe('NOT_HOST')
  })

  it('a room launched without a host makes the first arrival the host, as before', async () => {
    const stub = env.MATCH.getByName('HST3')
    await stub.create({ players: 4, bots: 0, launched: true, clientOrigin: origin })
    const a = await Seat.open('HST3', { seatToken: 'st_a' })
    expect((await a.next('welcome')).seat).toBe(0)
    const b = await Seat.open('HST3', { seatToken: 'st_b' })
    expect((await b.next('welcome')).seat).toBe(1)
  })
})
