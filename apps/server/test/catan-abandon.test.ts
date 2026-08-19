import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import appConfig from '../src/app.config'

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

describe('abandonment guard', () => {
  it('pauses pilots with zero humans and disposes the room after the window', async () => {
    const c0 = await server.sdk.joinOrCreate('catan', {
      players: 3,
      pilotDelayMs: 0,
      abandonMinutes: 0.005, // 300ms
      seed: 1,
    })
    const c1 = await server.sdk.joinById(c0.roomId, {})
    const c2 = await server.sdk.joinById(c0.roomId, {})
    for (const c of [c0, c1, c2]) c.onMessage('*', () => undefined)
    const roomId = c0.roomId
    await new Promise((r) => setTimeout(r, 60)) // game started (3 = target)

    // test-only peek at the private authoritative state — do not widen the room API
    const room = server.getRoomById(roomId) as unknown as { game: { seq: number } | null }
    expect(room.game).not.toBeNull()

    await c0.leave(true)
    await c1.leave(true)
    await c2.leave(true)
    await new Promise((r) => setTimeout(r, 80))
    const seqAtAbandon = room.game!.seq
    await new Promise((r) => setTimeout(r, 120))
    // pilots are paused: no intents applied while nobody is connected
    expect(room.game!.seq).toBe(seqAtAbandon)

    // after the abandonment window the room is gone
    for (let i = 0; i < 100 && server.getRoomById(roomId) !== undefined; i++)
      await new Promise((r) => setTimeout(r, 20))
    expect(server.getRoomById(roomId)).toBeUndefined()
  })
})
