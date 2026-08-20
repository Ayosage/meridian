import type { CatanClientIntent } from '@meridian/protocol'
import {
  COSTS, hasResources, legalRoadEdges, RESOURCES,
  type CatanClientState, type DevCard, type EdgeId, type Resource,
} from '@meridian/rules'
import { selectionTotal, type ResourceSelection } from './tradeLogic'

export const DEV_ORDER: readonly DevCard[] = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'vp']

export const DEV_LABELS: Record<DevCard, string> = {
  knight: 'Knight',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
  vp: 'Victory Point',
}

export interface DevGroup {
  card: DevCard
  count: number
  /** Copies bought this turn — shown with a NEW badge, not yet playable. */
  newCount: number
  playable: boolean
}

/** Own dev cards grouped in DEV_ORDER; playability per the engine's applyPlayDevCard gates. */
export function devHand(view: CatanClientState, seat: number): DevGroup[] {
  const { turn } = view
  const myTurnMain = turn.phase === 'main' && turn.current === seat && !turn.devPlayed
  const out: DevGroup[] = []
  for (const card of DEV_ORDER) {
    const copies = view.you.devCards.filter((c) => c.card === card)
    if (copies.length === 0) continue
    const matured = copies.some((c) => c.boughtOnTurn < turn.number)
    out.push({
      card,
      count: copies.length,
      newCount: copies.filter((c) => c.boughtOnTurn === turn.number).length,
      playable: card !== 'vp' && myTurnMain && matured,
    })
  }
  return out
}

export function canBuyDevCard(view: CatanClientState, seat: number): boolean {
  return (
    view.turn.phase === 'main' &&
    view.turn.current === seat &&
    hasResources(view.you.resources, COSTS.devCard) &&
    view.devDeckCount > 0
  )
}

export type RoadBuildingMode = { kind: 'roadBuilding'; staged: EdgeId[] }

/** The engine places exactly min(2, roadsLeft) roads for roadBuilding. */
export function roadBuildingTarget(view: CatanClientState, seat: number): number {
  return Math.min(2, view.players[seat]?.roadsLeft ?? 0)
}

/**
 * Legal edges for the NEXT road-building pick: staged edges are overlaid as
 * owned, mirroring the engine's sequential validation (applyPlayDevCard
 * re-runs legalRoadEdges after each placement) — chains off the first staged
 * road highlight correctly, and staged edges drop out as occupied.
 */
export function legalRoadBuildingEdges(
  view: CatanClientState,
  seat: number,
  staged: readonly EdgeId[],
): EdgeId[] {
  if (staged.length === 0) return legalRoadEdges(view, seat)
  const roads = { ...view.roads }
  for (const e of staged) roads[e] = seat
  return legalRoadEdges({ board: view.board, buildings: view.buildings, roads }, seat)
}

/** Pure: what an edge click does in roadBuilding mode — stage, complete, or nothing. */
export function resolveRoadBuildingClick(
  view: CatanClientState,
  seat: number,
  mode: RoadBuildingMode,
  edge: EdgeId,
): { intent: CatanClientIntent } | { mode: RoadBuildingMode } | null {
  if (!legalRoadBuildingEdges(view, seat, mode.staged).includes(edge)) return null
  const staged = [...mode.staged, edge]
  if (staged.length >= roadBuildingTarget(view, seat)) {
    return { intent: { type: 'playDevCard', card: 'roadBuilding', edges: staged } }
  }
  return { mode: { kind: 'roadBuilding', staged } }
}

/** Exactly two picked and each pick covered by the bank, else null. */
export function yearOfPlentyIntent(
  sel: ResourceSelection,
  bank: CatanClientState['bank'],
): CatanClientIntent | null {
  if (selectionTotal(sel) !== 2) return null
  const take: Resource[] = []
  for (const r of RESOURCES) {
    if (sel[r] > bank[r]) return null
    for (let i = 0; i < sel[r]; i++) take.push(r)
  }
  return { type: 'playDevCard', card: 'yearOfPlenty', take: [take[0]!, take[1]!] }
}

export function monopolyIntent(resource: Resource): CatanClientIntent {
  return { type: 'playDevCard', card: 'monopoly', resource }
}
