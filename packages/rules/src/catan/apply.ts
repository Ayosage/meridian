import { coordKey } from '../coord'
import { isRuleError } from '../intent'
import { catanError as err, type CatanIntent, type CatanRuleError } from './intent'
import { settlementDistanceOk } from './placement'
import type { Rng } from './rng'
import type { CatanState } from './state'
import { standardTopology } from './topology'
import { addResources, TERRAIN_RESOURCE, type Resource } from './types'

/**
 * Pure reducer (spec §3): returns a new state or a CatanRuleError; never mutates.
 * All randomness comes from the injected rng. Bumps seq by 1 on success.
 */
export function applyCatanIntent(
  state: CatanState,
  intent: CatanIntent,
  rng: Rng,
): CatanState | CatanRuleError {
  if (state.winner !== null || state.turn.phase === 'ended')
    return err('GAME_OVER', 'the match is already decided')
  const result = dispatch(state, intent, rng)
  if (isRuleError(result)) return result
  return { ...result, seq: state.seq + 1 }
}

function dispatch(state: CatanState, intent: CatanIntent, rng: Rng): CatanState | CatanRuleError {
  // intents that are legal off-turn dispatch before the turn guard
  if (intent.type === 'discard') return err('BAD_INTENT', 'not implemented yet') // Task 7
  if (intent.type === 'respondTrade') return err('BAD_INTENT', 'not implemented yet') // Task 10

  if (intent.player !== state.turn.current)
    return err('NOT_YOUR_TURN', `it is player ${state.turn.current}'s turn`)

  switch (intent.type) {
    case 'placeSetupSettlement':
      return applyPlaceSetupSettlement(state, intent.vertex)
    case 'placeSetupRoad':
      return applyPlaceSetupRoad(state, intent.edge)
    case 'endTurn':
      return applyEndTurn(state)
    default:
      return err('BAD_INTENT', 'not implemented yet') // replaced task by task (6-11)
  }
}

function applyPlaceSetupSettlement(state: CatanState, vertex: string): CatanState | CatanRuleError {
  const t = state.turn
  if (t.phase !== 'setup') return err('BAD_PHASE', 'setup is over')
  if (t.setup?.expect !== 'settlement')
    return err('ILLEGAL_PLACEMENT', 'place the road for your settlement first')
  const topo = standardTopology()
  if (!topo.vertexEdges[vertex]) return err('ILLEGAL_PLACEMENT', 'not a board vertex')
  if (!settlementDistanceOk(state, vertex))
    return err('ILLEGAL_PLACEMENT', 'settlements must be at least two edges apart')

  const isSecond =
    Object.values(state.buildings).filter((b) => b.owner === t.current).length === 1

  let players = state.players.map((p, i) =>
    i === t.current ? { ...p, settlementsLeft: p.settlementsLeft - 1 } : p,
  )
  let bank = state.bank
  if (isSecond) {
    // second settlement pays out its adjacent land hexes (spec §2)
    const byKey = new Map(state.board.hexes.map((h) => [coordKey(h.coord), h]))
    for (const hk of topo.vertexHexes[vertex] ?? []) {
      const res = TERRAIN_RESOURCE[byKey.get(hk)!.terrain]
      if (!res) continue
      const gain: Partial<Record<Resource, number>> = { [res]: 1 }
      players = players.map((p, i) =>
        i === t.current ? { ...p, resources: addResources(p.resources, gain) } : p,
      )
      bank = { ...bank, [res]: bank[res] - 1 }
    }
  }

  return {
    ...state,
    players,
    bank,
    buildings: { ...state.buildings, [vertex]: { owner: t.current, kind: 'settlement' as const } },
    turn: { ...t, setup: { expect: 'road', lastSettlement: vertex } },
  }
}

function applyPlaceSetupRoad(state: CatanState, edge: string): CatanState | CatanRuleError {
  const t = state.turn
  if (t.phase !== 'setup') return err('BAD_PHASE', 'setup is over')
  if (t.setup?.expect !== 'road' || t.setup.lastSettlement === null)
    return err('ILLEGAL_PLACEMENT', 'place your settlement first')
  const topo = standardTopology()
  const endpoints = topo.edgeVertices[edge]
  if (!endpoints) return err('ILLEGAL_PLACEMENT', 'not a board edge')
  if (state.roads[edge] !== undefined) return err('ILLEGAL_PLACEMENT', 'edge already has a road')
  if (!endpoints.includes(t.setup.lastSettlement))
    return err('ILLEGAL_PLACEMENT', 'the setup road must touch the settlement you just placed')

  const players = state.players.map((p, i) =>
    i === t.current ? { ...p, roadsLeft: p.roadsLeft - 1 } : p,
  )
  const roads = { ...state.roads, [edge]: t.current }

  const n = state.playerCount
  const r = Object.keys(roads).length
  if (r === 2 * n) {
    // draft complete — the real game begins
    return {
      ...state,
      players,
      roads,
      turn: { ...t, current: 0, number: 1, phase: 'preRoll', setup: null },
    }
  }
  const next = r < n ? r : 2 * n - 1 - r
  return {
    ...state,
    players,
    roads,
    turn: { ...t, current: next, setup: { expect: 'settlement', lastSettlement: null } },
  }
}

function applyEndTurn(state: CatanState): CatanState | CatanRuleError {
  if (state.turn.phase !== 'main') return err('BAD_PHASE', 'you can only end your turn in the main phase')
  return {
    ...state,
    turn: {
      ...state.turn,
      current: (state.turn.current + 1) % state.playerCount,
      number: state.turn.number + 1,
      phase: 'preRoll',
      dice: null,
      devPlayed: false,
      robberReturn: null,
      openTrade: null,
    },
  }
}
