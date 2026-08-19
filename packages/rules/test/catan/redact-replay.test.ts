import { describe, expect, it } from 'vitest'
import {
  applyCatanIntent,
  botIntent,
  createCatanGame,
  createRng,
  isCatanRuleError,
  redactCatanState,
} from '../../src/index'
import { expectNoLeaks } from './redact.test'

const MAX_INTENTS = 5000

describe('redaction across full seeded games', () => {
  // like full-game.test.ts: not every seed reaches a win inside the cap —
  // the leak property must hold at every step regardless; at least one
  // seed must play to a won game so end-state redaction is covered too.
  it("seeds 1-3: every seat's view is leak-free at every step; >=1 seed reaches a win", () => {
    let wins = 0
    for (const seed of [1, 2, 3]) {
      const rng = createRng(seed)
      let state = createCatanGame({ playerCount: 4 }, rng)
      for (let i = 0; i < MAX_INTENTS && state.winner === null; i++) {
        for (let seat = 0; seat < state.playerCount; seat++) {
          expectNoLeaks(redactCatanState(state, seat), seat, state)
        }
        const result = applyCatanIntent(state, botIntent(state), rng)
        if (isCatanRuleError(result)) throw new Error(`${result.code}: ${result.message}`)
        state = result
      }
      for (let seat = 0; seat < state.playerCount; seat++) {
        expectNoLeaks(redactCatanState(state, seat), seat, state)
      }
      if (state.winner !== null) wins++
    }
    expect(wins).toBeGreaterThan(0)
  })
})
