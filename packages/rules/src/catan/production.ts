import { coordKey } from '../coord'
import { DISCARD_THRESHOLD } from './data'
import { catanError as err, type CatanRuleError } from './intent'
import { rollD6, type Rng } from './rng'
import type { CatanState } from './state'
import { topologyFor } from './topology'
import {
  addResources,
  emptyResources,
  RESOURCES,
  TERRAIN_RESOURCE,
  totalResources,
  type Resource,
  type ResourceCount,
} from './types'

/**
 * Payout for a non-7 roll. Bank-shortage rule (spec §2): if the bank cannot
 * cover a resource and MORE THAN ONE player claims it, nobody gets it; a single
 * claimant takes what remains.
 */
/** Gross per-player demand for a non-7 roll, before the bank-shortage rule. */
function grossProduction(state: CatanState, roll: number): ResourceCount[] {
  const topo = topologyFor(state.board)
  const gains: ResourceCount[] = state.players.map(() => emptyResources())

  for (const hex of state.board.hexes) {
    if (hex.token !== roll) continue
    const key = coordKey(hex.coord)
    if (key === state.board.robber) continue
    const res = TERRAIN_RESOURCE[hex.terrain]
    if (!res) continue
    for (const v of topo.hexVertices[key] ?? []) {
      const b = state.buildings[v]
      if (b) gains[b.owner]![res] += b.kind === 'city' ? 2 : 1
    }
  }
  return gains
}

/**
 * Resources the bank-shortage rule wipes for this roll: demanded by 2+
 * players but not fully stockable, so nobody is paid. (A single claimant
 * takes the remainder instead — not a denial.) Feeds the roll event so the
 * log can explain an otherwise silent non-payout.
 */
export function productionDenied(state: CatanState, roll: number): Resource[] {
  const gains = grossProduction(state, roll)
  return RESOURCES.filter((res) => {
    const total = gains.reduce((s, g) => s + g[res], 0)
    return total > state.bank[res] && gains.filter((g) => g[res] > 0).length > 1
  })
}

export function distributeProduction(state: CatanState, roll: number): CatanState {
  const gains = grossProduction(state, roll)
  const bank = { ...state.bank }
  for (const res of RESOURCES) {
    const total = gains.reduce((s, g) => s + g[res], 0)
    if (total === 0) continue
    if (total > bank[res]) {
      const claimants = gains.filter((g) => g[res] > 0)
      if (claimants.length > 1) {
        for (const g of gains) g[res] = 0
        continue
      }
      claimants[0]![res] = bank[res]
    }
    bank[res] -= gains.reduce((s, g) => s + g[res], 0)
  }

  const players = state.players.map((p, i) => ({ ...p, resources: addResources(p.resources, gains[i]!) }))
  return { ...state, players, bank }
}

/** The rollDice intent: roll 2d6, record them, route 7s, pay production. */
export function applyRoll(state: CatanState, rng: Rng): CatanState | CatanRuleError {
  if (state.turn.phase !== 'preRoll') return err('BAD_PHASE', 'dice were already rolled this turn')
  const dice: [number, number] = [rollD6(rng), rollD6(rng)]
  const roll = dice[0] + dice[1]

  if (roll === 7) {
    const pendingDiscards: Record<number, number> = {}
    state.players.forEach((p, i) => {
      const total = totalResources(p.resources)
      if (total > DISCARD_THRESHOLD) pendingDiscards[i] = Math.floor(total / 2)
    })
    const anyDiscards = Object.keys(pendingDiscards).length > 0
    return {
      ...state,
      turn: {
        ...state.turn,
        dice,
        phase: anyDiscards ? 'discard' : 'robber',
        pendingDiscards,
        robberReturn: 'main',
      },
    }
  }

  const produced = distributeProduction(state, roll)
  return { ...produced, turn: { ...produced.turn, dice, phase: 'main' } }
}
