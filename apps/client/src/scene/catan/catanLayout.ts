import {
  add,
  DIRECTIONS,
  vertexId,
  edgeId,
  type CatanBoard,
  type EdgeId,
  type Port,
  type VertexId,
} from '@meridian/rules'
import { coordToWorld, TILE_SIZE } from '../layout'

export const TILE_TOP = 0.22
/**
 * Ocean surface height — single source of truth shared by CatanScene.tsx
 * (the water mesh itself) and PortSign.tsx (which anchors its posts below
 * this line and its plaque above it). Kept here rather than in CatanScene
 * to avoid a CatanScene -> Pieces -> PortSign -> CatanScene import cycle.
 */
export const WATER_Y = 0.05

function centroid3(a: [number, number, number], b: typeof a, c: typeof a): [number, number, number] {
  return [(a[0] + b[0] + c[0]) / 3, TILE_TOP, (a[2] + b[2] + c[2]) / 3]
}

// Caches keyed by hex count — radius-2 and radius-3 boards can coexist across
// matches in one session, and every same-size board shares identical geometry.
const vwBySize = new Map<number, Map<VertexId, [number, number, number]>>()
const ewBySize = new Map<number, Map<EdgeId, { pos: [number, number, number]; angle: number }>>()

/** World position of every board vertex (corner = centroid of the 3 meeting hex centers). */
export function vertexWorld(hexes: CatanBoard['hexes']): ReadonlyMap<VertexId, [number, number, number]> {
  const cached = vwBySize.get(hexes.length)
  if (cached) return cached
  const vw = new Map<VertexId, [number, number, number]>()
  for (const { coord: hex } of hexes) {
    for (let c = 0; c < 6; c++) {
      const id = vertexId(hex, c)
      if (vw.has(id)) continue
      vw.set(
        id,
        centroid3(
          coordToWorld(hex, TILE_SIZE),
          coordToWorld(add(hex, DIRECTIONS[c]!), TILE_SIZE),
          coordToWorld(add(hex, DIRECTIONS[(c + 1) % 6]!), TILE_SIZE),
        ),
      )
    }
  }
  vwBySize.set(hexes.length, vw)
  return vw
}

/** World midpoint + Y-rotation for every board edge (a +X-modeled road aligns via angle). */
export function edgeWorld(hexes: CatanBoard['hexes']): ReadonlyMap<EdgeId, { pos: [number, number, number]; angle: number }> {
  const cached = ewBySize.get(hexes.length)
  if (cached) return cached
  const ew = new Map<EdgeId, { pos: [number, number, number]; angle: number }>()
  for (const { coord: hex } of hexes) {
    for (let d = 0; d < 6; d++) {
      const id = edgeId(hex, d)
      if (ew.has(id)) continue
      const a = coordToWorld(hex, TILE_SIZE)
      const b = coordToWorld(add(hex, DIRECTIONS[d]!), TILE_SIZE)
      // Y-rotation maps local +X to (cos a, -sin a) in XZ — atan2(x, z), not
      // atan2(z, x), turns the +X-modeled road perpendicular to the
      // center-to-center line, i.e. along the shared edge.
      const angle = Math.atan2(b[0] - a[0], b[2] - a[2])
      ew.set(id, { pos: [(a[0] + b[0]) / 2, TILE_TOP, (a[2] + b[2]) / 2], angle })
    }
  }
  ewBySize.set(hexes.length, ew)
  return ew
}

export interface PortPlacement {
  key: string
  position: [number, number, number]
  /** Unit vector from the board center (origin) outward through the port's two-vertex midpoint. */
  outX: number
  outZ: number
  kind: Port['kind']
}

/**
 * World placement for every board port: its two-vertex midpoint pushed
 * `push` units outward from the board center, at tile height. Shared by
 * the port boat (Pieces.tsx) and its rate sign (PortSign.tsx) so both read
 * off the same math — only `push` differs between them.
 */
export function portWorld(
  board: Pick<CatanBoard, 'ports'>,
  vw: ReadonlyMap<VertexId, [number, number, number]>,
  push: number,
): PortPlacement[] {
  const out: PortPlacement[] = []
  board.ports.forEach((port, i) => {
    const a = vw.get(port.vertices[0])
    const b = vw.get(port.vertices[1])
    if (!a || !b) return
    const midX = (a[0] + b[0]) / 2
    const midZ = (a[2] + b[2]) / 2
    const len = Math.hypot(midX, midZ) || 1
    const outX = midX / len
    const outZ = midZ / len
    out.push({
      key: `${port.vertices[0]}-${port.vertices[1]}-${i}`,
      position: [midX + outX * push, TILE_TOP, midZ + outZ * push],
      outX,
      outZ,
      kind: port.kind,
    })
  })
  return out
}

/**
 * Content equality for port lists. Snapshots re-mint the whole board object
 * (robber moves included) while its ports never change mid-match; Pieces.tsx
 * uses this to keep a stable ports reference so the boat/sign memos hold.
 */
export function portsEqual(a: CatanBoard['ports'], b: CatanBoard['ports']): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((p, i) => {
    const q = b[i]!
    return p.kind === q.kind && p.vertices[0] === q.vertices[0] && p.vertices[1] === q.vertices[1]
  })
}
