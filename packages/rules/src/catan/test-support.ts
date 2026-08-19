/**
 * Deterministic test/support utilities shipped in src so OTHER packages'
 * tests (server integration, e2e) can drive the engine — package test
 * files cannot be imported across workspace boundaries.
 */
import { applyCatanIntent } from './apply'
import { isCatanRuleError, type CatanIntent } from './intent'
import { createRng, type Rng } from './rng'
import type { CatanState } from './state'
import { edgeId, vertexId } from './topology'

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

/** Apply an intent that MUST be legal; throws with a readable message otherwise. */
export function mustApply(
  state: CatanState,
  intent: CatanIntent,
  rng: Rng = createRng(0),
): CatanState {
  const result = applyCatanIntent(state, intent, rng)
  if (isCatanRuleError(result))
    throw new Error(`unexpected ${result.code}: ${result.message} (intent ${intent.type})`)
  return result
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
