import { expect } from 'vitest'
// import from the ROOT index: it re-exports the catan module plus isRuleError (which lives in src/intent.ts)
import {
  addResources,
  applyCatanIntent,
  createCatanGame,
  createRng,
  edgeId,
  isCatanRuleError,
  subtractResources,
  vertexId,
  type CatanErrorCode,
  type CatanIntent,
  type CatanState,
  type ResourceCount,
  type Rng,
} from '../../src/index'

/** Deterministic rng from an explicit value list; throws when exhausted. */
export function stubRng(values: number[]): Rng {
  let i = 0
  return {
    next() {
      if (i >= values.length) throw new Error('stubRng exhausted')
      return values[i++]!
    },
  }
}

/** A next() value that makes rollD6 return k (1..6). */
export function die(k: number): number {
  return (k - 0.5) / 6
}

export function apply(state: CatanState, intent: CatanIntent, rng: Rng = createRng(0)): CatanState {
  const result = applyCatanIntent(state, intent, rng)
  if (isCatanRuleError(result)) throw new Error(`unexpected ${result.code}: ${result.message} (intent ${intent.type})`)
  return result
}

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

/**
 * A hand-verified legal snake draft on the beginner board. All settlements sit on
 * coastal corners far apart; each road is edge (hex, c) which touches vertex (hex, c).
 * Port facts (beginner board): P0 s1 on the 2:1 brick port, P2 s1 on the 2:1 wheat
 * port, P3 s1 and P1 s2 on 3:1 generic ports.
 * Second-settlement payouts: P3 +1 brick, P2 +1 ore, P1 +1 wheat, P0 +1 ore.
 */
export const SETUP_PLACEMENTS = [
  { player: 0, vertex: vertexId({ q: 2, r: 0 }, 0), edge: edgeId({ q: 2, r: 0 }, 0) },
  { player: 1, vertex: vertexId({ q: -2, r: 0 }, 3), edge: edgeId({ q: -2, r: 0 }, 3) },
  { player: 2, vertex: vertexId({ q: 0, r: -2 }, 1), edge: edgeId({ q: 0, r: -2 }, 1) },
  { player: 3, vertex: vertexId({ q: 0, r: 2 }, 4), edge: edgeId({ q: 0, r: 2 }, 4) },
  { player: 3, vertex: vertexId({ q: 2, r: -2 }, 0), edge: edgeId({ q: 2, r: -2 }, 0) },
  { player: 2, vertex: vertexId({ q: -2, r: 2 }, 4), edge: edgeId({ q: -2, r: 2 }, 4) },
  { player: 1, vertex: vertexId({ q: 1, r: -2 }, 1), edge: edgeId({ q: 1, r: -2 }, 1) },
  { player: 0, vertex: vertexId({ q: -1, r: -1 }, 2), edge: edgeId({ q: -1, r: -1 }, 2) },
] as const

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
