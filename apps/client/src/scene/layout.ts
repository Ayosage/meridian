import { coordKey, inRadius, type Coord } from '@meridian/rules'

export const TILE_SIZE = 1

/** Pointy-top axial layout on the XZ ground plane. */
export function coordToWorld(c: Coord, size: number = TILE_SIZE): [number, number, number] {
  const x = size * Math.sqrt(3) * (c.q + c.r / 2)
  const z = size * 1.5 * c.r
  return [x, 0, z]
}

/**
 * Every coord of a hexagonal board, in deterministic row-major (q, then r)
 * order. This order IS the tile instance order — all later lookups rely on it.
 */
export function boardCoords(radius: number): Coord[] {
  const out: Coord[] = []
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const c = { q, r }
      if (inRadius(c, radius)) out.push(c)
    }
  }
  return out
}

export function buildCoordIndex(coords: readonly Coord[]): Map<string, number> {
  const index = new Map<string, number>()
  coords.forEach((c, i) => index.set(coordKey(c), i))
  return index
}
