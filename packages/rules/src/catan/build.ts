import type { PlayerId } from '../state'
import { COSTS } from './data'
import { catanError as err, type CatanRuleError } from './intent'
import { updateLongestRoad } from './longest-road'
import { legalCityVertices, legalRoadEdges, legalSettlementVertices } from './queries'
import type { CatanPlayer, CatanState } from './state'
import { addResources, hasResources, subtractResources } from './types'

export function applyBuild(
  state: CatanState,
  intent: { player: PlayerId; piece: 'road' | 'settlement' | 'city'; location: string },
): CatanState | CatanRuleError {
  if (state.turn.phase !== 'main') return err('BAD_PHASE', 'building happens in the main phase')
  const me = state.players[intent.player]!
  const cost = COSTS[intent.piece]
  if (!hasResources(me.resources, cost)) return err('CANT_AFFORD', `cannot afford a ${intent.piece}`)

  const pay = (p: CatanPlayer): CatanPlayer => ({ ...p, resources: subtractResources(p.resources, cost) })
  const bank = addResources(state.bank, cost)

  if (intent.piece === 'road') {
    if (me.roadsLeft === 0) return err('NO_STOCK', 'no road pieces left')
    if (!legalRoadEdges(state, intent.player).includes(intent.location))
      return err('ILLEGAL_PLACEMENT', 'not a legal road edge')
    const players = state.players.map((p, i) =>
      i === intent.player ? { ...pay(p), roadsLeft: p.roadsLeft - 1 } : p,
    )
    return updateLongestRoad({
      ...state,
      players,
      bank,
      roads: { ...state.roads, [intent.location]: intent.player },
    })
  }

  if (intent.piece === 'settlement') {
    if (me.settlementsLeft === 0) return err('NO_STOCK', 'no settlement pieces left')
    if (!legalSettlementVertices(state, intent.player).includes(intent.location))
      return err('ILLEGAL_PLACEMENT', 'not a legal settlement vertex')
    const players = state.players.map((p, i) =>
      i === intent.player ? { ...pay(p), settlementsLeft: p.settlementsLeft - 1 } : p,
    )
    // a new settlement can sever an opponent's longest road
    return updateLongestRoad({
      ...state,
      players,
      bank,
      buildings: { ...state.buildings, [intent.location]: { owner: intent.player, kind: 'settlement' as const } },
    })
  }

  // city
  if (me.citiesLeft === 0) return err('NO_STOCK', 'no city pieces left')
  if (!legalCityVertices(state, intent.player).includes(intent.location))
    return err('ILLEGAL_PLACEMENT', 'cities upgrade your own settlements')
  const players = state.players.map((p, i) =>
    i === intent.player
      ? { ...pay(p), citiesLeft: p.citiesLeft - 1, settlementsLeft: p.settlementsLeft + 1 }
      : p,
  )
  return {
    ...state,
    players,
    bank,
    buildings: { ...state.buildings, [intent.location]: { owner: intent.player, kind: 'city' as const } },
  }
}
