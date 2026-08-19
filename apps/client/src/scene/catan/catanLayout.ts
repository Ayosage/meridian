import {
  add,
  DIRECTIONS,
  spiralCoords,
  vertexId,
  edgeId,
  type EdgeId,
  type VertexId,
} from '@meridian/rules'
import { coordToWorld, TILE_SIZE } from '../layout'

export const TILE_TOP = 0.22

function centroid3(a: [number, number, number], b: typeof a, c: typeof a): [number, number, number] {
  return [(a[0] + b[0] + c[0]) / 3, TILE_TOP, (a[2] + b[2] + c[2]) / 3]
}

let vw: Map<VertexId, [number, number, number]> | null = null
let ew: Map<EdgeId, { pos: [number, number, number]; angle: number }> | null = null

/** World position of every board vertex (corner = centroid of the 3 meeting hex centers). */
export function vertexWorld(): ReadonlyMap<VertexId, [number, number, number]> {
  if (vw) return vw
  vw = new Map()
  for (const hex of spiralCoords()) {
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
  return vw
}

/** World midpoint + Y-rotation for every board edge (a +X-modeled road aligns via angle). */
export function edgeWorld(): ReadonlyMap<EdgeId, { pos: [number, number, number]; angle: number }> {
  if (ew) return ew
  ew = new Map()
  for (const hex of spiralCoords()) {
    for (let d = 0; d < 6; d++) {
      const id = edgeId(hex, d)
      if (ew.has(id)) continue
      const a = coordToWorld(hex, TILE_SIZE)
      const b = coordToWorld(add(hex, DIRECTIONS[d]!), TILE_SIZE)
      const angle = Math.atan2(b[2] - a[2], b[0] - a[0]) + Math.PI / 2
      ew.set(id, { pos: [(a[0] + b[0]) / 2, TILE_TOP, (a[2] + b[2]) / 2], angle })
    }
  }
  return ew
}
