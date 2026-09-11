import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createRoom, openHost, Seat } from './ws'

describe('intent loop', () => {
  it('a lone host with three bots presses Start and gets a setup snapshot; nothing starts on its own', async () => {
    await createRoom('PLAY')
    const me = await Seat.open('PLAY')
    const welcome = await me.next('welcome')
    expect(welcome.seat).toBe(0)
    await expect(me.next('snapshot', 300)).rejects.toThrow(/no snapshot/)
    me.send({ t: 'start' })
    const snap = await me.next('snapshot')
    const view = snap.view as { turn: { phase: string; current: number } }
    expect(view.turn.phase).toBe('setup')
    expect(snap.seq).toBe(0)
  })

  it('an illegal intent returns a rule error to the sender only and does not advance seq', async () => {
    await createRoom('PLAZ')
    const me = await openHost('PLAZ')
    await me.next('snapshot')
    me.send({ t: 'intent', intent: { type: 'rollDice' } })
    const err = await me.next('error')
    expect(err.code).toBe('BAD_PHASE')
    expect(err.message).not.toMatch(/—/)
    expect(me.inbox.filter((m) => m.t === 'snapshot').length).toBe(0)
  })

  it('a malformed intent is rejected as BAD_MESSAGE', async () => {
    await createRoom('PLAM')
    const me = await openHost('PLAM')
    await me.next('snapshot')
    me.send({ t: 'intent', intent: { type: 'teleport' } })
    expect((await me.next('error')).code).toBe('BAD_MESSAGE')
  })

  it('a legal setup placement advances seq and comes back as a snapshot with events', async () => {
    await createRoom('PLAS')
    const me = await openHost('PLAS')
    const first = await me.next('snapshot')
    const view = first.view as { turn: { setup: { expect: string } } }
    expect(view.turn.setup.expect).toBe('settlement')
    const { legalSettlementVertices } = await import('@meridian/rules')
    const vertex = legalSettlementVertices(first.view as never, 0, { setup: true })[0]
    me.send({ t: 'intent', intent: { type: 'placeSetupSettlement', vertex } })
    const next = await me.next('snapshot')
    expect(next.seq).toBe(1)
    expect(next.events?.length).toBeGreaterThan(0)
  })

  it('start now: the host starts with the people present and bots fill the empty seats', async () => {
    await createRoom('EARL', 4, 0)
    const host = await Seat.open('EARL')
    const p2 = await Seat.open('EARL')
    await host.next('welcome')
    await p2.next('welcome')
    p2.send({ t: 'start' })
    expect((await p2.next('error')).code).toBe('NOT_HOST')
    host.send({ t: 'start' })
    const snap = await host.next('snapshot')
    expect((snap.view as { players: unknown[] }).players.length).toBe(4)
    const lobbies = host.inbox.filter((m) => m.t === 'lobby')
    expect(lobbies.at(-1)).toMatchObject({ phase: 'playing', seats: ['seat-0', 'seat-1', 'bot-2', 'bot-3'], botCount: 2 })
  })

  it('start now works for a lone host: the whole table fills with bots', async () => {
    await createRoom('EAR2', 3, 0)
    const host = await Seat.open('EAR2')
    await host.next('welcome')
    host.send({ t: 'start' })
    const snap = await host.next('snapshot')
    expect((snap.view as { players: unknown[] }).players.length).toBe(3)
    host.send({ t: 'start' })
    expect((await host.next('error')).code).toBe('NOT_WAITING')
  })

  it('lobby seat names stay positional: an unnamed human is an empty slot, bots carry their names', async () => {
    await createRoom('NAME', 3, 2)
    const stub = env.MATCH.getByName('NAME')
    const me = await openHost('NAME')
    await me.next('snapshot')
    expect((await stub.lobby())!.seatNames).toEqual(['', 'Bot 1', 'Bot 2'])
    const named = await createRoom('NAMD', 3, 1)
    const a = await Seat.open('NAMD', { displayName: 'Alice' })
    await a.next('welcome')
    const b = await Seat.open('NAMD')
    await b.next('welcome')
    a.send({ t: 'start' })
    await b.next('snapshot')
    expect((await named.lobby())!.seatNames).toEqual(['Alice', '', 'Bot 1'])
  })

})
