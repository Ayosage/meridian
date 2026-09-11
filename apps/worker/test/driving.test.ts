import { env, runDurableObjectAlarm } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createRoom, openHost, Seat } from './ws'

/** Fire alarms until the predicate holds or we give up. Alarms are stored deadlines; the test clock is real. */
async function driveUntil(code: string, until: () => Promise<boolean> | boolean, max = 80) {
  const stub = env.MATCH.getByName(code)
  for (let i = 0; i < max; i++) {
    if (await until()) return
    await new Promise((r) => setTimeout(r, 10))
    await runDurableObjectAlarm(stub)
  }
  throw new Error('driveUntil gave up')
}

type SetupView = { turn: { current: number; setup: { expect: string } | null } }

describe('driven seats', () => {
  it('bots take their setup turns from the alarm until it is the human again', async () => {
    await createRoom('DRV1')
    const me = await openHost('DRV1')
    const first = await me.next('snapshot')
    const { legalSettlementVertices, topologyFor } = await import('@meridian/rules')
    const v = legalSettlementVertices(first.view as never, 0, { setup: true })[0]!
    me.send({ t: 'intent', intent: { type: 'placeSetupSettlement', vertex: v } })
    const afterSettle = await me.next('snapshot')
    const topo = topologyFor((afterSettle.view as { board: { hexes: unknown[] } }).board)
    const edge = (topo.vertexEdges[v] ?? [])[0]
    me.send({ t: 'intent', intent: { type: 'placeSetupRoad', edge } })
    let latest = await me.next('snapshot')
    expect(latest.seq).toBe(2)
    // Bots 1..3 place, then the snake comes back: 3, 2, 1, and seat 0 places its second settlement.
    await driveUntil('DRV1', () => {
      latest = me.latestSnapshot() ?? latest
      const t = (latest.view as SetupView).turn
      return t.current === 0 && t.setup?.expect === 'settlement' && latest.seq > 2
    })
    expect(latest.seq).toBe(14) // 2 mine + 3 bots x 2 placements x 2 intents
  })

  it('a driven seat that has nothing pending leaves no pilot deadline', async () => {
    await createRoom('DRV2', 3, 0)
    const stub = env.MATCH.getByName('DRV2')
    const a = await Seat.open('DRV2')
    const b = await Seat.open('DRV2')
    const c = await Seat.open('DRV2')
    await Promise.all([a, b, c].map((s) => s.next('welcome')))
    a.send({ t: 'start' })
    await Promise.all([a, b, c].map((s) => s.next('snapshot')))
    // all humans connected: nothing to drive
    expect(await stub.deadlinesForTest()).toMatchObject({ pilot: null, offer: null })
  })

  it('a bot seat with a pending move gets a pilot deadline as soon as the game starts', async () => {
    await createRoom('DRV3', 4, 3)
    const stub = env.MATCH.getByName('DRV3')
    const me = await openHost('DRV3')
    const first = await me.next('snapshot')
    expect((first.view as SetupView).turn.current).toBe(0)
    // seat 0 is the human and must move first, so nothing is driven yet
    expect((await stub.deadlinesForTest())!.pilot).toBeNull()
    const { legalSettlementVertices } = await import('@meridian/rules')
    const v = legalSettlementVertices(first.view as never, 0, { setup: true })[0]!
    me.send({ t: 'intent', intent: { type: 'placeSetupSettlement', vertex: v } })
    await me.next('snapshot')
    // still seat 0 (road), no bot pending
    expect((await stub.deadlinesForTest())!.pilot).toBeNull()
  })
})
