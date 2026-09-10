/**
 * Deterministic test/support utilities shipped in src so OTHER packages'
 * tests (server integration, e2e) can drive the engine — package test
 * files cannot be imported across workspace boundaries.
 */
import { applyCatanIntent } from './apply'
import { COMPANION_DEFAULTS, companionIntent } from './companion'
import { createCatanGame } from './create'
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

/** One reducer step of a driven game, in the order the server's apply choke point sees it. */
export interface GameStep {
  before: CatanState
  intent: CatanIntent
  after: CatanState
}

/**
 * Full companion-vs-companion game at any seat count (3..8), driven exactly
 * the way CatanRoom drives native bots: the current seat acts, pending seats
 * answer open offers, the offerer resolves once everyone has responded, and
 * the per-turn offer/bank-trade budgets reset on turn change. Stops at the
 * win or after `cap` intents; `onStep` sees every (before, intent, after)
 * triple so callers can derive events, check invariants, or tally choices.
 * Throws (never returns a partial game) on a null intent or a rule error —
 * the companion must always have a legal move while the game waits on it.
 */
export function simulateCompanionGame(
  playerCount: 3 | 4 | 5 | 6 | 7 | 8,
  seed: number,
  cap: number,
  onStep?: (step: GameStep) => void,
): CatanState {
  const rng = createRng(seed)
  let state = createCatanGame({ playerCount }, rng)
  const seats = Array.from({ length: playerCount }, (_, s) => s)
  let turnNumber = state.turn.number
  let proposedThisTurn = seats.map(() => false)
  let bankTradesThisTurn = seats.map(() => 0)
  for (let i = 0; i < cap && state.winner === null; i++) {
    if (state.turn.number !== turnNumber) {
      turnNumber = state.turn.number
      proposedThisTurn = seats.map(() => false)
      bankTradesThisTurn = seats.map(() => 0)
    }
    let seat: number
    let opts = COMPANION_DEFAULTS
    if (state.turn.phase === 'discard') {
      seat = Number(Object.keys(state.turn.pendingDiscards)[0]!)
    } else if (state.turn.openTrade) {
      const offer = state.turn.openTrade
      const pending = seats.filter((s) => s !== state.turn.current && offer.responses[s] === undefined)
      if (pending.length > 0) {
        seat = pending[0]!
      } else {
        // every non-current seat has responded: mirror the room's deadline so the loop can't stall
        seat = state.turn.current
        opts = { proposedThisTurn: proposedThisTurn[seat]!, bankTradesThisTurn: bankTradesThisTurn[seat]!, resolveOfferNow: true }
      }
    } else {
      seat = state.turn.current
      opts = { proposedThisTurn: proposedThisTurn[seat]!, bankTradesThisTurn: bankTradesThisTurn[seat]!, resolveOfferNow: false }
    }
    const intent = companionIntent(state, seat, rng, opts)
    if (intent === null)
      throw new Error(`seed ${seed}: companion seat ${seat} stalled at intent ${i}, phase ${state.turn.phase}`)
    if (intent.type === 'offerTrade') proposedThisTurn[seat] = true
    if (intent.type === 'bankTrade') bankTradesThisTurn[seat] = bankTradesThisTurn[seat]! + 1
    const result = applyCatanIntent(state, intent, rng)
    if (isCatanRuleError(result))
      throw new Error(`seed ${seed} seat ${seat}: ${result.code}: ${result.message} (intent ${intent.type})`)
    onStep?.({ before: state, intent, after: result })
    state = result
  }
  return state
}
