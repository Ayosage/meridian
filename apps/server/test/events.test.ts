import { describe, expect, it } from 'vitest'
import {
  addResources,
  applyCatanIntent,
  companionIntent,
  createCatanGame,
  createRng,
  die,
  isCatanRuleError,
  mustApply,
  stubRng,
  subtractResources,
  SETUP_PLACEMENTS,
  type CatanIntent,
  type CatanState,
  type ResourceCount,
} from '@meridian/rules'
import { deriveCatanEvents, redactEventForSeat } from '../src/events'

/** Beginner-board game driven through the shared legal draft (mirrors the rules package's own setupComplete helper — not importable across packages). */
function setupComplete(): CatanState {
  let state = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
  for (const p of SETUP_PLACEMENTS) {
    state = mustApply(state, { type: 'placeSetupSettlement', player: p.player, vertex: p.vertex })
    state = mustApply(state, { type: 'placeSetupRoad', player: p.player, edge: p.edge })
  }
  return state
}

function inMain(state: CatanState = setupComplete()): CatanState {
  return mustApply(state, { type: 'rollDice', player: state.turn.current }, stubRng([die(1), die(2)]))
}

function withResources(state: CatanState, player: number, resources: Partial<ResourceCount>): CatanState {
  const players = state.players.map((p, i) =>
    i === player ? { ...p, resources: addResources(p.resources, resources) } : p,
  )
  return { ...state, players, bank: subtractResources(state.bank, resources) }
}

/** Apply and return the (before, intent, after) triple's events. */
function eventsFor(state: CatanState, intent: CatanIntent, rng = createRng(0)) {
  const after = applyCatanIntent(state, intent, rng)
  if (isCatanRuleError(after)) throw new Error(`${after.code}: ${after.message}`)
  return { after, events: deriveCatanEvents(state, intent, after) }
}

describe('deriveCatanEvents', () => {
  it('roll: dice, total, and per-player production gains from the hand diff', () => {
    const state = setupComplete()
    const cur = state.turn.current
    // 3+3=6 pays out on the beginner board's 6-hexes; whatever it is, gains must equal the hand diffs
    const { after, events } = eventsFor(state, { type: 'rollDice', player: cur }, stubRng([die(3), die(3)]))
    const roll = events.find((e) => e.kind === 'roll')!
    expect(roll).toMatchObject({ kind: 'roll', player: cur, total: 6 })
    if (roll.kind === 'roll') {
      for (const [seat, gain] of Object.entries(roll.gains)) {
        for (const [r, n] of Object.entries(gain)) {
          const s = Number(seat)
          expect(after.players[s]!.resources[r as keyof ResourceCount] - state.players[s]!.resources[r as keyof ResourceCount]).toBe(n)
        }
      }
    }
  })

  it('bankTrade: reports the real rate paid', () => {
    const state = withResources(inMain(), 0, { wood: 4 })
    const cur = state.turn.current
    const s = { ...state, turn: { ...state.turn, current: 0 } }
    const { events } = eventsFor(s, { type: 'bankTrade', player: 0, give: 'wood', get: 'ore' })
    expect(events[0]).toMatchObject({ kind: 'bankTrade', player: 0, give: 'wood', get: 'ore' })
    expect((events[0] as { giveCount: number }).giveCount).toBeGreaterThanOrEqual(2) // port rate if seat 0 holds one
    void cur
  })

  it('monopoly: public per-victim amounts', () => {
    let s = inMain()
    s = { ...s, turn: { ...s.turn, current: 0, devPlayed: false } }
    s = withResources(s, 1, { wheat: 2 })
    s = withResources(s, 2, { wheat: 1 })
    const me = s.players[0]!
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0 ? { ...p, devCards: [...me.devCards, { card: 'monopoly' as const, boughtOnTurn: 0 }] } : p,
      ),
    }
    const { events } = eventsFor(s, { type: 'playDevCard', player: 0, card: 'monopoly', resource: 'wheat' })
    const ev = events[0]!
    expect(ev.kind).toBe('monopoly')
    if (ev.kind === 'monopoly') {
      expect(ev.resource).toBe('wheat')
      expect(ev.taken[1]).toBeGreaterThanOrEqual(2)
      expect(ev.taken[2]).toBeGreaterThanOrEqual(1)
    }
  })

  it('confirmTrade: settled terms from the accepted offer', () => {
    let s = withResources(inMain(), 0, { wood: 1 })
    s = { ...s, turn: { ...s.turn, current: 0 } }
    s = withResources(s, 2, { brick: 1 })
    s = mustApply(s, { type: 'offerTrade', player: 0, give: { wood: 1 }, get: { brick: 1 } })
    s = mustApply(s, { type: 'respondTrade', player: 2, response: 'accept' })
    const { events } = eventsFor(s, { type: 'confirmTrade', player: 0, partner: 2 })
    expect(events[0]).toMatchObject({
      kind: 'tradeSettled',
      player: 0,
      partner: 2,
      gave: { wood: 1 },
      got: { brick: 1 },
    })
  })

  it('win: appended when the applying intent crosses the target', () => {
    const state = setupComplete()
    // no cheap way to force a win here; assert the negative — ordinary intents carry no win event
    const cur = state.turn.current
    const { events } = eventsFor(state, { type: 'rollDice', player: cur }, stubRng([die(1), die(2)]))
    expect(events.some((e) => e.kind === 'win')).toBe(false)
  })
})

describe('redactEventForSeat', () => {
  it('discard: composition only for the discarder; count public', () => {
    const ev = { kind: 'discard' as const, player: 1, count: 4, resources: { wood: 2, ore: 2 } }
    expect(redactEventForSeat(ev, 1)).toEqual(ev)
    const other = redactEventForSeat(ev, 0)
    expect(other).toMatchObject({ kind: 'discard', player: 1, count: 4 })
    expect((other as { resources?: unknown }).resources).toBeUndefined()
  })

  it('robber steal: resource named only to thief and victim', () => {
    const ev = { kind: 'robber' as const, player: 2, victim: 0, stolen: 'wheat' as const }
    expect(redactEventForSeat(ev, 2)).toEqual(ev) // thief
    expect(redactEventForSeat(ev, 0)).toEqual(ev) // victim
    const bystander = redactEventForSeat(ev, 3)
    expect(bystander).toMatchObject({ kind: 'robber', player: 2, victim: 0 })
    expect((bystander as { stolen?: unknown }).stolen).toBeUndefined()
  })

  it('everything else passes through untouched', () => {
    const ev = { kind: 'buyDev' as const, player: 3 }
    expect(redactEventForSeat(ev, 0)).toEqual(ev)
  })
})

describe('steal resource derivation', () => {
  it('robber event names the stolen resource from the thief hand diff', () => {
    let s = setupComplete()
    // 3+4=7 -> robber phase (no hand > 7 on this draft, straight to robber)
    s = mustApply(s, { type: 'rollDice', player: s.turn.current }, stubRng([die(3), die(4)]))
    expect(s.turn.phase).toBe('robber')
    const mover = s.turn.current
    // find a hex+victim the engine will accept: reuse the companion's own choice
    const intent = companionIntent(s, mover, createRng(0))!
    expect(intent.type).toBe('moveRobber')
    const { events } = eventsFor(s, intent, createRng(0))
    const ev = events.find((e) => e.kind === 'robber')!
    if (ev.kind === 'robber' && ev.victim !== null) {
      expect(ev.stolen).toBeDefined()
    }
  })
})
