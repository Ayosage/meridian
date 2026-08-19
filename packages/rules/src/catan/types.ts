export type Resource = 'wood' | 'brick' | 'sheep' | 'wheat' | 'ore'
export const RESOURCES: readonly Resource[] = ['wood', 'brick', 'sheep', 'wheat', 'ore']

export type Terrain = 'forest' | 'hills' | 'pasture' | 'fields' | 'mountains' | 'desert'
export const TERRAIN_RESOURCE: Readonly<Record<Terrain, Resource | null>> = {
  forest: 'wood',
  hills: 'brick',
  pasture: 'sheep',
  fields: 'wheat',
  mountains: 'ore',
  desert: null,
}

export type DevCard = 'knight' | 'vp' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly'

export type ResourceCount = Record<Resource, number>

export function emptyResources(): ResourceCount {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }
}

export function toResourceCount(partial: Partial<ResourceCount>): ResourceCount {
  return { ...emptyResources(), ...partial }
}

export function totalResources(rc: Partial<ResourceCount>): number {
  return RESOURCES.reduce((sum, r) => sum + (rc[r] ?? 0), 0)
}

export function hasResources(hand: ResourceCount, cost: Partial<ResourceCount>): boolean {
  return RESOURCES.every((r) => hand[r] >= (cost[r] ?? 0))
}

export function addResources(a: ResourceCount, b: Partial<ResourceCount>): ResourceCount {
  const out = { ...a }
  for (const r of RESOURCES) out[r] += b[r] ?? 0
  return out
}

export function subtractResources(a: ResourceCount, b: Partial<ResourceCount>): ResourceCount {
  const out = { ...a }
  for (const r of RESOURCES) out[r] -= b[r] ?? 0
  return out
}
