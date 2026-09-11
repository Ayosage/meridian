import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createRoom, Seat } from './ws'

describe('host configures the room from the web lobby', () => {
  it('the host changes player and bot counts and everyone sees the new lobby', async () => {
    await createRoom('CFG1', 4, 0)
    const host = await Seat.open('CFG1')
    await host.next('welcome')
    const p2 = await Seat.open('CFG1')
    await p2.next('welcome')
    host.send({ t: 'configure', players: 6, bots: 2 })
    // lobby broadcasts queue up as people join; take them in order until the resize lands
    let latest = await p2.next('lobby')
    for (let i = 0; i < 5 && latest.targetPlayers !== 6; i++) latest = await p2.next('lobby')
    expect(latest).toMatchObject({ targetPlayers: 6, botCount: 2 })
    expect(await env.MATCH.getByName('CFG1').lobby()).toMatchObject({ targetPlayers: 6, botCount: 2, phase: 'waiting' })
  })

  it('only the host may configure', async () => {
    await createRoom('CFG2', 4, 0)
    const host = await Seat.open('CFG2')
    await host.next('welcome')
    const p2 = await Seat.open('CFG2')
    await p2.next('welcome')
    p2.send({ t: 'configure', players: 3, bots: 0 })
    expect((await p2.next('error')).code).toBe('NOT_HOST')
    expect((await env.MATCH.getByName('CFG2').lobby())!.targetPlayers).toBe(4)
  })

  it('refuses counts the game cannot play or that do not fit the people already seated', async () => {
    await createRoom('CFG3', 4, 0)
    const host = await Seat.open('CFG3')
    await host.next('welcome')
    const p2 = await Seat.open('CFG3')
    await p2.next('welcome')
    host.send({ t: 'configure', players: 9, bots: 0 })
    expect((await host.next('error')).code).toBe('BAD_CONFIG')
    host.send({ t: 'configure', players: 4, bots: 4 })
    expect((await host.next('error')).code).toBe('BAD_CONFIG')
    // two humans seated: 3 players with 2 bots leaves room for one human only
    host.send({ t: 'configure', players: 3, bots: 2 })
    expect((await host.next('error')).code).toBe('BAD_CONFIG')
    expect((await env.MATCH.getByName('CFG3').lobby())!.targetPlayers).toBe(4)
  })

  it('a configure that makes the seated humans enough starts the match', async () => {
    await createRoom('CFG4', 4, 0)
    const host = await Seat.open('CFG4')
    await host.next('welcome')
    host.send({ t: 'configure', players: 3, bots: 2 })
    const snap = await host.next('snapshot')
    expect((snap.view as { players: unknown[] }).players.length).toBe(3)
  })

  it('configure after the match started is refused', async () => {
    await createRoom('CFG5', 4, 3)
    const host = await Seat.open('CFG5')
    await host.next('snapshot')
    host.send({ t: 'configure', players: 5, bots: 0 })
    expect((await host.next('error')).code).toBe('NOT_WAITING')
  })
})
