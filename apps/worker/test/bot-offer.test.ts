import { env, runDurableObjectAlarm } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { CatanState } from '@meridian/rules'
import { createRoom, Seat } from './ws'

/**
 * Live bug (2026-09-11): a bot offered a trade, the human muted trades (auto
 * decline), and the bot never confirmed or cancelled. The object's "anything
 * pending?" probe read the bot's stored memory, which still said the offer
 * window had not expired, so no alarm was ever armed.
 */
describe('a bot resolves its own trade offer once everyone has answered', () => {
  it('after the last rejection the bot cancels and the turn goes on', async () => {
    await createRoom('BOFR', 3, 2)
    const stub = env.MATCH.getByName('BOFR')
    const me = await Seat.open('BOFR')
    await me.next('snapshot')
    // Put the table in bot 1's main phase with its own offer open; bot 2 already said no.
    const state = (await stub.stateForTest()) as CatanState
    const rigged: CatanState = {
      ...state,
      players: state.players.map((p, i) => (i === 1 ? { ...p, resources: { ...p.resources, wood: 2 } } : p)),
      turn: {
        ...state.turn,
        current: 1,
        number: 3,
        phase: 'main',
        dice: [3, 4],
        setup: null,
        openTrade: { give: { wood: 1 }, get: { ore: 1 }, responses: { 2: { kind: 'reject' } } },
      },
    }
    await stub.loadStateForTest(rigged)
    me.latestSnapshot()
    // The human is the last to answer.
    me.send({ t: 'intent', intent: { type: 'respondTrade', response: 'reject' } })
    const answered = await me.next('snapshot')
    expect((answered.view as CatanState).turn.openTrade?.responses[0]).toEqual({ kind: 'reject' })
    // Nobody else can answer now: the bot must be scheduled to resolve its offer...
    expect((await stub.deadlinesForTest())!.pilot).not.toBeNull()
    // ...and when the alarm fires it cancels, so the offer is gone and the turn continues.
    await new Promise((r) => setTimeout(r, 10))
    await runDurableObjectAlarm(stub)
    const after = await me.next('snapshot')
    expect((after.view as CatanState).turn.openTrade).toBeNull()
  })

  it('after the offer window times out the bot cancels too', async () => {
    await createRoom('BOFT', 3, 2, { offerWindowMs: 40 })
    const stub = env.MATCH.getByName('BOFT')
    const me = await Seat.open('BOFT')
    await me.next('snapshot')
    const state = (await stub.stateForTest()) as CatanState
    await stub.loadStateForTest({
      ...state,
      players: state.players.map((p, i) => (i === 1 ? { ...p, resources: { ...p.resources, wood: 2 } } : p)),
      turn: { ...state.turn, current: 1, number: 3, phase: 'main', dice: [3, 4], setup: null, openTrade: { give: { wood: 1 }, get: { ore: 1 }, responses: {} } },
    })
    // The human never answers, so only the window's expiry can close this offer.
    // Timing on a busy runner is loose: just keep firing due alarms until the offer is gone.
    let resolved: CatanState | null = null
    for (let i = 0; i < 12 && !resolved; i++) {
      await new Promise((r) => setTimeout(r, 15))
      await runDurableObjectAlarm(stub)
      const now = (await stub.stateForTest()) as CatanState
      if (now.turn.openTrade === null) resolved = now
    }
    expect(resolved).not.toBeNull()
    // The cancel lands and the bot carries on with its turn from there.
    expect(resolved!.turn.openTrade).toBeNull()
  })

})
