import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  buildTopology,
  edgeId,
  inRadius,
  spiralCoords,
  standardTopology,
  topologyFor,
  vertexId,
  type Coord,
} from '../../src/index'

const arbHex = fc.record({ q: fc.integer({ min: -2, max: 2 }), r: fc.integer({ min: -2, max: 2 }) })
const arbSide = fc.integer({ min: 0, max: 5 })

describe('spiralCoords', () => {
  it('enumerates 19 unique in-radius hexes, outer ring first, center last', () => {
    const coords = spiralCoords()
    expect(coords).toHaveLength(19)
    expect(new Set(coords.map((c) => `${c.q},${c.r}`)).size).toBe(19)
    for (const c of coords) expect(inRadius(c, 2)).toBe(true)
    expect(coords[0]).toEqual({ q: -2, r: 2 })
    expect(coords[18]).toEqual({ q: 0, r: 0 })
    for (let i = 0; i < 12; i++)
      expect(Math.max(Math.abs(coords[i]!.q), Math.abs(coords[i]!.r), Math.abs(coords[i]!.q + coords[i]!.r))).toBe(2)
    for (let i = 12; i < 18; i++)
      expect(Math.max(Math.abs(coords[i]!.q), Math.abs(coords[i]!.r), Math.abs(coords[i]!.q + coords[i]!.r))).toBe(1)
  })
})

describe('canonical ids', () => {
  it('the same vertex reached from different hexes has one id (property)', () => {
    fc.assert(
      fc.property(arbHex, arbSide, (hex: Coord, i: number) => {
        const id = vertexId(hex, i)
        const neighbor = { q: hex.q + [1, 1, 0, -1, -1, 0][i]!, r: hex.r + [0, -1, -1, 0, 1, 1][i]! }
        const fromNeighbor = [0, 1, 2, 3, 4, 5].map((c) => vertexId(neighbor, c))
        expect(fromNeighbor).toContain(id)
      }),
    )
  })

  it('the same edge reached from both sides has one id (property)', () => {
    fc.assert(
      fc.property(arbHex, arbSide, (hex: Coord, d: number) => {
        const neighbor = { q: hex.q + [1, 1, 0, -1, -1, 0][d]!, r: hex.r + [0, -1, -1, 0, 1, 1][d]! }
        const back = (d + 3) % 6
        expect(edgeId(hex, d)).toBe(edgeId(neighbor, back))
      }),
    )
  })
})

describe('standard board topology', () => {
  const topo = standardTopology()

  it('has the canonical Catan counts: 54 vertices, 72 edges', () => {
    expect(topo.vertices).toHaveLength(54)
    expect(topo.edges).toHaveLength(72)
  })

  it('every edge has exactly 2 endpoint vertices, mutually adjacent', () => {
    for (const e of topo.edges) {
      const [a, b] = topo.edgeVertices[e]!
      expect(a).not.toBe(b)
      expect(topo.vertexVertices[a]).toContain(b)
      expect(topo.vertexVertices[b]).toContain(a)
      expect(topo.vertexEdges[a]).toContain(e)
      expect(topo.vertexEdges[b]).toContain(e)
    }
  })

  it('every vertex touches 1-3 land hexes and 2-3 edges', () => {
    for (const v of topo.vertices) {
      expect(topo.vertexHexes[v]!.length).toBeGreaterThanOrEqual(1)
      expect(topo.vertexHexes[v]!.length).toBeLessThanOrEqual(3)
      expect(topo.vertexEdges[v]!.length).toBeGreaterThanOrEqual(2)
      expect(topo.vertexEdges[v]!.length).toBeLessThanOrEqual(3)
      expect(topo.vertexEdges[v]!.length).toBe(topo.vertexVertices[v]!.length)
    }
  })

  it('every hex exposes exactly 6 distinct corner vertices', () => {
    const keys = Object.keys(topo.hexVertices)
    expect(keys).toHaveLength(19)
    for (const k of keys) {
      expect(new Set(topo.hexVertices[k]!).size).toBe(6)
      for (const v of topo.hexVertices[k]!) expect(topo.vertexHexes[v]).toContain(k)
    }
  })

  it('handshake: sum of per-vertex edge degrees equals 2 x edges', () => {
    const degreeSum = topo.vertices.reduce((s, v) => s + topo.vertexEdges[v]!.length, 0)
    expect(degreeSum).toBe(2 * topo.edges.length)
  })

  it('buildTopology on an arbitrary connected hex set stays consistent (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbHex, { minLength: 1, maxLength: 10, selector: (c) => `${c.q},${c.r}` }),
        (hexes) => {
          const t = buildTopology(hexes)
          for (const e of t.edges) {
            const [a, b] = t.edgeVertices[e]!
            expect(t.vertexEdges[a]).toContain(e)
            expect(t.vertexEdges[b]).toContain(e)
          }
        },
      ),
    )
  })
})

describe('topologyFor', () => {
  it('infers radius from hex count and memoizes', () => {
    const r2 = topologyFor({ hexes: new Array(19) })
    expect(r2).toBe(standardTopology()) // same memo entry
    const r3 = topologyFor({ hexes: new Array(37) })
    expect(Object.keys(r3.hexVertices)).toHaveLength(37)
    expect(topologyFor({ hexes: new Array(37) })).toBe(r3)
    expect(() => topologyFor({ hexes: new Array(20) })).toThrow(/unknown board size/)
  })
})
