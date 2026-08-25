import { describe, expect, it } from 'vitest'
import { standardTopology, vertexId, edgeId, createCatanGame, createRng } from '@meridian/rules'
import { vertexWorld, edgeWorld, portWorld, TILE_TOP } from '../src/scene/catan/catanLayout'
import { coordToWorld } from '../src/scene/layout'

describe('catanLayout', () => {
  it('covers every topology vertex and edge exactly once', () => {
    const topo = standardTopology()
    const vw = vertexWorld()
    const ew = edgeWorld()
    expect(vw.size).toBe(topo.vertices.length) // 54
    expect(ew.size).toBe(topo.edges.length) // 72
    for (const v of topo.vertices) expect(vw.get(v)).toBeDefined()
    for (const e of topo.edges) expect(ew.get(e)).toBeDefined()
  })

  it('a corner is equidistant (= circumradius 1) from its owning hex center', () => {
    const vw = vertexWorld()
    const [cx, , cz] = coordToWorld({ q: 0, r: 0 })
    const corner = vw.get(vertexId({ q: 0, r: 0 }, 2))!
    const d = Math.hypot(corner[0] - cx, corner[2] - cz)
    expect(d).toBeCloseTo(1, 5)
  })

  it('an edge midpoint sits halfway between the two hex centers, angle perpendicular', () => {
    const ew = edgeWorld()
    const e = ew.get(edgeId({ q: 0, r: 0 }, 0))! // toward {q:1,r:0} — centers differ along +x
    const a = coordToWorld({ q: 0, r: 0 })
    const b = coordToWorld({ q: 1, r: 0 })
    expect(e.pos[0]).toBeCloseTo((a[0] + b[0]) / 2, 5)
    expect(e.pos[2]).toBeCloseTo((a[2] + b[2]) / 2, 5)
    // centers along +x → edge runs along z → +X-modeled road rotates 90°
    expect(Math.abs(Math.sin(e.angle))).toBeCloseTo(1, 5)
  })

  describe('portWorld', () => {
    const { board } = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
    const vw = vertexWorld()

    it('places one entry per port, pushed outward from the board center at the given distance', () => {
      const placements = portWorld(board, vw, 0.35)
      expect(placements.length).toBe(board.ports.length)
      for (const p of placements) {
        expect(p.position[1]).toBe(TILE_TOP)
        const midDist = Math.hypot(p.position[0] - p.outX * 0.35, p.position[2] - p.outZ * 0.35)
        expect(Math.hypot(p.position[0], p.position[2]) - midDist).toBeCloseTo(0.35, 5)
        // outX/outZ is the unit vector from the board center through the port
        expect(Math.hypot(p.outX, p.outZ)).toBeCloseTo(1, 5)
      }
    })

    it('carries each port\'s kind through unchanged', () => {
      const placements = portWorld(board, vw, 0.35)
      expect(placements.map((p) => p.kind)).toEqual(board.ports.map((p) => p.kind))
    })

    it('a larger push distance moves the sign farther from the board center', () => {
      const near = portWorld(board, vw, 0.35)
      const far = portWorld(board, vw, 0.9)
      for (let i = 0; i < near.length; i++) {
        const dNear = Math.hypot(near[i]!.position[0], near[i]!.position[2])
        const dFar = Math.hypot(far[i]!.position[0], far[i]!.position[2])
        expect(dFar).toBeGreaterThan(dNear)
      }
    })
  })

  it('rotating a +X-modeled road by edge.angle lays it along the edge, for all 6 directions', () => {
    // The edge (hex, d) spans vertices (hex, d) and (hex, (d+5)%6) — the two
    // corners whose centroid triples contain both hex and its d-neighbor.
    const vw = vertexWorld()
    const ew = edgeWorld()
    for (let d = 0; d < 6; d++) {
      const e = ew.get(edgeId({ q: 0, r: 0 }, d))!
      const va = vw.get(vertexId({ q: 0, r: 0 }, d))!
      const vb = vw.get(vertexId({ q: 0, r: 0 }, (d + 5) % 6))!
      // true edge line in the XZ plane
      const ex = vb[0] - va[0]
      const ez = vb[2] - va[2]
      // a three.js Y-rotation by angle maps local +X to (cos a, -sin a) in XZ
      const rx = Math.cos(e.angle)
      const rz = -Math.sin(e.angle)
      // parallel (either sense) ⇔ cross product ~ 0
      const cross = rx * ez - rz * ex
      expect(Math.abs(cross), `direction ${d}: road axis not parallel to edge`).toBeLessThan(1e-9)
    }
  })
})
