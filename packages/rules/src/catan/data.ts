// Rules-as-data (spec §3): layouts, costs, limits, deck composition, VP values.
import type { DevCard, Resource, ResourceCount, Terrain } from './types'

export const BOARD_RADIUS = 2
export const BANK_PER_RESOURCE = 19
export const VP_TARGET = 10
export const DISCARD_THRESHOLD = 7
export const MIN_LONGEST_ROAD = 5
export const MIN_LARGEST_ARMY = 3

export const PIECE_LIMITS = { roads: 15, settlements: 5, cities: 4 } as const

export const COSTS: Readonly<Record<'road' | 'settlement' | 'city' | 'devCard', Partial<ResourceCount>>> = {
  road: { brick: 1, wood: 1 },
  settlement: { brick: 1, wood: 1, wheat: 1, sheep: 1 },
  city: { ore: 3, wheat: 2 },
  devCard: { ore: 1, wheat: 1, sheep: 1 },
}

export const DEV_DECK_COMPOSITION: Readonly<Record<DevCard, number>> = {
  knight: 14,
  vp: 5,
  roadBuilding: 2,
  yearOfPlenty: 2,
  monopoly: 2,
}

/** Official A..R token order, laid along the spiral, skipping the desert. */
export const TOKEN_SPIRAL: readonly number[] = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11]

export const TERRAIN_POOL: readonly Terrain[] = [
  'forest', 'forest', 'forest', 'forest',
  'pasture', 'pasture', 'pasture', 'pasture',
  'fields', 'fields', 'fields', 'fields',
  'hills', 'hills', 'hills',
  'mountains', 'mountains', 'mountains',
  'desert',
]

/** Fixed "beginner" terrain in spiral order (outer 12, inner 6, center desert). Red tokens land non-adjacent — validateBoard proves it. */
export const BEGINNER_TERRAIN: readonly Terrain[] = [
  'mountains', 'pasture', 'forest', 'fields', 'hills', 'pasture',
  'hills', 'fields', 'forest', 'mountains', 'forest', 'fields',
  'fields', 'pasture', 'mountains', 'forest', 'pasture', 'hills',
  'desert',
]

/**
 * Ports live on coast edges: outer-ring hex (spiral index 0-11), which of its
 * sea edges (index into its off-board directions, ascending), and kind.
 */
export interface PortSpec {
  outerIndex: number
  seaEdgeOffset: number
  kind: 'generic' | Resource
}

export const PORT_SPECS: readonly PortSpec[] = [
  { outerIndex: 0, seaEdgeOffset: 0, kind: 'generic' },
  { outerIndex: 1, seaEdgeOffset: 0, kind: 'wood' },
  { outerIndex: 2, seaEdgeOffset: 1, kind: 'generic' },
  { outerIndex: 4, seaEdgeOffset: 0, kind: 'brick' },
  { outerIndex: 5, seaEdgeOffset: 1, kind: 'sheep' },
  { outerIndex: 7, seaEdgeOffset: 0, kind: 'generic' },
  { outerIndex: 8, seaEdgeOffset: 1, kind: 'wheat' },
  { outerIndex: 10, seaEdgeOffset: 0, kind: 'ore' },
  { outerIndex: 11, seaEdgeOffset: 0, kind: 'generic' },
]
