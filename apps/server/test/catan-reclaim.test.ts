import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as ClientRoom } from 'colyseus.js'
import appConfig from '../src/app.config'
import { MSG, type CatanSnapshotPayload } from '@meridian/protocol'
import { die, SETUP_PLACEMENTS } from '@meridian/rules'

let server: ColyseusTestServer
beforeAll(async () => {
  server = await boot(appConfig)
})
afterAll(async () => {
  await server.shutdown()
})
afterEach(async () => {
  await server.cleanup()
})

const SHUFFLE_PAD = Array(24).fill(0) // consumed by the dev-deck shuffle at game creation
const CALM_ROLL = [die(1), die(2)] // 3 — nobody produces on this draft

function latest(sink: CatanSnapshotPayload[]): CatanSnapshotPayload {
  return sink.at(-1)!
}

async function settle(ms = 60): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/** Poll until cond() holds (deadline 3s) — avoids brittle fixed sleeps. */
async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !cond(); i++) await settle(10)
  expect(cond()).toBe(true)
}

/**
 * rng budget: 24 shuffle values, then `diceRolls` calm rolls (2 values each),
 * then `pilotPicks` zeros (one per rng-consuming pilot choice, e.g. a setup
 * settlement pick). Values are consumed strictly in play order, so calm
 * rolls and picks must interleave correctly — zeros double as die(≈1)
 * values, which is why picks are appended as generic padding instead.
 */
function script(diceRolls: number, pilotPicks: number): number[] {
  return [...SHUFFLE_PAD, ...Array(diceRolls).fill(CALM_ROLL).flat(), ...Array(pilotPicks).fill(0)]
}

async function bootRoom(rngScript: number[]) {
  const clients: ClientRoom[] = []
  const sinks: CatanSnapshotPayload[][] = []
  const c0 = await server.sdk.joinOrCreate('catan', {
    players: 4,
    layout: 'beginner',
    pilotDelayMs: 0,
    rngScript,
  })
  clients.push(c0)
  for (let i = 1; i < 4; i++) clients.push(await server.sdk.joinById(c0.roomId, {}))
  for (const c of clients) {
    const sink: CatanSnapshotPayload[] = []
    sinks.push(sink)
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
  }
  await settle()
  return { clients, sinks, roomId: c0.roomId }
}

/** Drive the full snake draft over ws, each client placing its own pieces. */
async function completeSetup(clients: ClientRoom[], sinks: CatanSnapshotPayload[][]) {
  for (const p of SETUP_PLACEMENTS) {
    clients[p.player]!.send(MSG.INTENT, { type: 'placeSetupSettlement', vertex: p.vertex })
    await settle(30)
    clients[p.player]!.send(MSG.INTENT, { type: 'placeSetupRoad', edge: p.edge })
    await settle(30)
  }
  expect(latest(sinks[0]!).view.turn.phase).toBe('preRoll')
}

describe('pilot takeover and seat reclaim', () => {
  it('drops a client mid-setup: the pilot completes its placements', async () => {
    // seat 1's pilot settlement pick consumes 1 rng value; no dice rolled
    const { clients, sinks } = await bootRoom(script(0, 1))
    clients[0]!.send(MSG.INTENT, { type: 'placeSetupSettlement', vertex: SETUP_PLACEMENTS[0]!.vertex })
    await settle(30)
    clients[0]!.send(MSG.INTENT, { type: 'placeSetupRoad', edge: SETUP_PLACEMENTS[0]!.edge })
    await settle(30)
    await clients[1]!.leave(true)
    // pilot (delay 0) places settlement + road for seat 1
    await waitFor(() => latest(sinks[2]!).view.turn.current === 2)
    const view = latest(sinks[2]!).view
    expect(Object.keys(view.buildings)).toHaveLength(2)
    expect(view.players[1]!.settlementsLeft).toBe(4)
  })

  it('drops the current player pre-roll: pilot rolls and ends the turn; reclaim restores control', async () => {
    // rolls in order: seat0, pilot-seat1, seat2, seat3, seat0, human-seat1
    const { clients, sinks } = await bootRoom(script(6, 0))
    await completeSetup(clients, sinks)

    clients[0]!.send(MSG.INTENT, { type: 'rollDice' })
    await settle(30)
    clients[0]!.send(MSG.INTENT, { type: 'endTurn' })
    await settle(30)
    expect(latest(sinks[2]!).view.turn.current).toBe(1)

    // seat 1 drops holding the turn; pilot must roll + endTurn
    const token = clients[1]!.reconnectionToken
    await clients[1]!.leave(true)
    await waitFor(() => latest(sinks[2]!).view.turn.current === 2) // pilot finished seat 1's turn
    expect(latest(sinks[2]!).view.turn.phase).toBe('preRoll')

    clients[2]!.send(MSG.INTENT, { type: 'rollDice' })
    await settle(30)
    clients[2]!.send(MSG.INTENT, { type: 'endTurn' })
    await settle(30)

    // seat 1 reclaims before its next turn
    const c1b = await server.sdk.reconnect(token)
    const sink1b: CatanSnapshotPayload[] = []
    c1b.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink1b.push(p))
    c1b.onMessage('*', () => undefined)
    await waitFor(() => sink1b.length > 0)
    expect(latest(sink1b).view.you.seat).toBe(1)

    clients[3]!.send(MSG.INTENT, { type: 'rollDice' })
    await settle(30)
    clients[3]!.send(MSG.INTENT, { type: 'endTurn' })
    await settle(30)
    clients[0]!.send(MSG.INTENT, { type: 'rollDice' })
    await settle(30)
    clients[0]!.send(MSG.INTENT, { type: 'endTurn' })
    await settle(300) // pilot must NOT act for the reclaimed seat 1
    expect(latest(sink1b).view.turn.current).toBe(1)
    expect(latest(sink1b).view.turn.phase).toBe('preRoll') // still waiting on the human
    c1b.send(MSG.INTENT, { type: 'rollDice' })
    await settle(60)
    expect(latest(sink1b).view.turn.phase).toBe('main')
  })
})
