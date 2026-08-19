import { describe, expect, it } from 'vitest'
import {
  applyCatanIntent,
  botIntent,
  createCatanGame,
  createRng,
  isCatanRuleError,
  type CatanState,
} from '@meridian/rules'
import { pilotIntent } from '../src/pilot'

const MAX_INTENTS = 5000
const PILOT_SEATS = new Set([1, 3])

/** The single seat the game is currently waiting on. */
function waitingSeat(state: CatanState): number {
  if (state.turn.phase === 'discard') return Number(Object.keys(state.turn.pendingDiscards)[0]!)
  return state.turn.current
}

describe('pilot liveness: piloted seats never stall a game', () => {
  it('mixed human/pilot games terminate or hit the cap without stalls; >=1 seed reaches a win; pilot never wins', () => {
    let wins = 0
    for (const seed of [1, 2, 3]) {
      const rng = createRng(seed)
      let state = createCatanGame({ playerCount: 4 }, rng)
      const pilotTypes = new Set<string>()
      for (let i = 0; i < MAX_INTENTS && state.winner === null; i++) {
        const seat = waitingSeat(state)
        const intent = PILOT_SEATS.has(seat) ? pilotIntent(state, seat, rng) : botIntent(state)
        expect(intent, `seed ${seed}: stalled at step ${i}, phase ${state.turn.phase}, seat ${seat}`).not.toBeNull()
        if (PILOT_SEATS.has(seat)) pilotTypes.add(intent!.type)
        const result = applyCatanIntent(state, intent!, rng)
        if (isCatanRuleError(result))
          throw new Error(
            `seed ${seed} pilot=${PILOT_SEATS.has(seat)} seat=${seat}: ${result.code}: ${result.message}`,
          )
        state = result
      }
      if (state.winner !== null) {
        wins++
        expect(PILOT_SEATS.has(state.winner)).toBe(false)
      }
      // caretaker discipline: no build/buy/play/offer ever emitted
      for (const forbidden of ['build', 'buyDevCard', 'playDevCard', 'offerTrade', 'confirmTrade', 'bankTrade'])
        expect(pilotTypes.has(forbidden), `pilot emitted ${forbidden}`).toBe(false)
    }
    expect(wins).toBeGreaterThan(0)
  })
})
