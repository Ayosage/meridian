import { expect } from 'vitest'
// import from the ROOT index: it re-exports the catan module plus isRuleError (which lives in src/intent.ts)
import {
  addResources,
  applyCatanIntent,
  createCatanGame,
  createRng,
  die,
  isCatanRuleError,
  mustApply,
  stubRng,
  subtractResources,
  SETUP_PLACEMENTS,
  type CatanErrorCode,
  type CatanIntent,
  type CatanState,
  type ResourceCount,
  type Rng,
} from '../../src/index'

// promoted to src/catan/test-support.ts (cross-package reuse); re-exported
// here so existing tests keep their import site
export { die, mustApply, stubRng, SETUP_PLACEMENTS }

/** Apply an intent that MUST be legal; throws with a readable message otherwise. */
export const apply = mustApply

export function expectError(
  state: CatanState,
  intent: CatanIntent,
  code: CatanErrorCode,
  rng: Rng = createRng(0),
): void {
  const result = applyCatanIntent(state, intent, rng)
  if (!isCatanRuleError(result)) throw new Error(`expected ${code}, got success (intent ${intent.type})`)
  expect(result.code).toBe(code)
}

export function setupComplete(): CatanState {
  let state = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
  for (const p of SETUP_PLACEMENTS) {
    state = apply(state, { type: 'placeSetupSettlement', player: p.player, vertex: p.vertex })
    state = apply(state, { type: 'placeSetupRoad', player: p.player, edge: p.edge })
  }
  return state
}

/** Roll a forced 3 (1+2): on this draft nobody produces, so we land cleanly in `main`. */
export function inMain(state: CatanState = setupComplete()): CatanState {
  return apply(state, { type: 'rollDice', player: state.turn.current }, stubRng([die(1), die(2)]))
}

/** Test surgery: hand a player resources out of the bank. */
export function withResources(
  state: CatanState,
  player: number,
  resources: Partial<ResourceCount>,
): CatanState {
  const players = state.players.map((p, i) =>
    i === player ? { ...p, resources: addResources(p.resources, resources) } : p,
  )
  return { ...state, players, bank: subtractResources(state.bank, resources) }
}
