import { add, coordKey, DIRECTIONS, neighbors, type Coord } from '../coord'
import { BEGINNER_TERRAIN, PORT_SPECS, TERRAIN_POOL, TOKEN_SPIRAL } from './data'
import { shuffle, type Rng } from './rng'
import { spiralCoords, vertexId, type VertexId } from './topology'
import type { Resource, Terrain } from './types'

export interface HexTile {
  coord: Coord
  terrain: Terrain
  /** null for the desert. */
  token: number | null
}

export interface Port {
  kind: 'generic' | Resource
  vertices: readonly [VertexId, VertexId]
}

export interface CatanBoard {
  /** In spiral order (topology.spiralCoords). */
  hexes: readonly HexTile[]
  ports: readonly Port[]
  /** coordKey of the hex the robber occupies. */
  robber: string
}

function assignTokens(coords: readonly Coord[], terrains: readonly Terrain[]): HexTile[] {
  let t = 0
  return coords.map((coord, i) => ({
    coord,
    terrain: terrains[i]!,
    token: terrains[i] === 'desert' ? null : TOKEN_SPIRAL[t++]!,
  }))
}

/** Returns a problem description, or null when the board is valid. */
export function validateBoard(hexes: readonly HexTile[]): string | null {
  const byKey = new Map(hexes.map((h) => [coordKey(h.coord), h]))
  const counts = new Map<Terrain, number>()
  const tokens: number[] = []
  for (const h of hexes) {
    counts.set(h.terrain, (counts.get(h.terrain) ?? 0) + 1)
    if (h.terrain === 'desert') {
      if (h.token !== null) return 'desert must not carry a token'
    } else {
      if (h.token === null) return `missing token at ${coordKey(h.coord)}`
      tokens.push(h.token)
    }
    if (h.token === 6 || h.token === 8) {
      for (const n of neighbors(h.coord)) {
        const nh = byKey.get(coordKey(n))
        if (nh && (nh.token === 6 || nh.token === 8))
          return `adjacent red tokens at ${coordKey(h.coord)} and ${coordKey(n)}`
      }
    }
  }
  for (const t of new Set(TERRAIN_POOL)) {
    const expected = TERRAIN_POOL.filter((x) => x === t).length
    if ((counts.get(t) ?? 0) !== expected) return `terrain count mismatch for ${t}`
  }
  const sorted = [...tokens].sort((a, b) => a - b)
  const expected = [...TOKEN_SPIRAL].sort((a, b) => a - b)
  if (sorted.length !== expected.length || sorted.some((v, i) => v !== expected[i]))
    return 'token multiset mismatch'
  return null
}

function resolvePorts(coords: readonly Coord[]): Port[] {
  const land = new Set(coords.map(coordKey))
  const outer = coords.slice(0, 12)
  return PORT_SPECS.map((spec) => {
    const hex = outer[spec.outerIndex]!
    const seaDirs = [0, 1, 2, 3, 4, 5].filter((d) => !land.has(coordKey(add(hex, DIRECTIONS[d]!))))
    const d = seaDirs[spec.seaEdgeOffset % seaDirs.length]!
    // edge toward DIRECTIONS[d] runs between corners (d+5)%6 and d
    return { kind: spec.kind, vertices: [vertexId(hex, (d + 5) % 6), vertexId(hex, d)] as const }
  })
}

const MAX_RANDOM_ATTEMPTS = 1000

export function generateBoard(rng: Rng, layout: 'beginner' | 'random' = 'random'): CatanBoard {
  const coords = spiralCoords()
  let hexes: HexTile[]
  if (layout === 'beginner') {
    hexes = assignTokens(coords, BEGINNER_TERRAIN)
    const err = validateBoard(hexes)
    if (err) throw new Error(`beginner layout invalid: ${err}`)
  } else {
    let attempt = 0
    do {
      if (++attempt > MAX_RANDOM_ATTEMPTS) throw new Error('could not generate a valid random board')
      hexes = assignTokens(coords, shuffle(rng, TERRAIN_POOL))
    } while (validateBoard(hexes) !== null)
  }
  const desert = hexes.find((h) => h.terrain === 'desert')!
  return { hexes, ports: resolvePorts(coords), robber: coordKey(desert.coord) }
}
