import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import { matchMaker } from 'colyseus'
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

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('launched-room expiry', () => {
  it('an unjoined launched room disposes after the expiry window', async () => {
    const { roomId } = await matchMaker.createRoom('catan', {
      players: 4,
      bots: 3,
      launched: true,
      launchExpireMs: 100,
    })
    await settle(250)
    await expect(server.sdk.joinById(roomId)).rejects.toThrow()
  })

  it('a launched room that started plays on past the window', async () => {
    const { roomId } = await matchMaker.createRoom('catan', {
      players: 4,
      bots: 3,
      launched: true,
      launchExpireMs: 100,
      seed: 1,
      pilotDelayMs: 0,
      botDelayMs: 0,
    })
    // players:4 bots:3 starts on the single human join — the join is the start
    const client = await server.sdk.joinById(roomId)
    client.onMessage('*', () => undefined)
    await settle(250)
    expect(client.state.phase).toBe('playing')
    await client.leave()
  })
})
