export interface Coord {
  q: number
  r: number
}

/** The 6 axial hex directions, starting east and going counter-clockwise. */
export const DIRECTIONS: readonly Coord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export function add(a: Coord, b: Coord): Coord {
  return { q: a.q + b.q, r: a.r + b.r }
}

export function coordsEqual(a: Coord, b: Coord): boolean {
  return a.q === b.q && a.r === b.r
}

export function coordKey(c: Coord): string {
  return `${c.q},${c.r}`
}

export function neighbors(c: Coord): Coord[] {
  return DIRECTIONS.map((d) => add(c, d))
}

/** Axial hex distance: (|dq| + |dr| + |dq+dr|) / 2 */
export function distance(a: Coord, b: Coord): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

/** Membership in a hexagonal board of the given radius centered on origin. */
export function inRadius(c: Coord, radius: number): boolean {
  return Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r)) <= radius
}
