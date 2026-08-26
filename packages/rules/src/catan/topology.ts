import { add, coordKey, DIRECTIONS, type Coord } from '../coord'

/** Canonical vertex name: the sorted coordKeys of the 3 hexes meeting there (off-board hexes included — they are just names). */
export type VertexId = string
/** Canonical edge name: the sorted coordKeys of the 2 hexes it separates. */
export type EdgeId = string

/** Corner i of a hex sits between its edges toward DIRECTIONS[i] and DIRECTIONS[i+1]. */
export function vertexId(hex: Coord, corner: number): VertexId {
  const i = ((corner % 6) + 6) % 6
  const parts = [hex, add(hex, DIRECTIONS[i]!), add(hex, DIRECTIONS[(i + 1) % 6]!)]
  return parts.map(coordKey).sort().join('|')
}

/** The edge between a hex and its neighbor in DIRECTIONS[dir]. */
export function edgeId(hex: Coord, dir: number): EdgeId {
  const i = ((dir % 6) + 6) % 6
  return [coordKey(hex), coordKey(add(hex, DIRECTIONS[i]!))].sort().join('|')
}

/**
 * All hexes of a radius-R board in spiral order: outermost ring first
 * (starting at DIRECTIONS[4] * R, walking DIRECTIONS[0..5]), inward, center
 * last. Token placement (data.ts) relies on this exact order.
 */
export function spiralCoords(radius = 2): Coord[] {
  const out: Coord[] = []
  for (let r = radius; r >= 1; r--) {
    let hex: Coord = { q: DIRECTIONS[4]!.q * r, r: DIRECTIONS[4]!.r * r }
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < r; step++) {
        out.push(hex)
        hex = add(hex, DIRECTIONS[side]!)
      }
    }
  }
  out.push({ q: 0, r: 0 })
  return out
}

export interface Topology {
  vertices: readonly VertexId[]
  edges: readonly EdgeId[]
  /** coordKeys of the LAND hexes touching each vertex (1-3). */
  vertexHexes: Readonly<Record<VertexId, readonly string[]>>
  vertexVertices: Readonly<Record<VertexId, readonly VertexId[]>>
  vertexEdges: Readonly<Record<VertexId, readonly EdgeId[]>>
  edgeVertices: Readonly<Record<EdgeId, readonly [VertexId, VertexId]>>
  /** coordKey of each land hex -> its 6 corner vertex ids (corner order 0..5). */
  hexVertices: Readonly<Record<string, readonly VertexId[]>>
}

export function buildTopology(hexes: readonly Coord[]): Topology {
  const vertices = new Set<VertexId>()
  const edges = new Set<EdgeId>()
  const vertexHexes = new Map<VertexId, Set<string>>()
  const vertexVertices = new Map<VertexId, Set<VertexId>>()
  const vertexEdges = new Map<VertexId, Set<EdgeId>>()
  const edgeVertices = new Map<EdgeId, [VertexId, VertexId]>()
  const hexVertices: Record<string, VertexId[]> = {}

  const into = <K, V>(map: Map<K, Set<V>>, key: K, value: V) => {
    const set = map.get(key) ?? new Set<V>()
    set.add(value)
    map.set(key, set)
  }

  for (const hex of hexes) {
    const hk = coordKey(hex)
    const corners: VertexId[] = []
    for (let i = 0; i < 6; i++) {
      const v = vertexId(hex, i)
      corners.push(v)
      vertices.add(v)
      into(vertexHexes, v, hk)
    }
    hexVertices[hk] = corners
    for (let d = 0; d < 6; d++) {
      const e = edgeId(hex, d)
      edges.add(e)
      // edge toward DIRECTIONS[d] runs between corners (d+5)%6 and d
      const a = vertexId(hex, (d + 5) % 6)
      const b = vertexId(hex, d)
      edgeVertices.set(e, [a, b])
      into(vertexEdges, a, e)
      into(vertexEdges, b, e)
      into(vertexVertices, a, b)
      into(vertexVertices, b, a)
    }
  }

  const toRecord = <V>(map: Map<string, Set<V>>): Record<string, readonly V[]> => {
    const out: Record<string, V[]> = {}
    for (const [k, set] of map) out[k] = [...set]
    return out
  }

  return {
    vertices: [...vertices],
    edges: [...edges],
    vertexHexes: toRecord(vertexHexes),
    vertexVertices: toRecord(vertexVertices),
    vertexEdges: toRecord(vertexEdges),
    edgeVertices: Object.fromEntries(edgeVertices) as Record<EdgeId, readonly [VertexId, VertexId]>,
    hexVertices,
  }
}

let memoizedStandard: Topology | null = null

/** Topology of the standard 19-hex board. Constant — built once. */
export function standardTopology(): Topology {
  if (!memoizedStandard) memoizedStandard = buildTopology(spiralCoords())
  return memoizedStandard
}

const RADIUS_BY_HEXES: Record<number, number> = { 19: 2, 37: 3 }
const memoByRadius = new Map<number, Topology>()

/** Topology for a board, inferred from its hex count. Memoized per radius. */
export function topologyFor(board: { hexes: readonly unknown[] }): Topology {
  const radius = RADIUS_BY_HEXES[board.hexes.length]
  if (radius === undefined) throw new Error(`unknown board size: ${board.hexes.length} hexes`)
  let topo = memoByRadius.get(radius)
  if (!topo) {
    topo = radius === 2 ? standardTopology() : buildTopology(spiralCoords(radius))
    memoByRadius.set(radius, topo)
  }
  return topo
}
