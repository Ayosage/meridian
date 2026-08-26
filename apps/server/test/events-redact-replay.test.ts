import { describe, expect, it } from 'vitest'
import {
  applyCatanIntent,
  botIntent,
  createCatanGame,
  createRng,
  isCatanRuleError,
} from '@meridian/rules'
import type { CatanEvent } from '@meridian/protocol'
import { deriveCatanEvents, redactEventForSeat } from '../src/events'

const MAX_INTENTS = 5000

/**
 * redactEventForSeat is fail-OPEN: it strips the known secret channels and
 * passes every other field through. This whitelist is the fail-closed
 * backstop (events analogue of redact-replay.test.ts): a bystander seat —
 * not the actor, not the steal victim — may only ever receive these fields
 * per kind. A new event kind, or a new field on an existing kind, fails
 * here until someone consciously rules it bystander-public and adds it.
 */
const BYSTANDER_FIELDS: Record<CatanEvent['kind'], readonly string[]> = {
  roll: ['kind', 'player', 'dice', 'total', 'gains', 'robbed', 'denied'],
  discard: ['kind', 'player', 'count'], // never `resources`: composition is the discarder's secret
  robber: ['kind', 'player', 'victim'], // never `stolen`: the card is thief/victim knowledge
  monopoly: ['kind', 'player', 'resource', 'taken'],
  yearOfPlenty: ['kind', 'player', 'take'],
  roadBuilding: ['kind', 'player', 'edges'],
  knight: ['kind', 'player'],
  buyDev: ['kind', 'player'],
  build: ['kind', 'player', 'piece'],
  bankTrade: ['kind', 'player', 'give', 'giveCount', 'get'],
  offer: ['kind', 'player', 'give', 'get'],
  tradeResponse: ['kind', 'player', 'response'],
  tradeSettled: ['kind', 'player', 'partner', 'gave', 'got'],
  offerCancelled: ['kind', 'player'],
  turnEnded: ['kind', 'player', 'turn'],
  win: ['kind', 'player'],
}

/** Seats allowed privileged knowledge of `event`; everyone else is a bystander. */
function privilegedSeats(event: CatanEvent): Set<number> {
  const seats = new Set<number>([event.player])
  if (event.kind === 'robber' && event.victim !== null) seats.add(event.victim)
  return seats
}

function expectWhitelistedOnly(event: CatanEvent, seat: number): void {
  const redacted = redactEventForSeat(event, seat)
  const allowed = BYSTANDER_FIELDS[redacted.kind] as readonly string[] | undefined
  expect(allowed, `event kind "${redacted.kind}" has no bystander whitelist entry`).toBeDefined()
  for (const key of Object.keys(redacted)) {
    expect(allowed, `field "${key}" reached bystander seat ${seat} on a "${event.kind}" event`).toContain(key)
  }
}

describe('event redaction across full seeded games', () => {
  // like redact-replay.test.ts: not every seed reaches a win inside the cap —
  // the whitelist property must hold for every event regardless; at least one
  // seed must play to a won game so the `win` event is covered too.
  it("seeds 1-3: bystander seats' events carry only whitelisted fields; >=1 seed reaches a win", () => {
    let wins = 0
    for (const seed of [1, 2, 3]) {
      const rng = createRng(seed)
      let state = createCatanGame({ playerCount: 4 }, rng)
      for (let i = 0; i < MAX_INTENTS && state.winner === null; i++) {
        const before = state
        const intent = botIntent(state)
        const result = applyCatanIntent(state, intent, rng)
        if (isCatanRuleError(result)) throw new Error(`${result.code}: ${result.message}`)
        state = result
        for (const event of deriveCatanEvents(before, intent, state)) {
          const privileged = privilegedSeats(event)
          for (let seat = 0; seat < state.playerCount; seat++) {
            if (!privileged.has(seat)) expectWhitelistedOnly(event, seat)
          }
        }
      }
      if (state.winner !== null) wins++
    }
    expect(wins).toBeGreaterThan(0)
  })
})
