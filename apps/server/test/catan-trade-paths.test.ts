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

const SHUFFLE_PAD = Array(24).fill(0)
const CALM_ROLL = [die(1), die(2)]

async function settle(ms = 40): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function bootToMain() {
  const rngScript = [...SHUFFLE_PAD, ...CALM_ROLL]
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
  for (const p of SETUP_PLACEMENTS) {
    clients[p.player]!.send(MSG.INTENT, { type: 'placeSetupSettlement', vertex: p.vertex })
    await settle(25)
    clients[p.player]!.send(MSG.INTENT, { type: 'placeSetupRoad', edge: p.edge })
    await settle(25)
  }
  clients[0]!.send(MSG.INTENT, { type: 'rollDice' }) // calm 3 -> main
  await settle()
  expect(sinks[0]!.at(-1)!.view.turn.phase).toBe('main')
  return { clients, sinks }
}

function ruleError(client: ClientRoom): Promise<{ code: string }> {
  return new Promise((resolve) => client.onMessage(MSG.RULE_ERROR, resolve))
}

describe('trade sub-flow over ws', () => {
  it('offer -> reject+accept -> confirm settles the trade between the right seats', async () => {
    const { clients, sinks } = await bootToMain()
    // setup payouts on this draft: P0 holds 1 ore, P1 holds 1 wheat
    expect(sinks[0]!.at(-1)!.view.you.resources.ore).toBe(1)
    expect(sinks[1]!.at(-1)!.view.you.resources.wheat).toBe(1)

    clients[0]!.send(MSG.INTENT, { type: 'offerTrade', give: { ore: 1 }, get: { wheat: 1 } })
    await settle()
    // the open offer is public in every view
    expect(sinks[3]!.at(-1)!.view.turn.openTrade).not.toBeNull()

    clients[2]!.send(MSG.INTENT, { type: 'respondTrade', response: 'reject' })
    await settle(25)
    clients[1]!.send(MSG.INTENT, { type: 'respondTrade', response: 'accept' })
    await settle(25)
    clients[0]!.send(MSG.INTENT, { type: 'confirmTrade', partner: 1 })
    await settle()

    expect(sinks[0]!.at(-1)!.view.you.resources).toMatchObject({ ore: 0, wheat: 1 })
    expect(sinks[1]!.at(-1)!.view.you.resources).toMatchObject({ ore: 1, wheat: 0 })
    // bystanders see only counts move
    expect(sinks[3]!.at(-1)!.view.players[0]!.resourceCount).toBe(1)
    expect(sinks[3]!.at(-1)!.view.players[1]!.resourceCount).toBe(1)
  })
})

describe('message path: every intent type reaches the engine', () => {
  // Each remaining intent type is sent in a context where the ENGINE (not the
  // schema) rejects it — proving parse -> seat -> dispatch -> error routing.
  // Expected codes verified against the engine's actual precedence.
  const engineRejected: [string, Record<string, unknown>, string][] = [
    ['bankTrade', { type: 'bankTrade', give: 'wood', get: 'ore' }, 'CANT_AFFORD'],
    ['buyDevCard', { type: 'buyDevCard' }, 'CANT_AFFORD'],
    ['playDevCard knight', { type: 'playDevCard', card: 'knight' }, 'NO_CARD'],
    [
      'playDevCard roadBuilding',
      { type: 'playDevCard', card: 'roadBuilding', edges: [SETUP_PLACEMENTS[0]!.edge] },
      'NO_CARD',
    ],
    [
      'playDevCard yearOfPlenty',
      { type: 'playDevCard', card: 'yearOfPlenty', take: ['wood', 'wood'] },
      'NO_CARD',
    ],
    ['playDevCard monopoly', { type: 'playDevCard', card: 'monopoly', resource: 'ore' }, 'NO_CARD'],
    ['moveRobber', { type: 'moveRobber', hex: { q: 0, r: 0 }, stealFrom: null }, 'BAD_PHASE'],
    ['discard', { type: 'discard', resources: { wood: 1 } }, 'BAD_PHASE'],
    ['cancelTrade', { type: 'cancelTrade' }, 'NO_TRADE'],
    ['build road', { type: 'build', piece: 'road', location: SETUP_PLACEMENTS[0]!.edge }, 'CANT_AFFORD'],
  ]

  it.each(engineRejected)('%s routes to the engine and errors cleanly', async (_name, intent, code) => {
    const { clients } = await bootToMain()
    const err = ruleError(clients[0]!)
    clients[0]!.send(MSG.INTENT, intent)
    expect((await err).code).toBe(code)
  })
})
