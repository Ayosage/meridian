# Catan Engine (packages/rules v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless, fully-tested Settlers of Catan rules engine (topology, immutable state, seeded-rng reducer, derived helpers) in `packages/rules/src/catan/`, implementing spec §2–§3.

**Architecture:** New `src/catan/` module family alongside the existing hex-tactics engine (which stays untouched). Pure TypeScript, no rendering or network deps. One immutable `CatanState` (secrets included — the server redacts later, phase 3), one reducer `applyCatanIntent(state, intent, rng) → CatanState | CatanRuleError`, injected seeded rng for dice/shuffles/steals, rules-as-data for layouts/costs/limits/deck, code for placement/production/award logic.

**Tech Stack:** TypeScript 5.6, Vitest 2, fast-check 3. No new dependencies. ESM, direct-src exports (no build step), matching the package's existing conventions.

**Spec:** `docs/superpowers/specs/2026-08-19-catan-pivot-design.md` (§2 rules contract, §3 engine architecture). Read it before starting any task.

## Global Constraints

- `packages/rules` stays pure: **no** render/network/node deps; only `zod` runtime dep already present (the Catan engine itself uses none — plain TS types; zod intent schemas live in `@meridian/protocol`, phase 3).
- All new source under `packages/rules/src/catan/`, all new tests under `packages/rules/test/catan/`. Existing hex-tactics modules are **not modified** (except the one-line root `src/index.ts` re-export in Task 1).
- Immutability: reducers never mutate input state; return fresh objects (house style, see `src/apply-intent.ts`).
- Rule errors use the house shape `{ error: true, code, message }` — the existing `isRuleError` guard in `src/intent.ts` must return true for them.
- Export names must not collide with existing root exports (`GameState`, `applyIntent`, `initialState`, `legalMoves`, `advanceTurn`, `ruleError`, …). All new public names are Catan-specific (`CatanState`, `applyCatanIntent`, `createCatanGame`, …).
- Determinism: **no** `Math.random()`/`Date.now()` anywhere in `src/catan/`. All randomness through the injected `Rng`.
- Rules-as-data (spec §3): board layout, token order, terrain pool, ports, costs, piece limits, deck composition, VP target live in `src/catan/data.ts`; logic is code.
- Test commands: full package `pnpm --filter @meridian/rules test`; single file `pnpm --filter @meridian/rules exec vitest run test/catan/<file>.test.ts`. Lint: `pnpm --filter @meridian/rules lint` (tsc --noEmit).
- Every task ends with the **whole** package suite green (old 58+ tests must keep passing) and a commit.
- Work on branch `worktree-catan-engine` in a worktree per `superpowers:using-git-worktrees` (house pattern: `.claude/worktrees/catan-engine`).

## File Map

| File | Responsibility | Task |
|---|---|---|
| `src/catan/rng.ts` | Seeded rng (mulberry32), rollD6, shuffle, pick | 1 |
| `src/catan/index.ts` | Catan barrel export (grows each task) | 1 |
| `src/index.ts` | +1 line: `export * from './catan'` | 1 |
| `src/catan/topology.ts` | Vertex/edge ids, adjacency index, spiral coords, standard topology | 2 |
| `src/catan/types.ts` | Resource/Terrain/DevCard types + resource math | 3 |
| `src/catan/data.ts` | Rules-as-data: layouts, tokens, ports, costs, limits, deck | 3 |
| `src/catan/board.ts` | Board generation (beginner + random), validation, port resolution | 3 |
| `src/catan/state.ts` | `CatanState` and friends | 4 |
| `src/catan/intent.ts` | `CatanIntent` union, `CatanRuleError`, `catanError` | 4 |
| `src/catan/create.ts` | `createCatanGame` | 4 |
| `src/catan/apply.ts` | Reducer shell + dispatch + setup phase + endTurn | 5 (grows 6–13) |
| `src/catan/production.ts` | Roll handling, production distribution, bank-shortage rule | 6 |
| `src/catan/robber.ts` | Discard-on-7, robber move, steal | 7 |
| `src/catan/build.ts` | Main-phase building | 8 |
| `src/catan/queries.ts` | Legal placements, affordability, port rates | 8, 9 |
| `src/catan/trade.ts` | Bank/port trade + player trade flow | 9, 10 |
| `src/catan/dev-cards.ts` | Buy + play dev cards | 11 |
| `src/catan/longest-road.ts` | Longest-road length + award holder update | 12 |
| `src/catan/score.ts` | Largest army, victory points, win check | 13 |
| `test/catan/helpers.ts` | stubRng, scripted setup, resource surgery | 5 |
| `test/catan/*.test.ts` | One test file per mechanic | 1–14 |

## Geometry Facts (used throughout — do not re-derive)

`spiralCoords()` (Task 2) enumerates the 19 land hexes: outer ring first starting at `(-2,2)` walking `DIRECTIONS[0..5]`, then inner ring from `(-1,1)`, center `(0,0)` last:

```
outer (indices 0-11): (-2,2) (-1,2) (0,2) (1,1) (2,0) (2,-1) (2,-2) (1,-2) (0,-2) (-1,-1) (-2,0) (-2,1)
inner (indices 12-17): (-1,1) (0,1) (1,0) (1,-1) (0,-1) (-1,0)
center (index 18): (0,0)
```

With `BEGINNER_TERRAIN` + `TOKEN_SPIRAL` (Task 3) this fixes the beginner board completely, e.g.: `(2,0)`=hills/8, `(-2,0)`=forest/8, `(0,2)`=forest/6, `(1,-1)`=forest/6, `(2,-2)`=hills/9, `(1,-2)`=fields/12, `(-2,2)`=mountains/5, `(-1,-1)`=mountains/4, `(0,0)`=desert/no token. The four red tokens (6/8) sit on pairwise non-adjacent hexes — `validateBoard` proves it in tests.

Corner `i` of a hex is where the edges toward `DIRECTIONS[i]` and `DIRECTIONS[i+1]` meet; edge `d` runs between corners `(d+5)%6` and `d`, so `edgeId(h, c)` always touches `vertexId(h, c)`.

---

### Task 1: Seeded RNG

**Files:**
- Create: `packages/rules/src/catan/rng.ts`
- Create: `packages/rules/src/catan/index.ts`
- Modify: `packages/rules/src/index.ts` (append one line)
- Test: `packages/rules/test/catan/rng.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface Rng { next(): number }` (uniform in `[0,1)`), `createRng(seed: number): Rng`, `rollD6(rng: Rng): number` (1–6), `shuffle<T>(rng: Rng, items: readonly T[]): T[]` (non-mutating Fisher–Yates), `pick<T>(rng: Rng, items: readonly T[]): T`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/rng.test.ts
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { createRng, pick, rollD6, shuffle } from '../../src/catan'

describe('seeded rng', () => {
  it('same seed produces the same sequence', () => {
    const a = createRng(42)
    const b = createRng(42)
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next())
  })

  it('different seeds diverge', () => {
    const a = createRng(1)
    const b = createRng(2)
    const as = Array.from({ length: 10 }, () => a.next())
    const bs = Array.from({ length: 10 }, () => b.next())
    expect(as).not.toEqual(bs)
  })

  it('next() stays in [0,1) (property)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rng = createRng(seed)
        for (let i = 0; i < 50; i++) {
          const v = rng.next()
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThan(1)
        }
      }),
    )
  })

  it('rollD6 covers 1..6 and nothing else', () => {
    const rng = createRng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) seen.add(rollD6(rng))
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('shuffle returns a permutation and does not mutate (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 30 }), fc.integer(), (arr, seed) => {
        const original = [...arr]
        const out = shuffle(createRng(seed), arr)
        expect(arr).toEqual(original)
        expect([...out].sort((x, y) => x - y)).toEqual([...arr].sort((x, y) => x - y))
      }),
    )
  })

  it('pick returns an element of the array', () => {
    const rng = createRng(3)
    for (let i = 0; i < 50; i++) expect(['a', 'b', 'c']).toContain(pick(rng, ['a', 'b', 'c']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/rng.test.ts`
Expected: FAIL — cannot resolve `../../src/catan`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rules/src/catan/rng.ts

/** Injected randomness (spec §3): dice, shuffles, and robber steals are reproducible. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
}

/** mulberry32 — tiny, deterministic, good enough for game randomness. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

export function rollD6(rng: Rng): number {
  return 1 + Math.floor(rng.next() * 6)
}

/** Non-mutating Fisher–Yates. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)]!
}
```

```ts
// packages/rules/src/catan/index.ts
export * from './rng'
```

Append to `packages/rules/src/index.ts` (after the existing lines):

```ts
export * from './catan'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: new rng tests PASS, all existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan packages/rules/src/index.ts packages/rules/test/catan
git commit -m "feat(rules): seeded rng for the catan engine"
```

---

### Task 2: Vertex/Edge Topology

**Files:**
- Create: `packages/rules/src/catan/topology.ts`
- Modify: `packages/rules/src/catan/index.ts` (add `export * from './topology'`)
- Test: `packages/rules/test/catan/topology.test.ts`

**Interfaces:**
- Consumes: `Coord`, `DIRECTIONS`, `add`, `coordKey` from `../coord`.
- Produces:
  - `type VertexId = string`, `type EdgeId = string` (canonical: sorted coordKeys of the touching hexes joined by `|`; off-board hexes participate in ids — they are just names).
  - `vertexId(hex: Coord, corner: number): VertexId` — corner `i` touches neighbors via `DIRECTIONS[i]` and `DIRECTIONS[(i+1)%6]`.
  - `edgeId(hex: Coord, dir: number): EdgeId`.
  - `spiralCoords(radius?: number): Coord[]` — 19 hexes for radius 2, outer ring first (starting `(-2,2)`), center last.
  - `interface Topology { vertices; edges; vertexHexes; vertexVertices; vertexEdges; edgeVertices; hexVertices }` (shapes below).
  - `buildTopology(hexes: readonly Coord[]): Topology`.
  - `standardTopology(): Topology` — memoized `buildTopology(spiralCoords())`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/topology.test.ts
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  buildTopology,
  edgeId,
  inRadius,
  spiralCoords,
  standardTopology,
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
    // outer 12 are on the rim, inner 6 at distance 1, then center
    for (let i = 0; i < 12; i++) expect(Math.max(Math.abs(coords[i]!.q), Math.abs(coords[i]!.r), Math.abs(coords[i]!.q + coords[i]!.r))).toBe(2)
    for (let i = 12; i < 18; i++) expect(Math.max(Math.abs(coords[i]!.q), Math.abs(coords[i]!.r), Math.abs(coords[i]!.q + coords[i]!.r))).toBe(1)
  })
})

describe('canonical ids', () => {
  it('the same vertex reached from different hexes has one id (property)', () => {
    // corner i of hex H is corner (i+2)%6... instead of deriving neighbor corner math,
    // assert via triples: vertex (H, i) is shared with hex H+DIRECTIONS[i]; some corner of that neighbor must produce the same id
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
      fc.property(fc.uniqueArray(arbHex, { minLength: 1, maxLength: 10, selector: (c) => `${c.q},${c.r}` }), (hexes) => {
        const t = buildTopology(hexes)
        for (const e of t.edges) {
          const [a, b] = t.edgeVertices[e]!
          expect(t.vertexEdges[a]).toContain(e)
          expect(t.vertexEdges[b]).toContain(e)
        }
      }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/topology.test.ts`
Expected: FAIL — `topology` module missing.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rules/src/catan/topology.ts
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
 * (starting at DIRECTIONS[4] * R, walking DIRECTIONS[0..5]), inward, center last.
 * Token placement (data.ts) relies on this exact order.
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
```

Add to `packages/rules/src/catan/index.ts`:

```ts
export * from './topology'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: all PASS (54/72 counts are the proof the canonicalization works).

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan packages/rules/test/catan
git commit -m "feat(rules): canonical vertex/edge topology for the catan board"
```

---

### Task 3: Resource Types, Rules Data, Board Generation

**Files:**
- Create: `packages/rules/src/catan/types.ts`
- Create: `packages/rules/src/catan/data.ts`
- Create: `packages/rules/src/catan/board.ts`
- Modify: `packages/rules/src/catan/index.ts` (add the three exports)
- Test: `packages/rules/test/catan/board.test.ts`

**Interfaces:**
- Consumes: `spiralCoords`, `vertexId`, `VertexId` from `./topology`; `Rng`, `shuffle` from `./rng`; `add`, `coordKey`, `neighbors`, `DIRECTIONS`, `Coord` from `../coord`.
- Produces:
  - types: `Resource` (`'wood'|'brick'|'sheep'|'wheat'|'ore'`), `RESOURCES`, `Terrain` (`'forest'|'hills'|'pasture'|'fields'|'mountains'|'desert'`), `TERRAIN_RESOURCE: Record<Terrain, Resource | null>`, `DevCard` (`'knight'|'vp'|'roadBuilding'|'yearOfPlenty'|'monopoly'`), `ResourceCount = Record<Resource, number>`, and resource math: `emptyResources(): ResourceCount`, `toResourceCount(p: Partial<ResourceCount>): ResourceCount`, `totalResources(p: Partial<ResourceCount>): number`, `hasResources(hand: ResourceCount, cost: Partial<ResourceCount>): boolean`, `addResources(a: ResourceCount, b: Partial<ResourceCount>): ResourceCount`, `subtractResources(a: ResourceCount, b: Partial<ResourceCount>): ResourceCount`.
  - data: `BOARD_RADIUS=2`, `BANK_PER_RESOURCE=19`, `VP_TARGET=10`, `DISCARD_THRESHOLD=7`, `MIN_LONGEST_ROAD=5`, `MIN_LARGEST_ARMY=3`, `PIECE_LIMITS={roads:15,settlements:5,cities:4}`, `COSTS` (road/settlement/city/devCard as `Partial<ResourceCount>`), `DEV_DECK_COMPOSITION`, `TOKEN_SPIRAL` (18 tokens), `TERRAIN_POOL` (19 terrains), `BEGINNER_TERRAIN` (19, spiral order), `PORT_SPECS`.
  - board: `interface HexTile { coord: Coord; terrain: Terrain; token: number | null }`, `interface Port { kind: 'generic' | Resource; vertices: readonly [VertexId, VertexId] }`, `interface CatanBoard { hexes: readonly HexTile[]; ports: readonly Port[]; robber: string }` (robber = coordKey of its hex), `generateBoard(rng: Rng, layout?: 'beginner' | 'random'): CatanBoard`, `validateBoard(hexes: readonly HexTile[]): string | null` (null = valid).

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/board.test.ts
import { describe, expect, it } from 'vitest'
import {
  BEGINNER_TERRAIN,
  createRng,
  generateBoard,
  TERRAIN_POOL,
  TOKEN_SPIRAL,
  totalResources,
  hasResources,
  addResources,
  subtractResources,
  emptyResources,
  validateBoard,
} from '../../src/catan'

describe('resource math', () => {
  it('total, has, add, subtract behave', () => {
    const hand = addResources(emptyResources(), { wood: 2, ore: 1 })
    expect(totalResources(hand)).toBe(3)
    expect(hasResources(hand, { wood: 2 })).toBe(true)
    expect(hasResources(hand, { wood: 3 })).toBe(false)
    expect(hasResources(hand, { brick: 1 })).toBe(false)
    const rest = subtractResources(hand, { wood: 1 })
    expect(rest.wood).toBe(1)
    expect(hand.wood).toBe(2) // no mutation
  })
})

describe('board data', () => {
  it('token and terrain pools have the official composition', () => {
    expect(TOKEN_SPIRAL).toHaveLength(18)
    expect([...TOKEN_SPIRAL].sort((a, b) => a - b)).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12])
    expect(TERRAIN_POOL).toHaveLength(19)
    expect(BEGINNER_TERRAIN).toHaveLength(19)
    const count = (arr: readonly string[], t: string) => arr.filter((x) => x === t).length
    for (const pool of [TERRAIN_POOL, BEGINNER_TERRAIN]) {
      expect(count(pool, 'forest')).toBe(4)
      expect(count(pool, 'pasture')).toBe(4)
      expect(count(pool, 'fields')).toBe(4)
      expect(count(pool, 'hills')).toBe(3)
      expect(count(pool, 'mountains')).toBe(3)
      expect(count(pool, 'desert')).toBe(1)
    }
  })
})

describe('generateBoard', () => {
  it('beginner board is valid, desert centered, robber on the desert', () => {
    const board = generateBoard(createRng(1), 'beginner')
    expect(board.hexes).toHaveLength(19)
    expect(validateBoard(board.hexes)).toBeNull()
    const desert = board.hexes.find((h) => h.terrain === 'desert')!
    expect(desert.coord).toEqual({ q: 0, r: 0 })
    expect(desert.token).toBeNull()
    expect(board.robber).toBe('0,0')
  })

  it('beginner board is deterministic regardless of rng', () => {
    const a = generateBoard(createRng(1), 'beginner')
    const b = generateBoard(createRng(999), 'beginner')
    expect(a.hexes).toEqual(b.hexes)
  })

  it('random boards are valid for many seeds and vary', () => {
    const boards = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => generateBoard(createRng(s), 'random'))
    for (const b of boards) expect(validateBoard(b.hexes)).toBeNull()
    const signatures = new Set(boards.map((b) => b.hexes.map((h) => h.terrain).join(',')))
    expect(signatures.size).toBeGreaterThan(1)
  })

  it('ports: 9 total, 4 generic + one per resource, 18 distinct vertices', () => {
    const board = generateBoard(createRng(1), 'beginner')
    expect(board.ports).toHaveLength(9)
    const kinds = board.ports.map((p) => p.kind)
    expect(kinds.filter((k) => k === 'generic')).toHaveLength(4)
    for (const r of ['wood', 'brick', 'sheep', 'wheat', 'ore']) expect(kinds).toContain(r)
    const verts = board.ports.flatMap((p) => p.vertices)
    expect(new Set(verts).size).toBe(18)
  })

  it('validateBoard rejects adjacent red tokens', () => {
    const board = generateBoard(createRng(1), 'beginner')
    // graft an 8 next to an existing 8 at (2,0): its neighbor (2,-1) currently holds 10
    const broken = board.hexes.map((h) => (h.coord.q === 2 && h.coord.r === -1 ? { ...h, token: 8 } : h))
    expect(validateBoard(broken)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/board.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rules/src/catan/types.ts

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
```

```ts
// packages/rules/src/catan/data.ts
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
```

```ts
// packages/rules/src/catan/board.ts
import { add, coordKey, DIRECTIONS, neighbors, type Coord } from '../coord'
import { PORT_SPECS, TERRAIN_POOL, TOKEN_SPIRAL, BEGINNER_TERRAIN } from './data'
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
```

Add to `packages/rules/src/catan/index.ts`:

```ts
export * from './types'
export * from './data'
export * from './board'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: all PASS. Note: if the 18-distinct-port-vertices assertion fails, the fix is data-tuning, not logic — adjust `seaEdgeOffset` values in `PORT_SPECS` until distinct (the offsets above were hand-verified against the spiral walk; suspect a walk-order regression first).

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan packages/rules/test/catan
git commit -m "feat(rules): catan board data, generation, and validation"
```

---

### Task 4: State, Intents, Errors, Game Creation

**Files:**
- Create: `packages/rules/src/catan/state.ts`
- Create: `packages/rules/src/catan/intent.ts`
- Create: `packages/rules/src/catan/create.ts`
- Modify: `packages/rules/src/catan/index.ts` (add the three exports)
- Test: `packages/rules/test/catan/create.test.ts`

**Interfaces:**
- Consumes: `CatanBoard`, `generateBoard` from `./board`; `DevCard`, `ResourceCount`, `Resource`, `emptyResources` from `./types`; data constants; `Rng`, `shuffle` from `./rng`; `VertexId`, `EdgeId` from `./topology`; `PlayerId` from `../state`; `Coord` from `../coord`.
- Produces (exact shapes — later tasks depend on every field name):

```ts
// state.ts
export type CatanPhase = 'setup' | 'preRoll' | 'discard' | 'robber' | 'main' | 'ended'
export interface Building { owner: PlayerId; kind: 'settlement' | 'city' }
export interface OwnedDevCard { card: DevCard; boughtOnTurn: number }
export interface CatanPlayer {
  resources: ResourceCount
  devCards: readonly OwnedDevCard[]
  knightsPlayed: number
  roadsLeft: number
  settlementsLeft: number
  citiesLeft: number
}
export type TradeResponse =
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'counter'; give: Partial<ResourceCount>; get: Partial<ResourceCount> }
export interface TradeOffer {
  give: Partial<ResourceCount>
  get: Partial<ResourceCount>
  responses: Readonly<Record<number, TradeResponse>>
}
export interface TurnState {
  current: PlayerId
  /** 0 during setup; 1 on the first real turn; +1 every endTurn. */
  number: number
  phase: CatanPhase
  dice: readonly [number, number] | null
  devPlayed: boolean
  setup: { expect: 'settlement' | 'road'; lastSettlement: VertexId | null } | null
  pendingDiscards: Readonly<Record<number, number>>
  robberReturn: 'preRoll' | 'main' | null
  openTrade: TradeOffer | null
}
export interface CatanState {
  seq: number
  playerCount: number
  board: CatanBoard
  players: readonly CatanPlayer[]
  buildings: Readonly<Record<VertexId, Building>>
  roads: Readonly<Record<EdgeId, PlayerId>>
  bank: ResourceCount
  /** Secret draw order; drawn from index 0. Server redacts (phase 3). */
  devDeck: readonly DevCard[]
  turn: TurnState
  awards: { longestRoad: PlayerId | null; largestArmy: PlayerId | null }
  winner: PlayerId | null
}
```

```ts
// intent.ts
export type CatanIntent =
  | { type: 'placeSetupSettlement'; player: PlayerId; vertex: VertexId }
  | { type: 'placeSetupRoad'; player: PlayerId; edge: EdgeId }
  | { type: 'rollDice'; player: PlayerId }
  | { type: 'discard'; player: PlayerId; resources: Partial<ResourceCount> }
  | { type: 'moveRobber'; player: PlayerId; hex: Coord; stealFrom: PlayerId | null }
  | { type: 'build'; player: PlayerId; piece: 'road' | 'settlement' | 'city'; location: string }
  | { type: 'buyDevCard'; player: PlayerId }
  | { type: 'playDevCard'; player: PlayerId; card: 'knight' }
  | { type: 'playDevCard'; player: PlayerId; card: 'roadBuilding'; edges: readonly EdgeId[] }
  | { type: 'playDevCard'; player: PlayerId; card: 'yearOfPlenty'; take: readonly [Resource, Resource] }
  | { type: 'playDevCard'; player: PlayerId; card: 'monopoly'; resource: Resource }
  | { type: 'offerTrade'; player: PlayerId; give: Partial<ResourceCount>; get: Partial<ResourceCount> }
  | { type: 'respondTrade'; player: PlayerId; response: 'accept' | 'reject' | { give: Partial<ResourceCount>; get: Partial<ResourceCount> } }
  | { type: 'confirmTrade'; player: PlayerId; partner: PlayerId }
  | { type: 'cancelTrade'; player: PlayerId }
  | { type: 'endTurn'; player: PlayerId }

export type CatanErrorCode =
  | 'GAME_OVER' | 'NOT_YOUR_TURN' | 'BAD_PHASE' | 'BAD_INTENT'
  | 'ILLEGAL_PLACEMENT' | 'NO_STOCK' | 'CANT_AFFORD' | 'BANK_SHORT'
  | 'DECK_EMPTY' | 'NO_CARD' | 'DEV_LIMIT'
  | 'BAD_DISCARD' | 'BAD_ROBBER' | 'BAD_STEAL'
  | 'NO_TRADE' | 'BAD_TRADE'

export interface CatanRuleError { error: true; code: CatanErrorCode; message: string }
export function catanError(code: CatanErrorCode, message: string): CatanRuleError
```

  - `create.ts`: `interface CatanGameOptions { playerCount: 3 | 4; layout?: 'beginner' | 'random' }`, `createCatanGame(options: CatanGameOptions, rng: Rng): CatanState`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/create.test.ts
import { describe, expect, it } from 'vitest'
import { createCatanGame, createRng, isRuleError, catanError, totalResources } from '../../src/index'

describe('createCatanGame', () => {
  it('builds a fresh 4-player game in the setup phase', () => {
    const state = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(1))
    expect(state.playerCount).toBe(4)
    expect(state.players).toHaveLength(4)
    expect(state.turn).toMatchObject({ current: 0, number: 0, phase: 'setup', dice: null, devPlayed: false })
    expect(state.turn.setup).toEqual({ expect: 'settlement', lastSettlement: null })
    expect(state.winner).toBeNull()
    expect(state.awards).toEqual({ longestRoad: null, largestArmy: null })
    expect(Object.keys(state.buildings)).toHaveLength(0)
    expect(Object.keys(state.roads)).toHaveLength(0)
  })

  it('stocks the bank, piece supplies, and the 25-card dev deck', () => {
    const state = createCatanGame({ playerCount: 3 }, createRng(2))
    expect(state.bank).toEqual({ wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 })
    expect(state.devDeck).toHaveLength(25)
    expect(state.devDeck.filter((c) => c === 'knight')).toHaveLength(14)
    expect(state.devDeck.filter((c) => c === 'vp')).toHaveLength(5)
    for (const p of state.players) {
      expect(p).toMatchObject({ knightsPlayed: 0, roadsLeft: 15, settlementsLeft: 5, citiesLeft: 4 })
      expect(totalResources(p.resources)).toBe(0)
      expect(p.devCards).toHaveLength(0)
    }
  })

  it('deck order is seeded: same seed same order, different seed different order', () => {
    const a = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(5))
    const b = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(5))
    const c = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(6))
    expect(a.devDeck).toEqual(b.devDeck)
    expect(a.devDeck).not.toEqual(c.devDeck)
  })

  it('catanError satisfies the house isRuleError guard', () => {
    const err = catanError('BAD_PHASE', 'nope')
    expect(isRuleError(err)).toBe(true)
    expect(err.code).toBe('BAD_PHASE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/create.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write the implementation**

Write `state.ts` and `intent.ts` exactly per the Interfaces block above (they are pure type modules plus `catanError`):

```ts
// packages/rules/src/catan/intent.ts — implementation part
export function catanError(code: CatanErrorCode, message: string): CatanRuleError {
  return { error: true, code, message }
}
```

(`state.ts` needs `import type { Coord } from '../coord'` only if referenced; it isn't — but `intent.ts` needs it for `moveRobber`. `state.ts` imports `PlayerId` from `'../state'`, `CatanBoard` from `'./board'`, `DevCard`/`ResourceCount` from `'./types'`, `VertexId`/`EdgeId` from `'./topology'`. Do not re-export `PlayerId` from the catan barrel — it is already exported at the root.)

```ts
// packages/rules/src/catan/create.ts
import type { PlayerId } from '../state'
import { generateBoard } from './board'
import { BANK_PER_RESOURCE, DEV_DECK_COMPOSITION, PIECE_LIMITS } from './data'
import { shuffle, type Rng } from './rng'
import type { CatanPlayer, CatanState } from './state'
import { emptyResources, type DevCard } from './types'

export interface CatanGameOptions {
  playerCount: 3 | 4
  layout?: 'beginner' | 'random'
}

export function createCatanGame(options: CatanGameOptions, rng: Rng): CatanState {
  const board = generateBoard(rng, options.layout ?? 'random')
  const deck = shuffle(
    rng,
    (Object.entries(DEV_DECK_COMPOSITION) as [DevCard, number][]).flatMap(([card, n]) =>
      Array.from({ length: n }, () => card),
    ),
  )
  const players: CatanPlayer[] = Array.from({ length: options.playerCount }, () => ({
    resources: emptyResources(),
    devCards: [],
    knightsPlayed: 0,
    roadsLeft: PIECE_LIMITS.roads,
    settlementsLeft: PIECE_LIMITS.settlements,
    citiesLeft: PIECE_LIMITS.cities,
  }))
  return {
    seq: 0,
    playerCount: options.playerCount,
    board,
    players,
    buildings: {},
    roads: {},
    bank: {
      wood: BANK_PER_RESOURCE,
      brick: BANK_PER_RESOURCE,
      sheep: BANK_PER_RESOURCE,
      wheat: BANK_PER_RESOURCE,
      ore: BANK_PER_RESOURCE,
    },
    devDeck: deck,
    turn: {
      current: 0 as PlayerId,
      number: 0,
      phase: 'setup',
      dice: null,
      devPlayed: false,
      setup: { expect: 'settlement', lastSettlement: null },
      pendingDiscards: {},
      robberReturn: null,
      openTrade: null,
    },
    awards: { longestRoad: null, largestArmy: null },
    winner: null,
  }
}
```

Add to `packages/rules/src/catan/index.ts`:

```ts
export * from './state'
export * from './intent'
export * from './create'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: all PASS. Also run `pnpm --filter @meridian/rules lint` — the barrel re-exports must not create duplicate-name conflicts with the root index.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan packages/rules/test/catan
git commit -m "feat(rules): catan state model, intent union, and game creation"
```

---

### Task 5: Reducer Shell, Setup Draft, endTurn

**Files:**
- Create: `packages/rules/src/catan/apply.ts`
- Create: `packages/rules/src/catan/placement.ts` (setup-phase placement rules)
- Modify: `packages/rules/src/catan/index.ts` (add `export * from './apply'`, `export * from './placement'`)
- Create: `packages/rules/test/catan/helpers.ts`
- Test: `packages/rules/test/catan/setup.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces:
  - `applyCatanIntent(state: CatanState, intent: CatanIntent, rng: Rng): CatanState | CatanRuleError` — the one public reducer. Bumps `seq` by exactly 1 on every success.
  - Internal per-intent handlers live in their own modules and are wired into `apply.ts`'s `dispatch` switch; unimplemented intents return `catanError('BAD_INTENT', 'not implemented yet')` until their task lands (Tasks 6–11 each replace one default with a real handler).
  - `placement.ts` exports (used by later tasks): `settlementDistanceOk(state: CatanState, vertex: VertexId): boolean` (vertex empty and no building on any adjacent vertex).
  - Test helpers (used by all later test files): `stubRng(values: number[]): Rng` (throws when exhausted), `die(k: number): number` (a `next()` value that makes `rollD6` produce k), `apply(state, intent, rng?)` (throws on RuleError), `expectError(state, intent, code, rng?)`, `SETUP_PLACEMENTS`, `setupComplete(): CatanState` (4 players, beginner board, full snake draft done, phase `preRoll`, P0 to act), `inMain(state?): CatanState` (forces a production-free roll of 3 to reach `main`), `withResources(state, player, resources): CatanState` (test surgery: moves resources from bank to a hand).

**The snake draft contract** (spec §2): P0..P3 place settlement+road, then P3..P0 again; the second settlement pays out its adjacent land hexes; after the 8th road the game enters `preRoll` with `turn.number = 1`, `current = 0`. Next-player formula after the r-th road overall (n players): `r < n → r`, `n ≤ r < 2n → 2n-1-r`, `r = 2n → setup over`.

- [ ] **Step 1: Write the test helpers** (not a test yet — but every test from here on uses them)

```ts
// packages/rules/test/catan/helpers.ts
import { expect } from 'vitest'
// import from the ROOT index: it re-exports the catan module plus isRuleError (which lives in src/intent.ts)
import {
  addResources,
  applyCatanIntent,
  createCatanGame,
  createRng,
  edgeId,
  isRuleError,
  subtractResources,
  vertexId,
  type CatanErrorCode,
  type CatanIntent,
  type CatanState,
  type ResourceCount,
  type Rng,
} from '../../src/index'

/** Deterministic rng from an explicit value list; throws when exhausted. */
export function stubRng(values: number[]): Rng {
  let i = 0
  return {
    next() {
      if (i >= values.length) throw new Error('stubRng exhausted')
      return values[i++]!
    },
  }
}

/** A next() value that makes rollD6 return k (1..6). */
export function die(k: number): number {
  return (k - 0.5) / 6
}

export function apply(state: CatanState, intent: CatanIntent, rng: Rng = createRng(0)): CatanState {
  const result = applyCatanIntent(state, intent, rng)
  if (isRuleError(result)) throw new Error(`unexpected ${result.code}: ${result.message} (intent ${intent.type})`)
  return result
}

export function expectError(
  state: CatanState,
  intent: CatanIntent,
  code: CatanErrorCode,
  rng: Rng = createRng(0),
): void {
  const result = applyCatanIntent(state, intent, rng)
  if (!isRuleError(result)) throw new Error(`expected ${code}, got success (intent ${intent.type})`)
  expect(result.code).toBe(code)
}

/**
 * A hand-verified legal snake draft on the beginner board. All settlements sit on
 * coastal corners far apart; each road is edge (hex, c) which touches vertex (hex, c).
 * Port facts (beginner board): P0 s1 on the 2:1 brick port, P2 s1 on the 2:1 wheat
 * port, P3 s1 and P1 s2 on 3:1 generic ports.
 * Second-settlement payouts: P3 +1 brick, P2 +1 ore, P1 +1 wheat, P0 +1 ore.
 */
export const SETUP_PLACEMENTS = [
  { player: 0, vertex: vertexId({ q: 2, r: 0 }, 0), edge: edgeId({ q: 2, r: 0 }, 0) },
  { player: 1, vertex: vertexId({ q: -2, r: 0 }, 3), edge: edgeId({ q: -2, r: 0 }, 3) },
  { player: 2, vertex: vertexId({ q: 0, r: -2 }, 1), edge: edgeId({ q: 0, r: -2 }, 1) },
  { player: 3, vertex: vertexId({ q: 0, r: 2 }, 4), edge: edgeId({ q: 0, r: 2 }, 4) },
  { player: 3, vertex: vertexId({ q: 2, r: -2 }, 0), edge: edgeId({ q: 2, r: -2 }, 0) },
  { player: 2, vertex: vertexId({ q: -2, r: 2 }, 4), edge: edgeId({ q: -2, r: 2 }, 4) },
  { player: 1, vertex: vertexId({ q: 1, r: -2 }, 1), edge: edgeId({ q: 1, r: -2 }, 1) },
  { player: 0, vertex: vertexId({ q: -1, r: -1 }, 2), edge: edgeId({ q: -1, r: -1 }, 2) },
] as const

export function setupComplete(): CatanState {
  let state = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
  for (const p of SETUP_PLACEMENTS) {
    state = apply(state, { type: 'placeSetupSettlement', player: p.player, vertex: p.vertex })
    state = apply(state, { type: 'placeSetupRoad', player: p.player, edge: p.edge })
  }
  return state
}

/** Roll a forced 3 (1+2): on this draft nobody produces, so we land cleanly in `main`. */
export function inMain(state: CatanState = setupComplete()): CatanState {
  return apply(state, { type: 'rollDice', player: state.turn.current }, stubRng([die(1), die(2)]))
}

/** Test surgery: hand a player resources out of the bank. */
export function withResources(
  state: CatanState,
  player: number,
  resources: Partial<ResourceCount>,
): CatanState {
  const players = state.players.map((p, i) =>
    i === player ? { ...p, resources: addResources(p.resources, resources) } : p,
  )
  return { ...state, players, bank: subtractResources(state.bank, resources) }
}
```

(Note: `inMain` will not work until Task 6 lands `rollDice` — Task 5's tests do not call it.)

- [ ] **Step 2: Write the failing setup tests**

```ts
// packages/rules/test/catan/setup.test.ts
import { describe, expect, it } from 'vitest'
import { createCatanGame, createRng, edgeId, totalResources, vertexId } from '../../src/catan'
import { apply, expectError, SETUP_PLACEMENTS, setupComplete } from './helpers'

const fresh = () => createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))

describe('setup draft', () => {
  it('walks the snake P0..P3 then P3..P0 and lands in preRoll turn 1', () => {
    let state = fresh()
    const expectedOrder = [0, 1, 2, 3, 3, 2, 1, 0]
    for (const [i, p] of SETUP_PLACEMENTS.entries()) {
      expect(state.turn.current).toBe(expectedOrder[i])
      expect(state.turn.setup?.expect).toBe('settlement')
      state = apply(state, { type: 'placeSetupSettlement', player: p.player, vertex: p.vertex })
      expect(state.turn.setup?.expect).toBe('road')
      state = apply(state, { type: 'placeSetupRoad', player: p.player, edge: p.edge })
    }
    expect(state.turn.phase).toBe('preRoll')
    expect(state.turn.number).toBe(1)
    expect(state.turn.current).toBe(0)
    expect(state.turn.setup).toBeNull()
    expect(Object.keys(state.buildings)).toHaveLength(8)
    expect(Object.keys(state.roads)).toHaveLength(8)
    for (const p of state.players) {
      expect(p.settlementsLeft).toBe(3)
      expect(p.roadsLeft).toBe(13)
    }
  })

  it('every successful intent bumps seq by exactly 1', () => {
    let state = fresh()
    const p = SETUP_PLACEMENTS[0]!
    const before = state.seq
    state = apply(state, { type: 'placeSetupSettlement', player: p.player, vertex: p.vertex })
    expect(state.seq).toBe(before + 1)
  })

  it('second settlements pay out their adjacent land hexes (beginner board facts)', () => {
    const state = setupComplete()
    expect(state.players[3]!.resources).toMatchObject({ brick: 1 })
    expect(state.players[2]!.resources).toMatchObject({ ore: 1 })
    expect(state.players[1]!.resources).toMatchObject({ wheat: 1 })
    expect(state.players[0]!.resources).toMatchObject({ ore: 1 })
    for (const p of state.players) expect(totalResources(p.resources)).toBe(1)
    expect(state.bank.ore).toBe(17)
  })

  it('rejects out-of-turn and out-of-phase intents', () => {
    const state = fresh()
    expectError(state, { type: 'placeSetupSettlement', player: 1, vertex: SETUP_PLACEMENTS[1]!.vertex }, 'NOT_YOUR_TURN')
    expectError(state, { type: 'endTurn', player: 0 }, 'BAD_PHASE')
    expectError(state, { type: 'placeSetupRoad', player: 0, edge: SETUP_PLACEMENTS[0]!.edge }, 'ILLEGAL_PLACEMENT')
  })

  it('enforces the distance rule during setup', () => {
    let state = fresh()
    const p0 = SETUP_PLACEMENTS[0]!
    state = apply(state, { type: 'placeSetupSettlement', player: 0, vertex: p0.vertex })
    state = apply(state, { type: 'placeSetupRoad', player: 0, edge: p0.edge })
    // vertex (2,0) corner 1 is adjacent to P0's settlement at (2,0) corner 0
    expectError(state, { type: 'placeSetupSettlement', player: 1, vertex: vertexId({ q: 2, r: 0 }, 1) }, 'ILLEGAL_PLACEMENT')
    // occupied vertex is also illegal
    expectError(state, { type: 'placeSetupSettlement', player: 1, vertex: p0.vertex }, 'ILLEGAL_PLACEMENT')
    // garbage vertex id
    expectError(state, { type: 'placeSetupSettlement', player: 1, vertex: 'nonsense' }, 'ILLEGAL_PLACEMENT')
  })

  it('setup road must touch the settlement just placed', () => {
    let state = fresh()
    const p0 = SETUP_PLACEMENTS[0]!
    state = apply(state, { type: 'placeSetupSettlement', player: 0, vertex: p0.vertex })
    // an edge elsewhere on the board does not touch (2,0) corner 0
    expectError(state, { type: 'placeSetupRoad', player: 0, edge: edgeId({ q: 0, r: 0 }, 0) }, 'ILLEGAL_PLACEMENT')
  })

  it('unwired gameplay intents fall through to BAD_INTENT for now', () => {
    // Tasks 6-11 replace these stubs; their own tests then assert BAD_PHASE during setup
    const state = fresh()
    expectError(state, { type: 'rollDice', player: 0 }, 'BAD_INTENT')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/setup.test.ts`
Expected: FAIL — `applyCatanIntent` does not exist.

- [ ] **Step 4: Write the implementation**

```ts
// packages/rules/src/catan/placement.ts
import type { CatanState } from './state'
import { standardTopology, type VertexId } from './topology'

/** Distance rule: the vertex is empty and no building sits on an adjacent vertex. */
export function settlementDistanceOk(state: CatanState, vertex: VertexId): boolean {
  const topo = standardTopology()
  if (state.buildings[vertex]) return false
  return (topo.vertexVertices[vertex] ?? []).every((n) => !state.buildings[n])
}
```

```ts
// packages/rules/src/catan/apply.ts
import { isRuleError } from '../intent'
import { catanError as err, type CatanIntent, type CatanRuleError } from './intent'
import type { Rng } from './rng'
import type { CatanState } from './state'
import { standardTopology } from './topology'
import { addResources, TERRAIN_RESOURCE, type Resource } from './types'
import { settlementDistanceOk } from './placement'
import { coordKey } from '../coord'

/**
 * Pure reducer (spec §3): returns a new state or a CatanRuleError; never mutates.
 * All randomness comes from the injected rng. Bumps seq by 1 on success.
 */
export function applyCatanIntent(
  state: CatanState,
  intent: CatanIntent,
  rng: Rng,
): CatanState | CatanRuleError {
  if (state.winner !== null || state.turn.phase === 'ended')
    return err('GAME_OVER', 'the match is already decided')
  const result = dispatch(state, intent, rng)
  if (isRuleError(result)) return result
  return { ...result, seq: state.seq + 1 }
}

function dispatch(state: CatanState, intent: CatanIntent, rng: Rng): CatanState | CatanRuleError {
  // intents that are legal off-turn dispatch before the turn guard
  if (intent.type === 'discard') return err('BAD_INTENT', 'not implemented yet') // Task 7
  if (intent.type === 'respondTrade') return err('BAD_INTENT', 'not implemented yet') // Task 10

  if (intent.player !== state.turn.current)
    return err('NOT_YOUR_TURN', `it is player ${state.turn.current}'s turn`)

  switch (intent.type) {
    case 'placeSetupSettlement':
      return applyPlaceSetupSettlement(state, intent.vertex)
    case 'placeSetupRoad':
      return applyPlaceSetupRoad(state, intent.edge)
    case 'endTurn':
      return applyEndTurn(state)
    default:
      return err('BAD_INTENT', 'not implemented yet') // replaced task by task (6-11)
  }
}

function applyPlaceSetupSettlement(state: CatanState, vertex: string): CatanState | CatanRuleError {
  const t = state.turn
  if (t.phase !== 'setup' || t.setup?.expect !== 'settlement')
    return t.phase !== 'setup'
      ? err('BAD_PHASE', 'setup is over')
      : err('ILLEGAL_PLACEMENT', 'place the road for your settlement first')
  const topo = standardTopology()
  if (!topo.vertexEdges[vertex]) return err('ILLEGAL_PLACEMENT', 'not a board vertex')
  if (!settlementDistanceOk(state, vertex))
    return err('ILLEGAL_PLACEMENT', 'settlements must be at least two edges apart')

  const isSecond =
    Object.values(state.buildings).filter((b) => b.owner === t.current).length === 1

  let players = state.players.map((p, i) =>
    i === t.current ? { ...p, settlementsLeft: p.settlementsLeft - 1 } : p,
  )
  let bank = state.bank
  if (isSecond) {
    // second settlement pays out its adjacent land hexes (spec §2)
    const byKey = new Map(state.board.hexes.map((h) => [coordKey(h.coord), h]))
    for (const hk of topo.vertexHexes[vertex] ?? []) {
      const res = TERRAIN_RESOURCE[byKey.get(hk)!.terrain]
      if (!res) continue
      const gain: Partial<Record<Resource, number>> = { [res]: 1 }
      players = players.map((p, i) => (i === t.current ? { ...p, resources: addResources(p.resources, gain) } : p))
      bank = { ...bank, [res]: bank[res] - 1 }
    }
  }

  return {
    ...state,
    players,
    bank,
    buildings: { ...state.buildings, [vertex]: { owner: t.current, kind: 'settlement' as const } },
    turn: { ...t, setup: { expect: 'road', lastSettlement: vertex } },
  }
}

function applyPlaceSetupRoad(state: CatanState, edge: string): CatanState | CatanRuleError {
  const t = state.turn
  if (t.phase !== 'setup') return err('BAD_PHASE', 'setup is over')
  if (t.setup?.expect !== 'road' || t.setup.lastSettlement === null)
    return err('ILLEGAL_PLACEMENT', 'place your settlement first')
  const topo = standardTopology()
  const endpoints = topo.edgeVertices[edge]
  if (!endpoints) return err('ILLEGAL_PLACEMENT', 'not a board edge')
  if (state.roads[edge] !== undefined) return err('ILLEGAL_PLACEMENT', 'edge already has a road')
  if (!endpoints.includes(t.setup.lastSettlement))
    return err('ILLEGAL_PLACEMENT', 'the setup road must touch the settlement you just placed')

  const players = state.players.map((p, i) =>
    i === t.current ? { ...p, roadsLeft: p.roadsLeft - 1 } : p,
  )
  const roads = { ...state.roads, [edge]: t.current }

  const n = state.playerCount
  const r = Object.keys(roads).length
  if (r === 2 * n) {
    // draft complete — the real game begins
    return {
      ...state,
      players,
      roads,
      turn: { ...t, current: 0, number: 1, phase: 'preRoll', setup: null },
    }
  }
  const next = r < n ? r : 2 * n - 1 - r
  return {
    ...state,
    players,
    roads,
    turn: { ...t, current: next, setup: { expect: 'settlement', lastSettlement: null } },
  }
}

function applyEndTurn(state: CatanState): CatanState | CatanRuleError {
  if (state.turn.phase !== 'main') return err('BAD_PHASE', 'you can only end your turn in the main phase')
  return {
    ...state,
    turn: {
      ...state.turn,
      current: (state.turn.current + 1) % state.playerCount,
      number: state.turn.number + 1,
      phase: 'preRoll',
      dice: null,
      devPlayed: false,
      robberReturn: null,
      openTrade: null,
    },
  }
}
```

(All errors go through `catanError` from `./intent`; `isRuleError` comes from `'../intent'` — the house guard works on both error families. The `standardTopology`/`addResources`/`TERRAIN_RESOURCE`/`settlementDistanceOk`/`coordKey` imports shown above are used by the setup handlers.)

Add to `packages/rules/src/catan/index.ts`:

```ts
export * from './placement'
export * from './apply'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: all PASS (helpers compile, setup suite green, older suites untouched).

- [ ] **Step 6: Commit**

```bash
git add packages/rules/src/catan packages/rules/test/catan
git commit -m "feat(rules): catan reducer shell, snake-draft setup, endTurn"
```

---

### Task 6: Dice Roll and Production (with the bank-shortage rule)

**Files:**
- Create: `packages/rules/src/catan/production.ts`
- Modify: `packages/rules/src/catan/apply.ts` (wire `rollDice` into the dispatch switch)
- Modify: `packages/rules/src/catan/index.ts` (add `export * from './production'`)
- Test: `packages/rules/test/catan/production.test.ts`

**Interfaces:**
- Consumes: state/types/topology from earlier tasks; `rollD6` from `./rng`; `DISCARD_THRESHOLD` from `./data`.
- Produces:
  - `distributeProduction(state: CatanState, roll: number): CatanState` — pure payout for a non-7 roll (exported for tests and later reuse).
  - `applyRoll(state: CatanState, rng: Rng): CatanState | CatanRuleError` — handles the `rollDice` intent: records `dice`, routes 7 to discard/robber, otherwise pays out and enters `main`. Wired in `apply.ts` as `case 'rollDice': return applyRoll(state, rng)`.

**Beginner-board facts used by the tests** (from the Geometry Facts section + SETUP_PLACEMENTS): roll 8 → P0 +1 brick (hills `(2,0)`), P1 +1 wood (forest `(-2,0)`); roll 6 → P3 +1 wood (forest `(0,2)`); roll 3 → nobody; roll 9 → P3 +1 brick (hills `(2,-2)`); roll 12 → P1 +1 wheat (fields `(1,-2)`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/production.test.ts
import { describe, expect, it } from 'vitest'
import { createCatanGame, createRng, distributeProduction, vertexId } from '../../src/catan'
import { apply, die, expectError, setupComplete, stubRng, withResources } from './helpers'

describe('rollDice', () => {
  it('records the dice, pays production, and enters main', () => {
    const state = setupComplete()
    const after = apply(state, { type: 'rollDice', player: 0 }, stubRng([die(3), die(5)])) // 8
    expect(after.turn.dice).toEqual([3, 5])
    expect(after.turn.phase).toBe('main')
    expect(after.players[0]!.resources.brick).toBe(1) // hills (2,0)
    expect(after.players[1]!.resources.wood).toBe(1) // forest (-2,0)
    expect(after.players[2]!.resources.wood).toBe(0)
    expect(after.players[3]!.resources.wood).toBe(0)
  })

  it('can only be rolled once, by the current player, in preRoll', () => {
    const state = setupComplete()
    expectError(state, { type: 'rollDice', player: 1 }, 'NOT_YOUR_TURN', stubRng([die(1), die(1)]))
    const rolled = apply(state, { type: 'rollDice', player: 0 }, stubRng([die(1), die(2)]))
    expectError(rolled, { type: 'rollDice', player: 0 }, 'BAD_PHASE', stubRng([die(1), die(1)]))
    // replaces the Task-5 BAD_INTENT expectation: rolling during setup is now BAD_PHASE
    const inSetup = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
    expectError(inSetup, { type: 'rollDice', player: 0 }, 'BAD_PHASE', stubRng([die(1), die(1)]))
  })

  it('a robbed hex produces nothing', () => {
    const state = setupComplete()
    const robbed = { ...state, board: { ...state.board, robber: '2,0' } }
    const after = apply(robbed, { type: 'rollDice', player: 0 }, stubRng([die(3), die(5)])) // 8
    expect(after.players[0]!.resources.brick).toBe(0) // hills (2,0) is robbed
    expect(after.players[1]!.resources.wood).toBe(1) // forest (-2,0) still pays
  })
})

describe('distributeProduction', () => {
  it('cities pay double', () => {
    const base = setupComplete()
    const vertex = Object.keys(base.buildings).find((v) => base.buildings[v]!.owner === 0 && v.includes('2,0'))!
    const withCity = { ...base, buildings: { ...base.buildings, [vertex]: { owner: 0, kind: 'city' as const } } }
    const after = distributeProduction(withCity, 8)
    expect(after.players[0]!.resources.brick).toBe(2)
    expect(after.bank.brick).toBe(base.bank.brick - 2)
  })

  it('bank shortage, multiple claimants: nobody gets that resource', () => {
    const base = setupComplete()
    // both 8-hexes pay different resources; create a two-claimant brick shortage instead:
    // give P1 a settlement on the same hills hex (2,0) as P0 — corner 3 is far from
    // corner 0 (non-adjacent), then drain the bank to 1 brick.
    const v = vertexId({ q: 2, r: 0 }, 3)
    const state = {
      ...base,
      buildings: { ...base.buildings, [v]: { owner: 1, kind: 'settlement' as const } },
      bank: { ...base.bank, brick: 1 },
    }
    const after = distributeProduction(state, 8)
    expect(after.players[0]!.resources.brick).toBe(0)
    expect(after.players[1]!.resources.brick).toBe(0)
    expect(after.bank.brick).toBe(1) // untouched
    expect(after.players[1]!.resources.wood).toBe(1) // unaffected resource still pays
  })

  it('bank shortage, single claimant: they take what remains', () => {
    const base = setupComplete()
    const vertex = Object.keys(base.buildings).find((v) => base.buildings[v]!.owner === 0 && v.includes('2,0'))!
    const withCity = { ...base, buildings: { ...base.buildings, [vertex]: { owner: 0, kind: 'city' as const } } }
    const state = { ...withCity, bank: { ...withCity.bank, brick: 1 } }
    const after = distributeProduction(state, 8) // city demands 2, bank has 1
    expect(after.players[0]!.resources.brick).toBe(1)
    expect(after.bank.brick).toBe(0)
  })

  it('resource conservation: bank + hands is invariant', () => {
    const state = setupComplete()
    const before = state.bank.brick + state.players.reduce((s, p) => s + p.resources.brick, 0)
    const after = distributeProduction(state, 8)
    expect(after.bank.brick + after.players.reduce((s, p) => s + p.resources.brick, 0)).toBe(before)
  })
})
```


- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/production.test.ts`
Expected: FAIL — `distributeProduction` missing, `rollDice` returns BAD_INTENT.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rules/src/catan/production.ts
import { coordKey } from '../coord'
import { DISCARD_THRESHOLD } from './data'
import { catanError as err } from './intent'
import type { CatanRuleError } from './intent'
import { rollD6, type Rng } from './rng'
import type { CatanState } from './state'
import { standardTopology } from './topology'
import {
  addResources,
  emptyResources,
  RESOURCES,
  TERRAIN_RESOURCE,
  totalResources,
  type ResourceCount,
} from './types'

/**
 * Payout for a non-7 roll. Bank-shortage rule (spec §2): if the bank cannot
 * cover a resource and MORE THAN ONE player claims it, nobody gets it; a single
 * claimant takes what remains.
 */
export function distributeProduction(state: CatanState, roll: number): CatanState {
  const topo = standardTopology()
  const gains: ResourceCount[] = state.players.map(() => emptyResources())

  for (const hex of state.board.hexes) {
    if (hex.token !== roll) continue
    const key = coordKey(hex.coord)
    if (key === state.board.robber) continue
    const res = TERRAIN_RESOURCE[hex.terrain]
    if (!res) continue
    for (const v of topo.hexVertices[key] ?? []) {
      const b = state.buildings[v]
      if (b) gains[b.owner]![res] += b.kind === 'city' ? 2 : 1
    }
  }

  const bank = { ...state.bank }
  for (const res of RESOURCES) {
    const total = gains.reduce((s, g) => s + g[res], 0)
    if (total === 0) continue
    if (total > bank[res]) {
      const claimants = gains.filter((g) => g[res] > 0)
      if (claimants.length > 1) {
        for (const g of gains) g[res] = 0
        continue
      }
      claimants[0]![res] = bank[res]
    }
    bank[res] -= gains.reduce((s, g) => s + g[res], 0)
  }

  const players = state.players.map((p, i) => ({ ...p, resources: addResources(p.resources, gains[i]!) }))
  return { ...state, players, bank }
}

/** The rollDice intent: roll 2d6, record them, route 7s, pay production. */
export function applyRoll(state: CatanState, rng: Rng): CatanState | CatanRuleError {
  if (state.turn.phase !== 'preRoll') return err('BAD_PHASE', 'dice were already rolled this turn')
  const dice: [number, number] = [rollD6(rng), rollD6(rng)]
  const roll = dice[0] + dice[1]

  if (roll === 7) {
    const pendingDiscards: Record<number, number> = {}
    state.players.forEach((p, i) => {
      const total = totalResources(p.resources)
      if (total > DISCARD_THRESHOLD) pendingDiscards[i] = Math.floor(total / 2)
    })
    const anyDiscards = Object.keys(pendingDiscards).length > 0
    return {
      ...state,
      turn: {
        ...state.turn,
        dice,
        phase: anyDiscards ? 'discard' : 'robber',
        pendingDiscards,
        robberReturn: 'main',
      },
    }
  }

  const produced = distributeProduction(state, roll)
  return { ...produced, turn: { ...produced.turn, dice, phase: 'main' } }
}
```

In `apply.ts`'s `dispatch` switch, add above `default`:

```ts
    case 'rollDice':
      return applyRoll(state, rng)
```

with `import { applyRoll } from './production'` at the top. Add `export * from './production'` to the catan barrel.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: all PASS (including a now-working `inMain` helper for later tasks).

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan packages/rules/test/catan
git commit -m "feat(rules): dice roll and production with the bank-shortage rule"
```

---

### Task 7: Rolling a 7 — Discards, Robber Move, Steal

**Files:**
- Create: `packages/rules/src/catan/robber.ts`
- Modify: `packages/rules/src/catan/apply.ts` (wire `discard` and `moveRobber`)
- Modify: `packages/rules/src/catan/index.ts` (add `export * from './robber'`)
- Test: `packages/rules/test/catan/robber.test.ts`

**Interfaces:**
- Consumes: state/types/topology, `pick` from `./rng`, `catanError`.
- Produces:
  - `applyDiscard(state: CatanState, intent: { player: PlayerId; resources: Partial<ResourceCount> }): CatanState | CatanRuleError` — legal for ANY player listed in `pendingDiscards` (wired in `dispatch` BEFORE the turn guard, replacing the Task-5 stub).
  - `applyMoveRobber(state: CatanState, intent: { player: PlayerId; hex: Coord; stealFrom: PlayerId | null }, rng: Rng): CatanState | CatanRuleError` — wired in the main switch (`case 'moveRobber': return applyMoveRobber(state, intent, rng)`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/robber.test.ts
import { describe, expect, it } from 'vitest'
import { totalResources } from '../../src/catan'
import { apply, die, expectError, setupComplete, stubRng, withResources } from './helpers'

/** Roll a 7 as P0 on a fresh post-setup board. */
function rollSeven(state = setupComplete()) {
  return apply(state, { type: 'rollDice', player: 0 }, stubRng([die(3), die(4)]))
}

describe('rolling a 7', () => {
  it('with nobody over 7 cards: straight to the robber phase', () => {
    const state = rollSeven()
    expect(state.turn.phase).toBe('robber')
    expect(state.turn.robberReturn).toBe('main')
    expect(state.turn.pendingDiscards).toEqual({})
  })

  it('players over 7 cards must discard half, rounded down, simultaneously', () => {
    let state = setupComplete()
    state = withResources(state, 1, { wood: 8 }) // P1: 9 cards total -> discards 4
    state = withResources(state, 2, { ore: 7 }) // P2: 8 cards -> discards 4
    state = rollSeven(state)
    expect(state.turn.phase).toBe('discard')
    expect(state.turn.pendingDiscards).toEqual({ 1: 4, 2: 4 })

    // discard is legal off-turn, in any order; exact count and real cards enforced
    expectError(state, { type: 'discard', player: 1, resources: { wood: 3 } }, 'BAD_DISCARD')
    expectError(state, { type: 'discard', player: 1, resources: { brick: 4 } }, 'BAD_DISCARD')
    expectError(state, { type: 'discard', player: 0, resources: {} }, 'BAD_DISCARD') // owes nothing

    const bankWood = state.bank.wood
    state = apply(state, { type: 'discard', player: 2, resources: { ore: 4 } })
    expect(state.turn.phase).toBe('discard') // P1 still owes
    state = apply(state, { type: 'discard', player: 1, resources: { wood: 4 } })
    expect(state.turn.phase).toBe('robber')
    expect(state.bank.wood).toBe(bankWood + 4)
    expect(totalResources(state.players[1]!.resources)).toBe(5)
  })
})

describe('moving the robber', () => {
  it('must move to a different board hex', () => {
    const state = rollSeven()
    expectError(state, { type: 'moveRobber', player: 0, hex: { q: 0, r: 0 }, stealFrom: null }, 'BAD_ROBBER')
    expectError(state, { type: 'moveRobber', player: 0, hex: { q: 9, r: 9 }, stealFrom: null }, 'BAD_ROBBER')
  })

  it('steals one random card from a player with a building on the hex', () => {
    let state = setupComplete()
    state = withResources(state, 1, { wood: 2 }) // P1 now holds wood 2 + wheat 1 (setup payout)
    state = rollSeven(state)
    // P1 has a settlement on forest (-2,0) (corner 3). Steal from P1 there.
    // stubRng value 0.9 -> picks the last card of P1's flattened hand [wood, wood, wheat] -> wheat
    const after = apply(
      state,
      { type: 'moveRobber', player: 0, hex: { q: -2, r: 0 }, stealFrom: 1 },
      stubRng([0.9]),
    )
    expect(after.board.robber).toBe('-2,0')
    expect(after.turn.phase).toBe('main')
    expect(totalResources(after.players[1]!.resources)).toBe(2)
    expect(totalResources(after.players[0]!.resources)).toBe(2) // 1 setup ore + 1 stolen
    expect(after.players[0]!.resources.wheat + after.players[0]!.resources.wood).toBe(1)
  })

  it('cannot steal from a player without a building there, or when naming nobody while victims exist', () => {
    let state = setupComplete()
    state = withResources(state, 1, { wood: 1 })
    state = rollSeven(state)
    expectError(state, { type: 'moveRobber', player: 0, hex: { q: -2, r: 0 }, stealFrom: 2 }, 'BAD_STEAL')
    expectError(state, { type: 'moveRobber', player: 0, hex: { q: -2, r: 0 }, stealFrom: null }, 'BAD_STEAL')
  })

  it('a hex with only broke players allows stealFrom: null', () => {
    let state = setupComplete()
    // P1 holds exactly 1 wheat from setup; strip it into P0's hand via a trade-free surgery:
    const players = state.players.map((p, i) =>
      i === 1 ? { ...p, resources: { ...p.resources, wheat: 0 } } : p,
    )
    const bank = { ...state.bank, wheat: state.bank.wheat + 1 }
    state = rollSeven({ ...state, players, bank })
    const after = apply(state, { type: 'moveRobber', player: 0, hex: { q: -2, r: 0 }, stealFrom: null })
    expect(after.board.robber).toBe('-2,0')
    expect(after.turn.phase).toBe('main')
  })

  it('robber cannot move outside the robber phase', () => {
    const state = setupComplete()
    expectError(state, { type: 'moveRobber', player: 0, hex: { q: 1, r: 0 }, stealFrom: null }, 'BAD_PHASE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/robber.test.ts`
Expected: FAIL — discard/moveRobber return BAD_INTENT.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rules/src/catan/robber.ts
import { coordKey, type Coord } from '../coord'
import type { PlayerId } from '../state'
import { catanError as err, type CatanRuleError } from './intent'
import { pick, type Rng } from './rng'
import type { CatanState } from './state'
import { standardTopology } from './topology'
import {
  addResources,
  hasResources,
  RESOURCES,
  subtractResources,
  totalResources,
  type Resource,
  type ResourceCount,
} from './types'

export function applyDiscard(
  state: CatanState,
  intent: { player: PlayerId; resources: Partial<ResourceCount> },
): CatanState | CatanRuleError {
  if (state.turn.phase !== 'discard') return err('BAD_PHASE', 'no discards are pending')
  const owed = state.turn.pendingDiscards[intent.player]
  if (!owed) return err('BAD_DISCARD', 'you have nothing to discard')
  if (totalResources(intent.resources) !== owed)
    return err('BAD_DISCARD', `you must discard exactly ${owed} cards`)
  const hand = state.players[intent.player]!.resources
  if (!hasResources(hand, intent.resources)) return err('BAD_DISCARD', 'you do not hold those cards')

  const players = state.players.map((p, i) =>
    i === intent.player ? { ...p, resources: subtractResources(p.resources, intent.resources) } : p,
  )
  const pendingDiscards: Record<number, number> = { ...state.turn.pendingDiscards }
  delete pendingDiscards[intent.player]
  const done = Object.keys(pendingDiscards).length === 0
  return {
    ...state,
    players,
    bank: addResources(state.bank, intent.resources),
    turn: { ...state.turn, pendingDiscards, phase: done ? 'robber' : 'discard' },
  }
}

export function applyMoveRobber(
  state: CatanState,
  intent: { player: PlayerId; hex: Coord; stealFrom: PlayerId | null },
  rng: Rng,
): CatanState | CatanRuleError {
  if (state.turn.phase !== 'robber') return err('BAD_PHASE', 'the robber does not move now')
  const key = coordKey(intent.hex)
  if (!state.board.hexes.some((h) => coordKey(h.coord) === key))
    return err('BAD_ROBBER', `${key} is not a board hex`)
  if (key === state.board.robber) return err('BAD_ROBBER', 'the robber must move to a new hex')

  const topo = standardTopology()
  const victims = state.players
    .map((_, i) => i)
    .filter(
      (i) =>
        i !== intent.player &&
        totalResources(state.players[i]!.resources) > 0 &&
        (topo.hexVertices[key] ?? []).some((v) => state.buildings[v]?.owner === i),
    )

  let players = state.players
  if (intent.stealFrom === null) {
    if (victims.length > 0) return err('BAD_STEAL', 'you must steal from an adjacent player')
  } else {
    if (!victims.includes(intent.stealFrom))
      return err('BAD_STEAL', `player ${intent.stealFrom} cannot be robbed on that hex`)
    const hand = state.players[intent.stealFrom]!.resources
    const cards = RESOURCES.flatMap((r) => Array.from({ length: hand[r] }, () => r))
    const stolen = pick(rng, cards)
    const delta = { [stolen]: 1 } as Partial<ResourceCount>
    players = state.players.map((p, i) => {
      if (i === intent.stealFrom) return { ...p, resources: subtractResources(p.resources, delta) }
      if (i === intent.player) return { ...p, resources: addResources(p.resources, delta) }
      return p
    })
  }

  return {
    ...state,
    players,
    board: { ...state.board, robber: key },
    turn: { ...state.turn, phase: state.turn.robberReturn ?? 'main', robberReturn: null },
  }
}
```

In `apply.ts`'s `dispatch`, replace the Task-5 `discard` stub line with:

```ts
  if (intent.type === 'discard') return applyDiscard(state, intent)
```

and add to the main switch:

```ts
    case 'moveRobber':
      return applyMoveRobber(state, intent, rng)
```

with `import { applyDiscard, applyMoveRobber } from './robber'`. Add `export * from './robber'` to the barrel.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan packages/rules/test/catan
git commit -m "feat(rules): seven flow — simultaneous discards, robber move, random steal"
```

---

### Task 8: Main-Phase Building + Legal-Placement Queries

**Files:**
- Create: `packages/rules/src/catan/queries.ts`
- Create: `packages/rules/src/catan/build.ts`
- Modify: `packages/rules/src/catan/apply.ts` (wire `build`)
- Modify: `packages/rules/src/catan/index.ts` (add both exports)
- Test: `packages/rules/test/catan/build.test.ts`

**Interfaces:**
- Consumes: everything prior; `settlementDistanceOk` from `./placement`; `COSTS` from `./data`.
- Produces (queries are the client's highlighting API, spec §3 "derived helpers"):
  - `legalRoadEdges(state: CatanState, player: PlayerId): EdgeId[]` — vacant edges connected to the player's network: an endpoint holds their building, or an adjacent edge holds their road AND the shared vertex is not another player's building (roads cannot pass through opponents).
  - `legalSettlementVertices(state: CatanState, player: PlayerId, opts?: { setup?: boolean }): VertexId[]` — distance rule always; own-road connection unless `setup`.
  - `legalCityVertices(state: CatanState, player: PlayerId): VertexId[]` — the player's own settlements.
  - `affordable(state: CatanState, player: PlayerId): Record<'road' | 'settlement' | 'city' | 'devCard', boolean>`.
  - `applyBuild(state, intent: { player; piece: 'road' | 'settlement' | 'city'; location: string }): CatanState | CatanRuleError` (build.ts), wired as `case 'build': return applyBuild(state, intent)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/build.test.ts
import { describe, expect, it } from 'vitest'
import {
  edgeId,
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  standardTopology,
  vertexId,
  affordable,
} from '../../src/catan'
import { apply, expectError, inMain, SETUP_PLACEMENTS, withResources } from './helpers'

const ROAD_COST = { brick: 1, wood: 1 }
const SETTLEMENT_COST = { brick: 1, wood: 1, wheat: 1, sheep: 1 }
const CITY_COST = { ore: 3, wheat: 2 }

describe('build road', () => {
  it('extends the network, pays the bank, decrements stock', () => {
    let state = withResources(inMain(), 0, ROAD_COST)
    // P0's setup road is edge (2,0) dir 0, between corners 5 and 0. Extend from corner 5 via edge dir 5.
    const next = edgeId({ q: 2, r: 0 }, 5)
    const bankBrick = state.bank.brick
    state = apply(state, { type: 'build', player: 0, piece: 'road', location: next })
    expect(state.roads[next]).toBe(0)
    expect(state.players[0]!.roadsLeft).toBe(12)
    expect(state.players[0]!.resources.brick).toBe(0)
    expect(state.bank.brick).toBe(bankBrick + 1)
  })

  it('rejects disconnected, occupied, off-board, unaffordable, and wrong-phase builds', () => {
    const disconnected = edgeId({ q: 0, r: 0 }, 0)
    let state = inMain()
    expectError(state, { type: 'build', player: 0, piece: 'road', location: disconnected }, 'CANT_AFFORD')
    state = withResources(state, 0, ROAD_COST)
    expectError(state, { type: 'build', player: 0, piece: 'road', location: disconnected }, 'ILLEGAL_PLACEMENT')
    expectError(state, { type: 'build', player: 0, piece: 'road', location: SETUP_PLACEMENTS[0]!.edge }, 'ILLEGAL_PLACEMENT')
    expectError(state, { type: 'build', player: 0, piece: 'road', location: 'nonsense' }, 'ILLEGAL_PLACEMENT')
    expectError(state, { type: 'build', player: 1, piece: 'road', location: disconnected }, 'NOT_YOUR_TURN')
  })

  it('legalRoadEdges matches what applyBuild accepts', () => {
    const state = withResources(inMain(), 0, { brick: 5, wood: 5 })
    const legal = legalRoadEdges(state, 0)
    expect(legal.length).toBeGreaterThan(0)
    for (const e of legal) {
      apply(state, { type: 'build', player: 0, piece: 'road', location: e }) // must not throw
    }
    const topo = standardTopology()
    const illegal = topo.edges.filter((e) => !legal.includes(e))
    expect(illegal.length + legal.length).toBe(72)
  })
})

describe('build settlement', () => {
  it('requires connection to own roads and the distance rule', () => {
    let state = withResources(inMain(), 0, { brick: 3, wood: 3, wheat: 2, sheep: 2 })
    // build two roads from P0's setup road at (2,0): dir 5 then dir 4, reaching corner 4
    state = apply(state, { type: 'build', player: 0, piece: 'road', location: edgeId({ q: 2, r: 0 }, 5) })
    state = apply(state, { type: 'build', player: 0, piece: 'road', location: edgeId({ q: 2, r: 0 }, 4) })
    const spot = vertexId({ q: 2, r: 0 }, 4) // two edges from the settlement at corner 0 -> distance ok
    expect(legalSettlementVertices(state, 0)).toContain(spot)
    const before = state.players[0]!.settlementsLeft
    state = apply(state, { type: 'build', player: 0, piece: 'settlement', location: spot })
    expect(state.buildings[spot]).toEqual({ owner: 0, kind: 'settlement' })
    expect(state.players[0]!.settlementsLeft).toBe(before - 1)

    // adjacent vertex now violates the distance rule for everyone
    expect(legalSettlementVertices(state, 0)).not.toContain(vertexId({ q: 2, r: 0 }, 5))
  })

  it('rejects a vertex on someone else network or floating', () => {
    const state = withResources(inMain(), 0, SETTLEMENT_COST)
    // P1's network, not P0's
    expectError(state, { type: 'build', player: 0, piece: 'settlement', location: vertexId({ q: -2, r: 0 }, 2) }, 'ILLEGAL_PLACEMENT')
  })
})

describe('build city', () => {
  it('upgrades an own settlement, returns it to stock', () => {
    let state = withResources(inMain(), 0, CITY_COST)
    const target = SETUP_PLACEMENTS[0]!.vertex
    expect(legalCityVertices(state, 0)).toContain(target)
    const stockBefore = state.players[0]!
    state = apply(state, { type: 'build', player: 0, piece: 'city', location: target })
    expect(state.buildings[target]).toEqual({ owner: 0, kind: 'city' })
    expect(state.players[0]!.citiesLeft).toBe(stockBefore.citiesLeft - 1)
    expect(state.players[0]!.settlementsLeft).toBe(stockBefore.settlementsLeft + 1)
  })

  it('cannot upgrade an opponent settlement, an empty vertex, or an existing city', () => {
    let state = withResources(inMain(), 0, { ore: 6, wheat: 4 })
    expectError(state, { type: 'build', player: 0, piece: 'city', location: SETUP_PLACEMENTS[1]!.vertex }, 'ILLEGAL_PLACEMENT')
    expectError(state, { type: 'build', player: 0, piece: 'city', location: vertexId({ q: 0, r: 0 }, 0) }, 'ILLEGAL_PLACEMENT')
    state = apply(state, { type: 'build', player: 0, piece: 'city', location: SETUP_PLACEMENTS[0]!.vertex })
    expectError(state, { type: 'build', player: 0, piece: 'city', location: SETUP_PLACEMENTS[0]!.vertex }, 'ILLEGAL_PLACEMENT')
  })
})

describe('affordable', () => {
  it('reflects the cost table', () => {
    const broke = inMain()
    expect(affordable(broke, 0)).toEqual({ road: false, settlement: false, city: false, devCard: false })
    const rich = withResources(broke, 0, { brick: 1, wood: 1, wheat: 2, sheep: 1, ore: 3 })
    expect(affordable(rich, 0)).toEqual({ road: true, settlement: true, city: true, devCard: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/build.test.ts`
Expected: FAIL — queries missing, build returns BAD_INTENT.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rules/src/catan/queries.ts
import type { PlayerId } from '../state'
import { COSTS } from './data'
import { settlementDistanceOk } from './placement'
import type { CatanState } from './state'
import { standardTopology, type EdgeId, type VertexId } from './topology'
import { hasResources } from './types'

/** Vacant edges connected to the player's network; roads cannot pass through an opponent's building. */
export function legalRoadEdges(state: CatanState, player: PlayerId): EdgeId[] {
  const topo = standardTopology()
  return topo.edges.filter((e) => {
    if (state.roads[e] !== undefined) return false
    for (const v of topo.edgeVertices[e]!) {
      const building = state.buildings[v]
      if (building?.owner === player) return true
      if (building) continue // opponent building blocks passage through this vertex
      if ((topo.vertexEdges[v] ?? []).some((e2) => e2 !== e && state.roads[e2] === player)) return true
    }
    return false
  })
}

/** Distance rule always; connection to an own road unless setup. */
export function legalSettlementVertices(
  state: CatanState,
  player: PlayerId,
  opts: { setup?: boolean } = {},
): VertexId[] {
  const topo = standardTopology()
  return topo.vertices.filter((v) => {
    if (!settlementDistanceOk(state, v)) return false
    if (opts.setup) return true
    return (topo.vertexEdges[v] ?? []).some((e) => state.roads[e] === player)
  })
}

export function legalCityVertices(state: CatanState, player: PlayerId): VertexId[] {
  return Object.keys(state.buildings).filter(
    (v) => state.buildings[v]!.owner === player && state.buildings[v]!.kind === 'settlement',
  )
}

export function affordable(
  state: CatanState,
  player: PlayerId,
): Record<'road' | 'settlement' | 'city' | 'devCard', boolean> {
  const hand = state.players[player]!.resources
  return {
    road: hasResources(hand, COSTS.road),
    settlement: hasResources(hand, COSTS.settlement),
    city: hasResources(hand, COSTS.city),
    devCard: hasResources(hand, COSTS.devCard),
  }
}
```

```ts
// packages/rules/src/catan/build.ts
import type { PlayerId } from '../state'
import { COSTS } from './data'
import { catanError as err, type CatanRuleError } from './intent'
import { legalCityVertices, legalRoadEdges, legalSettlementVertices } from './queries'
import type { CatanState } from './state'
import { addResources, hasResources, subtractResources } from './types'

export function applyBuild(
  state: CatanState,
  intent: { player: PlayerId; piece: 'road' | 'settlement' | 'city'; location: string },
): CatanState | CatanRuleError {
  if (state.turn.phase !== 'main') return err('BAD_PHASE', 'building happens in the main phase')
  const me = state.players[intent.player]!
  const cost = COSTS[intent.piece]
  if (!hasResources(me.resources, cost)) return err('CANT_AFFORD', `cannot afford a ${intent.piece}`)

  const pay = (p: typeof me) => ({ ...p, resources: subtractResources(p.resources, cost) })
  const bank = addResources(state.bank, cost)

  if (intent.piece === 'road') {
    if (me.roadsLeft === 0) return err('NO_STOCK', 'no road pieces left')
    if (!legalRoadEdges(state, intent.player).includes(intent.location))
      return err('ILLEGAL_PLACEMENT', 'not a legal road edge')
    const players = state.players.map((p, i) =>
      i === intent.player ? { ...pay(p), roadsLeft: p.roadsLeft - 1 } : p,
    )
    return { ...state, players, bank, roads: { ...state.roads, [intent.location]: intent.player } }
    // Task 12 wraps this return in updateLongestRoad(...)
  }

  if (intent.piece === 'settlement') {
    if (me.settlementsLeft === 0) return err('NO_STOCK', 'no settlement pieces left')
    if (!legalSettlementVertices(state, intent.player).includes(intent.location))
      return err('ILLEGAL_PLACEMENT', 'not a legal settlement vertex')
    const players = state.players.map((p, i) =>
      i === intent.player ? { ...pay(p), settlementsLeft: p.settlementsLeft - 1 } : p,
    )
    return {
      ...state,
      players,
      bank,
      buildings: { ...state.buildings, [intent.location]: { owner: intent.player, kind: 'settlement' as const } },
    }
    // Task 12 wraps this return too (a settlement can sever an opponent's longest road)
  }

  // city
  if (me.citiesLeft === 0) return err('NO_STOCK', 'no city pieces left')
  if (!legalCityVertices(state, intent.player).includes(intent.location))
    return err('ILLEGAL_PLACEMENT', 'cities upgrade your own settlements')
  const players = state.players.map((p, i) =>
    i === intent.player
      ? { ...pay(p), citiesLeft: p.citiesLeft - 1, settlementsLeft: p.settlementsLeft + 1 }
      : p,
  )
  return {
    ...state,
    players,
    bank,
    buildings: { ...state.buildings, [intent.location]: { owner: intent.player, kind: 'city' as const } },
  }
}
```

Wire in `apply.ts` (`import { applyBuild } from './build'`):

```ts
    case 'build':
      return applyBuild(state, intent)
```

Barrel: `export * from './queries'` and `export * from './build'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan packages/rules/test/catan
git commit -m "feat(rules): main-phase building with legal-placement queries"
```

---

### Task 9: Bank and Port Trading

**Files:**
- Create: `packages/rules/src/catan/trade.ts`
- Modify: `packages/rules/src/catan/queries.ts` (add `bankTradeRate`)
- Modify: `packages/rules/src/catan/apply.ts` (wire `bankTrade`)
- Modify: `packages/rules/src/catan/index.ts` (add `export * from './trade'`)
- Test: `packages/rules/test/catan/bank-trade.test.ts`

**Interfaces:**
- Consumes: prior tasks; `board.ports`.
- Produces:
  - `bankTradeRate(state: CatanState, player: PlayerId, resource: Resource): 4 | 3 | 2` (queries.ts) — 2 with a building on a matching-resource port, else 3 with any generic port, else 4.
  - `applyBankTrade(state, intent: { player; give: Resource; get: Resource }): CatanState | CatanRuleError` (trade.ts) — the engine computes the best rate itself; wired as `case 'bankTrade': return applyBankTrade(state, intent)`.

**Beginner-board port facts** (established in Task 5's helpers): P0's first settlement sits on the 2:1 **brick** port; P2's first settlement on the 2:1 **wheat** port; P3's first settlement and P1's second settlement on **3:1 generic** ports.

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/bank-trade.test.ts
import { describe, expect, it } from 'vitest'
import { bankTradeRate } from '../../src/catan'
import { apply, expectError, inMain, setupComplete, withResources } from './helpers'

describe('bankTradeRate', () => {
  it('reads ports off the players buildings', () => {
    const state = setupComplete()
    expect(bankTradeRate(state, 0, 'brick')).toBe(2) // brick port
    expect(bankTradeRate(state, 0, 'wood')).toBe(4) // brick port does not help wood
    expect(bankTradeRate(state, 2, 'wheat')).toBe(2) // wheat port
    expect(bankTradeRate(state, 3, 'ore')).toBe(3) // generic port
    expect(bankTradeRate(state, 1, 'ore')).toBe(3) // generic port (second settlement)
  })
})

describe('bankTrade', () => {
  it('4:1 with no port', () => {
    let state = withResources(inMain(), 0, { wood: 4 })
    const bankWood = state.bank.wood
    state = apply(state, { type: 'bankTrade', player: 0, give: 'wood', get: 'sheep' })
    expect(state.players[0]!.resources.wood).toBe(0)
    expect(state.players[0]!.resources.sheep).toBe(1)
    expect(state.bank.wood).toBe(bankWood + 4)
  })

  it('2:1 on a matching port', () => {
    let state = withResources(inMain(), 0, { brick: 2 })
    state = apply(state, { type: 'bankTrade', player: 0, give: 'brick', get: 'wheat' })
    expect(state.players[0]!.resources.brick).toBe(0)
    expect(state.players[0]!.resources.wheat).toBe(1)
  })

  it('rejects self-trades, unaffordable trades, empty bank, wrong phase', () => {
    const state = withResources(inMain(), 0, { brick: 2 })
    expectError(state, { type: 'bankTrade', player: 0, give: 'brick', get: 'brick' }, 'BAD_TRADE')
    expectError(state, { type: 'bankTrade', player: 0, give: 'wood', get: 'sheep' }, 'CANT_AFFORD')
    const drained = { ...state, bank: { ...state.bank, wheat: 0 } }
    expectError(drained, { type: 'bankTrade', player: 0, give: 'brick', get: 'wheat' }, 'BANK_SHORT')
    expectError(setupComplete(), { type: 'bankTrade', player: 0, give: 'brick', get: 'wheat' }, 'BAD_PHASE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/bank-trade.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Add to `queries.ts`:

```ts
/** 2 with a building on a matching-resource port, 3 with any generic port, else 4. */
export function bankTradeRate(state: CatanState, player: PlayerId, resource: Resource): 4 | 3 | 2 {
  let rate: 4 | 3 = 4
  for (const port of state.board.ports) {
    if (!port.vertices.some((v) => state.buildings[v]?.owner === player)) continue
    if (port.kind === resource) return 2
    if (port.kind === 'generic') rate = 3
  }
  return rate
}
```

(add `import type { Resource } from './types'` to queries.ts.)

```ts
// packages/rules/src/catan/trade.ts
import type { PlayerId } from '../state'
import { catanError as err, type CatanRuleError } from './intent'
import { bankTradeRate } from './queries'
import type { CatanState } from './state'
import { addResources, subtractResources, type Resource, type ResourceCount } from './types'

export function applyBankTrade(
  state: CatanState,
  intent: { player: PlayerId; give: Resource; get: Resource },
): CatanState | CatanRuleError {
  if (state.turn.phase !== 'main') return err('BAD_PHASE', 'trading happens in the main phase')
  if (intent.give === intent.get) return err('BAD_TRADE', 'cannot trade a resource for itself')
  const rate = bankTradeRate(state, intent.player, intent.give)
  const me = state.players[intent.player]!
  if (me.resources[intent.give] < rate)
    return err('CANT_AFFORD', `a ${rate}:1 trade needs ${rate} ${intent.give}`)
  if (state.bank[intent.get] < 1) return err('BANK_SHORT', `the bank has no ${intent.get}`)

  const gives = { [intent.give]: rate } as Partial<ResourceCount>
  const gets = { [intent.get]: 1 } as Partial<ResourceCount>
  const players = state.players.map((p, i) =>
    i === intent.player
      ? { ...p, resources: addResources(subtractResources(p.resources, gives), gets) }
      : p,
  )
  const bank = subtractResources(addResources(state.bank, gives), gets)
  return { ...state, players, bank }
}
```

Wire `case 'bankTrade': return applyBankTrade(state, intent)` in apply.ts; barrel-export `./trade`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan packages/rules/test/catan
git commit -m "feat(rules): bank and port trading with computed rates"
```

---

### Task 10: Player-to-Player Trading

**Files:**
- Modify: `packages/rules/src/catan/trade.ts` (add the four offer handlers)
- Modify: `packages/rules/src/catan/apply.ts` (wire `offerTrade`, `respondTrade`, `confirmTrade`, `cancelTrade`)
- Test: `packages/rules/test/catan/player-trade.test.ts`

**Interfaces:**
- Consumes: `TradeOffer`, `TradeResponse` from `./state`; resource math.
- Produces (all in trade.ts):
  - `applyOfferTrade(state, intent: { player; give; get })` — current player, main phase, no offer already open, both sides non-empty, offerer holds `give`.
  - `applyRespondTrade(state, intent: { player; response })` — any NON-current player while an offer is open (dispatched before the turn guard, replacing the Task-5 stub); a counter must be non-empty both ways and the responder must hold its `give`.
  - `applyConfirmTrade(state, intent: { player; partner })` — current player picks one accepted/countered response; terms: accept → offer as posted; counter → the counter (partner gives `counter.give`, receives `counter.get`); both hands re-validated at execution; clears the offer.
  - `applyCancelTrade(state, intent: { player })` — current player withdraws the open offer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/player-trade.test.ts
import { describe, expect, it } from 'vitest'
import { apply, expectError, inMain, withResources } from './helpers'
import type { CatanState } from '../../src/catan'

/** P0 in main with 2 wood; P1 holds 1 ore; P2 holds 1 ore + 1 wheat. */
function tradeScene(): CatanState {
  let state = inMain()
  state = withResources(state, 0, { wood: 2 })
  state = withResources(state, 1, { ore: 1 })
  state = withResources(state, 2, { ore: 1, wheat: 1 })
  return state
}

describe('player trading', () => {
  it('offer -> accept -> confirm executes the posted terms', () => {
    let state = tradeScene()
    state = apply(state, { type: 'offerTrade', player: 0, give: { wood: 2 }, get: { ore: 1 } })
    expect(state.turn.openTrade).toMatchObject({ give: { wood: 2 }, get: { ore: 1 } })
    state = apply(state, { type: 'respondTrade', player: 1, response: 'accept' })
    state = apply(state, { type: 'confirmTrade', player: 0, partner: 1 })
    expect(state.turn.openTrade).toBeNull()
    expect(state.players[0]!.resources.wood).toBe(0)
    expect(state.players[0]!.resources.ore).toBe(2) // 1 setup + 1 traded
    expect(state.players[1]!.resources.wood).toBe(2)
    expect(state.players[1]!.resources.ore).toBe(0)
  })

  it('offer -> counter -> confirm executes the countered terms', () => {
    let state = tradeScene()
    state = apply(state, { type: 'offerTrade', player: 0, give: { wood: 2 }, get: { ore: 1 } })
    // P2 counters: they would give 1 wheat and want only 1 wood
    state = apply(state, { type: 'respondTrade', player: 2, response: { give: { wheat: 1 }, get: { wood: 1 } } })
    state = apply(state, { type: 'confirmTrade', player: 0, partner: 2 })
    expect(state.players[0]!.resources.wood).toBe(1)
    expect(state.players[0]!.resources.wheat).toBe(1)
    expect(state.players[2]!.resources.wood).toBe(1)
    expect(state.players[2]!.resources.wheat).toBe(0) // held exactly 1 wheat (setup payout was ore), gave it away
  })

  it('reject cannot be confirmed; cancel clears the offer', () => {
    let state = tradeScene()
    state = apply(state, { type: 'offerTrade', player: 0, give: { wood: 1 }, get: { ore: 1 } })
    state = apply(state, { type: 'respondTrade', player: 1, response: 'reject' })
    expectError(state, { type: 'confirmTrade', player: 0, partner: 1 }, 'BAD_TRADE')
    expectError(state, { type: 'confirmTrade', player: 0, partner: 3 }, 'BAD_TRADE') // never responded
    state = apply(state, { type: 'cancelTrade', player: 0 })
    expect(state.turn.openTrade).toBeNull()
    expectError(state, { type: 'confirmTrade', player: 0, partner: 1 }, 'NO_TRADE')
  })

  it('guards: only current player offers/confirms, only others respond, hands must cover', () => {
    let state = tradeScene()
    expectError(state, { type: 'respondTrade', player: 1, response: 'accept' }, 'NO_TRADE')
    expectError(state, { type: 'offerTrade', player: 1, give: { ore: 1 }, get: { wood: 1 } }, 'NOT_YOUR_TURN')
    expectError(state, { type: 'offerTrade', player: 0, give: { wood: 5 }, get: { ore: 1 } }, 'CANT_AFFORD')
    expectError(state, { type: 'offerTrade', player: 0, give: {}, get: { ore: 1 } }, 'BAD_TRADE')
    expectError(state, { type: 'offerTrade', player: 0, give: { wood: 1 }, get: {} }, 'BAD_TRADE')
    state = apply(state, { type: 'offerTrade', player: 0, give: { wood: 2 }, get: { ore: 1 } })
    expectError(state, { type: 'offerTrade', player: 0, give: { wood: 1 }, get: { ore: 1 } }, 'BAD_TRADE') // one at a time
    expectError(state, { type: 'respondTrade', player: 0, response: 'accept' }, 'BAD_TRADE') // own offer
    expectError(state, { type: 'respondTrade', player: 3, response: { give: { ore: 9 }, get: { wood: 1 } } }, 'CANT_AFFORD')
    // acceptance without the goods dies at confirm time:
    state = apply(state, { type: 'respondTrade', player: 3, response: 'accept' }) // P3 holds 1 brick, no ore
    expectError(state, { type: 'confirmTrade', player: 0, partner: 3 }, 'CANT_AFFORD')
  })
})
```


- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/player-trade.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation** (append to trade.ts)

```ts
import { hasResources, totalResources } from './types' // merge into the existing type imports
import type { TradeResponse } from './state'

export function applyOfferTrade(
  state: CatanState,
  intent: { player: PlayerId; give: Partial<ResourceCount>; get: Partial<ResourceCount> },
): CatanState | CatanRuleError {
  if (state.turn.phase !== 'main') return err('BAD_PHASE', 'trading happens in the main phase')
  if (state.turn.openTrade) return err('BAD_TRADE', 'cancel the open offer first')
  if (totalResources(intent.give) === 0 || totalResources(intent.get) === 0)
    return err('BAD_TRADE', 'offers must give and get something')
  if (!hasResources(state.players[intent.player]!.resources, intent.give))
    return err('CANT_AFFORD', 'you do not hold what you are offering')
  return {
    ...state,
    turn: { ...state.turn, openTrade: { give: intent.give, get: intent.get, responses: {} } },
  }
}

export function applyRespondTrade(
  state: CatanState,
  intent: { player: PlayerId; response: 'accept' | 'reject' | { give: Partial<ResourceCount>; get: Partial<ResourceCount> } },
): CatanState | CatanRuleError {
  const offer = state.turn.openTrade
  if (state.turn.phase !== 'main' || !offer) return err('NO_TRADE', 'no open trade offer')
  if (intent.player === state.turn.current) return err('BAD_TRADE', 'you cannot respond to your own offer')

  let response: TradeResponse
  if (intent.response === 'accept') {
    response = { kind: 'accept' }
  } else if (intent.response === 'reject') {
    response = { kind: 'reject' }
  } else {
    if (totalResources(intent.response.give) === 0 || totalResources(intent.response.get) === 0)
      return err('BAD_TRADE', 'counters must give and get something')
    if (!hasResources(state.players[intent.player]!.resources, intent.response.give))
      return err('CANT_AFFORD', 'you do not hold what you are countering with')
    response = { kind: 'counter', give: intent.response.give, get: intent.response.get }
  }
  return {
    ...state,
    turn: {
      ...state.turn,
      openTrade: { ...offer, responses: { ...offer.responses, [intent.player]: response } },
    },
  }
}

export function applyConfirmTrade(
  state: CatanState,
  intent: { player: PlayerId; partner: PlayerId },
): CatanState | CatanRuleError {
  const offer = state.turn.openTrade
  if (state.turn.phase !== 'main' || !offer) return err('NO_TRADE', 'no open trade offer')
  const response = offer.responses[intent.partner]
  if (!response || response.kind === 'reject')
    return err('BAD_TRADE', `player ${intent.partner} has not agreed to this trade`)

  // accept -> posted terms; counter -> the countered terms
  const currentGives = response.kind === 'accept' ? offer.give : response.get
  const currentGets = response.kind === 'accept' ? offer.get : response.give
  if (!hasResources(state.players[intent.player]!.resources, currentGives))
    return err('CANT_AFFORD', 'you no longer hold your side of the trade')
  if (!hasResources(state.players[intent.partner]!.resources, currentGets))
    return err('CANT_AFFORD', `player ${intent.partner} no longer holds their side of the trade`)

  const players = state.players.map((p, i) => {
    if (i === intent.player)
      return { ...p, resources: addResources(subtractResources(p.resources, currentGives), currentGets) }
    if (i === intent.partner)
      return { ...p, resources: addResources(subtractResources(p.resources, currentGets), currentGives) }
    return p
  })
  return { ...state, players, turn: { ...state.turn, openTrade: null } }
}

export function applyCancelTrade(state: CatanState, _intent: { player: PlayerId }): CatanState | CatanRuleError {
  if (!state.turn.openTrade) return err('NO_TRADE', 'no open trade offer')
  return { ...state, turn: { ...state.turn, openTrade: null } }
}
```

Wire in apply.ts: replace the Task-5 `respondTrade` stub with `if (intent.type === 'respondTrade') return applyRespondTrade(state, intent)` (before the turn guard), and add `offerTrade`/`confirmTrade`/`cancelTrade` cases to the main switch.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan packages/rules/test/catan
git commit -m "feat(rules): player trading — open offers, counters, confirm/cancel"
```

---

### Task 11: Development Cards

**Files:**
- Create: `packages/rules/src/catan/dev-cards.ts`
- Modify: `packages/rules/src/catan/apply.ts` (wire `buyDevCard`, `playDevCard`)
- Modify: `packages/rules/src/catan/index.ts` (add `export * from './dev-cards'`)
- Test: `packages/rules/test/catan/dev-cards.test.ts`

**Interfaces:**
- Consumes: `COSTS`, `legalRoadEdges`, robber phase mechanics from Task 7.
- Produces:
  - `applyBuyDevCard(state, intent: { player }): CatanState | CatanRuleError` — main phase, pays `COSTS.devCard`, draws `devDeck[0]`, records `boughtOnTurn: turn.number`.
  - `applyPlayDevCard(state, intent, rng): CatanState | CatanRuleError` — knight in `preRoll` or `main`, others `main` only; one dev card per turn (`turn.devPlayed`); card must have `boughtOnTurn < turn.number`; `vp` is never playable. Knight: `knightsPlayed+1`, phase → `robber` with `robberReturn` = the phase it was played from (largest-army update comes in Task 13). Road building: 1–2 free roads (`min(2, roadsLeft)` required, each validated sequentially against `legalRoadEdges`). Year of plenty: take 2 from the bank (both must be available). Monopoly: every other player hands over ALL of the named resource.

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/dev-cards.test.ts
import { describe, expect, it } from 'vitest'
import { edgeId, type CatanState, type DevCard } from '../../src/catan'
import { apply, die, expectError, inMain, setupComplete, stubRng, withResources } from './helpers'

const DEV_COST = { ore: 1, wheat: 1, sheep: 1 }

/** Test surgery: put a card in a player's hand as if bought on an earlier turn. */
function withCard(state: CatanState, player: number, card: DevCard, boughtOnTurn = 0): CatanState {
  const players = state.players.map((p, i) =>
    i === player ? { ...p, devCards: [...p.devCards, { card, boughtOnTurn }] } : p,
  )
  return { ...state, players }
}

describe('buyDevCard', () => {
  it('pays the cost and draws the top of the deck', () => {
    let state = withResources(inMain(), 0, DEV_COST)
    const top = state.devDeck[0]!
    const deckSize = state.devDeck.length
    state = apply(state, { type: 'buyDevCard', player: 0 })
    expect(state.players[0]!.devCards).toEqual([{ card: top, boughtOnTurn: 1 }])
    expect(state.devDeck).toHaveLength(deckSize - 1)
    expect(state.players[0]!.resources.sheep).toBe(0)
  })

  it('rejects when broke, when the deck is empty, and outside main', () => {
    expectError(inMain(), { type: 'buyDevCard', player: 0 }, 'CANT_AFFORD')
    const state = withResources(inMain(), 0, DEV_COST)
    expectError({ ...state, devDeck: [] }, { type: 'buyDevCard', player: 0 }, 'DECK_EMPTY')
    expectError(withResources(setupComplete(), 0, DEV_COST), { type: 'buyDevCard', player: 0 }, 'BAD_PHASE')
  })

  it('a card bought this turn is not playable until next turn', () => {
    let state = withResources(inMain(), 0, DEV_COST)
    state = apply(state, { type: 'buyDevCard', player: 0 })
    const card = state.players[0]!.devCards[0]!.card
    if (card !== 'vp') {
      const intent =
        card === 'knight'
          ? ({ type: 'playDevCard', player: 0, card } as const)
          : card === 'roadBuilding'
            ? ({ type: 'playDevCard', player: 0, card, edges: [] } as const)
            : card === 'yearOfPlenty'
              ? ({ type: 'playDevCard', player: 0, card, take: ['wood', 'wood'] } as const)
              : ({ type: 'playDevCard', player: 0, card, resource: 'wood' } as const)
      expectError(state, intent, 'NO_CARD')
    }
  })
})

describe('playDevCard', () => {
  it('knight: playable before the roll, moves play into the robber phase and back', () => {
    let state = withCard(setupComplete(), 0, 'knight')
    state = apply(state, { type: 'playDevCard', player: 0, card: 'knight' })
    expect(state.turn.phase).toBe('robber')
    expect(state.turn.robberReturn).toBe('preRoll')
    expect(state.players[0]!.knightsPlayed).toBe(1)
    expect(state.players[0]!.devCards).toHaveLength(0)
    state = apply(state, { type: 'moveRobber', player: 0, hex: { q: 1, r: 0 }, stealFrom: null })
    expect(state.turn.phase).toBe('preRoll')
    // dice still to roll; and no second dev card this turn
    state = withCard(state, 0, 'knight')
    expectError(state, { type: 'playDevCard', player: 0, card: 'knight' }, 'DEV_LIMIT')
  })

  it('vp cards are never played; unplayable cards are NO_CARD', () => {
    const state = withCard(inMain(), 0, 'vp')
    expectError(state, { type: 'playDevCard', player: 0, card: 'monopoly', resource: 'ore' }, 'NO_CARD')
  })

  it('roadBuilding: two free roads, sequential legality', () => {
    let state = withCard(inMain(), 0, 'roadBuilding')
    const e1 = edgeId({ q: 2, r: 0 }, 5)
    const e2 = edgeId({ q: 2, r: 0 }, 4) // only legal once e1 exists
    const roadsBefore = state.players[0]!.roadsLeft
    const handBefore = state.players[0]!.resources
    expectError(state, { type: 'playDevCard', player: 0, card: 'roadBuilding', edges: [e2, e1] }, 'ILLEGAL_PLACEMENT')
    expectError(state, { type: 'playDevCard', player: 0, card: 'roadBuilding', edges: [e1] }, 'BAD_INTENT') // must place 2 while stock allows
    state = apply(state, { type: 'playDevCard', player: 0, card: 'roadBuilding', edges: [e1, e2] })
    expect(state.roads[e1]).toBe(0)
    expect(state.roads[e2]).toBe(0)
    expect(state.players[0]!.roadsLeft).toBe(roadsBefore - 2)
    expect(state.players[0]!.resources).toEqual(handBefore) // free
  })

  it('yearOfPlenty: takes two from the bank, both must exist', () => {
    let state = withCard(inMain(), 0, 'yearOfPlenty')
    state = apply(state, { type: 'playDevCard', player: 0, card: 'yearOfPlenty', take: ['ore', 'ore'] })
    expect(state.players[0]!.resources.ore).toBe(3) // 1 setup + 2
    const drained = { ...withCard(inMain(), 0, 'yearOfPlenty'), bank: { ...state.bank, wood: 1 } }
    expectError(drained, { type: 'playDevCard', player: 0, card: 'yearOfPlenty', take: ['wood', 'wood'] }, 'BANK_SHORT')
  })

  it('monopoly: strips the named resource from every other player', () => {
    let state = withCard(inMain(), 0, 'monopoly')
    state = withResources(state, 1, { wheat: 3 })
    state = withResources(state, 2, { wheat: 2 })
    state = apply(state, { type: 'playDevCard', player: 0, card: 'monopoly', resource: 'wheat' })
    // P1 had 1 setup wheat + 3 = 4; P2 had 2; P3 had 0
    expect(state.players[0]!.resources.wheat).toBe(6)
    expect(state.players[1]!.resources.wheat).toBe(0)
    expect(state.players[2]!.resources.wheat).toBe(0)
  })

  it('non-knight cards are main-phase only', () => {
    const state = withCard(setupComplete(), 0, 'monopoly')
    expectError(state, { type: 'playDevCard', player: 0, card: 'monopoly', resource: 'ore' }, 'BAD_PHASE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/dev-cards.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rules/src/catan/dev-cards.ts
import type { PlayerId } from '../state'
import { COSTS } from './data'
import { catanError as err, type CatanIntent, type CatanRuleError } from './intent'
import { legalRoadEdges } from './queries'
import type { CatanState } from './state'
import type { EdgeId } from './topology'
import {
  addResources,
  hasResources,
  subtractResources,
  toResourceCount,
  type Resource,
  type ResourceCount,
} from './types'

export function applyBuyDevCard(state: CatanState, intent: { player: PlayerId }): CatanState | CatanRuleError {
  if (state.turn.phase !== 'main') return err('BAD_PHASE', 'dev cards are bought in the main phase')
  const me = state.players[intent.player]!
  if (!hasResources(me.resources, COSTS.devCard)) return err('CANT_AFFORD', 'cannot afford a dev card')
  if (state.devDeck.length === 0) return err('DECK_EMPTY', 'the dev deck is exhausted')
  const [card, ...rest] = state.devDeck
  const players = state.players.map((p, i) =>
    i === intent.player
      ? {
          ...p,
          resources: subtractResources(p.resources, COSTS.devCard),
          devCards: [...p.devCards, { card: card!, boughtOnTurn: state.turn.number }],
        }
      : p,
  )
  return { ...state, players, bank: addResources(state.bank, COSTS.devCard), devDeck: rest }
}

type PlayIntent = Extract<CatanIntent, { type: 'playDevCard' }>

export function applyPlayDevCard(state: CatanState, intent: PlayIntent): CatanState | CatanRuleError {
  const phase = state.turn.phase
  const phaseOk = intent.card === 'knight' ? phase === 'preRoll' || phase === 'main' : phase === 'main'
  if (!phaseOk) return err('BAD_PHASE', `${intent.card} cannot be played now`)
  if (state.turn.devPlayed) return err('DEV_LIMIT', 'only one dev card per turn')

  const me = state.players[intent.player]!
  const idx = me.devCards.findIndex((c) => c.card === intent.card && c.boughtOnTurn < state.turn.number)
  if (idx === -1) return err('NO_CARD', `no playable ${intent.card}`)

  const spend = (s: CatanState): CatanState => ({
    ...s,
    players: s.players.map((p, i) =>
      i === intent.player ? { ...p, devCards: p.devCards.filter((_, j) => j !== idx) } : p,
    ),
    turn: { ...s.turn, devPlayed: true },
  })

  switch (intent.card) {
    case 'knight': {
      const spent = spend(state)
      const players = spent.players.map((p, i) =>
        i === intent.player ? { ...p, knightsPlayed: p.knightsPlayed + 1 } : p,
      )
      return {
        ...spent,
        players,
        turn: { ...spent.turn, phase: 'robber', robberReturn: phase as 'preRoll' | 'main' },
      }
      // Task 13 adds the largest-army update here
    }
    case 'roadBuilding': {
      const me2 = state.players[intent.player]!
      if (me2.roadsLeft === 0) return err('NO_STOCK', 'no road pieces left')
      const required = Math.min(2, me2.roadsLeft)
      if (intent.edges.length !== required)
        return err('BAD_INTENT', `road building places exactly ${required} roads`)
      let next = spend(state)
      for (const edge of intent.edges) {
        if (!legalRoadEdges(next, intent.player).includes(edge))
          return err('ILLEGAL_PLACEMENT', `${edge} is not a legal road edge`)
        next = {
          ...next,
          roads: { ...next.roads, [edge]: intent.player },
          players: next.players.map((p, i) =>
            i === intent.player ? { ...p, roadsLeft: p.roadsLeft - 1 } : p,
          ),
        }
      }
      return next
      // Task 12 wraps this return in updateLongestRoad(...)
    }
    case 'yearOfPlenty': {
      const take = toResourceCount(
        intent.take.reduce<Partial<ResourceCount>>((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {}),
      )
      if (!hasResources(state.bank, take)) return err('BANK_SHORT', 'the bank cannot cover that')
      const spent = spend(state)
      return {
        ...spent,
        bank: subtractResources(spent.bank, take),
        players: spent.players.map((p, i) =>
          i === intent.player ? { ...p, resources: addResources(p.resources, take) } : p,
        ),
      }
    }
    case 'monopoly': {
      const spent = spend(state)
      let hauled = 0
      const players = spent.players.map((p, i) => {
        if (i === intent.player) return p
        const n = p.resources[intent.resource]
        hauled += n
        return { ...p, resources: { ...p.resources, [intent.resource]: 0 } }
      })
      const final = players.map((p, i) =>
        i === intent.player
          ? { ...p, resources: addResources(p.resources, { [intent.resource]: hauled } as Partial<ResourceCount>) }
          : p,
      )
      return { ...spent, players: final }
    }
    default:
      return err('BAD_INTENT', 'vp cards are never played — they count at the win check')
  }
}
```

Wire in apply.ts: `case 'buyDevCard': return applyBuyDevCard(state, intent)` and `case 'playDevCard': return applyPlayDevCard(state, intent)`. Barrel-export `./dev-cards`.

(TypeScript note: the `vp` variant does not exist in `PlayIntent`, so the `default` arm is for exhaustiveness only — a `playDevCard` intent with `card: 'vp'` cannot typecheck; at runtime an untyped caller hits `NO_CARD` first anyway since the phase/hand checks run before the switch. Both behaviors are correct.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan packages/rules/test/catan
git commit -m "feat(rules): dev cards — buy, knight, road building, year of plenty, monopoly"
```

---

### Task 12: Longest Road

**Files:**
- Create: `packages/rules/src/catan/longest-road.ts`
- Modify: `packages/rules/src/catan/build.ts` (wrap the road and settlement returns in `updateLongestRoad`)
- Modify: `packages/rules/src/catan/dev-cards.ts` (wrap the roadBuilding return)
- Modify: `packages/rules/src/catan/index.ts` (add `export * from './longest-road'`)
- Test: `packages/rules/test/catan/longest-road.test.ts`

**Interfaces:**
- Consumes: topology, state.
- Produces:
  - `longestRoadLength(state: CatanState, player: PlayerId): number` — longest simple edge-path in the player's road network. An opponent's building blocks passage THROUGH a vertex but a path may start or end there.
  - `updateLongestRoad(state: CatanState): CatanState` — recomputes all lengths and applies the award rules: holder keeps on ties; a challenger must STRICTLY exceed the holder (and be ≥5); if the holder falls below 5 (severed), a unique max ≥5 takes the card, a tie sets it aside (null). Called after every road placement AND every settlement placement (severing).

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/longest-road.test.ts
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  edgeId,
  longestRoadLength,
  updateLongestRoad,
  vertexId,
  type CatanState,
} from '../../src/catan'
import { apply, inMain, setupComplete, withResources } from './helpers'

/** Test surgery: overwrite the road map (owners only, stocks untouched — length math only). */
function withRoads(state: CatanState, roads: Record<string, number>): CatanState {
  return { ...state, roads }
}

// A 5-edge path around hex (2,0): corners 0-5-4-3-2-1
const RING = [0, 5, 4, 3, 2].map((d) => edgeId({ q: 2, r: 0 }, d))

describe('longestRoadLength', () => {
  it('counts a simple chain', () => {
    const base = setupComplete()
    expect(longestRoadLength(base, 0)).toBe(1) // just the setup road... plus the second setup road elsewhere
    const chained = withRoads(base, Object.fromEntries(RING.map((e) => [e, 0])))
    expect(longestRoadLength(chained, 0)).toBe(5)
    expect(longestRoadLength(chained, 1)).toBe(0)
  })

  it('a fork counts its longest branch, not the sum', () => {
    const base = setupComplete()
    // path c5-c0 plus two branches from c0: edge d1 (c0-c1 of hex (2,0)) and the coast edge of (3,-1)... keep it on-board:
    // edges d0 (c5-c0), d1 (c0-c1), d2 (c1-c2): chain of 3; add d5 (c4-c5): extends from c5 -> total chain 4
    const roads = Object.fromEntries([0, 1, 2, 5].map((d) => [edgeId({ q: 2, r: 0 }, d), 0]))
    expect(longestRoadLength(withRoads(base, roads), 0)).toBe(4)
  })

  it('an opponent settlement severs the path but endpoints still count', () => {
    const base = setupComplete()
    const chained = withRoads(base, Object.fromEntries(RING.map((e) => [e, 0])))
    // block corner 4 of (2,0): splits 5 into max(2, 3)
    const blocked = {
      ...chained,
      buildings: { ...chained.buildings, [vertexId({ q: 2, r: 0 }, 4)]: { owner: 1, kind: 'settlement' as const } },
    }
    expect(longestRoadLength(blocked, 0)).toBe(3)
  })

  it('own buildings do not block', () => {
    const base = setupComplete()
    const chained = withRoads(base, Object.fromEntries(RING.map((e) => [e, 0])))
    // P0's own setup settlement sits at corner 0 of (2,0) already — length must still be 5
    expect(longestRoadLength(chained, 0)).toBe(5)
  })

  it('monotone under adding edges (property)', () => {
    const base = setupComplete()
    fc.assert(
      fc.property(fc.subarray([...RING, edgeId({ q: 2, r: 0 }, 1)]), fc.subarray(RING), (a, b) => {
        const small = withRoads(base, Object.fromEntries(b.map((e) => [e, 0])))
        const union = withRoads(base, Object.fromEntries([...a, ...b].map((e) => [e, 0])))
        expect(longestRoadLength(union, 0)).toBeGreaterThanOrEqual(longestRoadLength(small, 0))
        expect(longestRoadLength(union, 0)).toBeLessThanOrEqual(new Set([...a, ...b]).size)
      }),
    )
  })
})

describe('updateLongestRoad award', () => {
  const withLen = (state: CatanState, roadsByPlayer: Record<number, string[]>): CatanState => {
    const roads: Record<string, number> = {}
    for (const [p, edges] of Object.entries(roadsByPlayer))
      for (const e of edges) roads[e] = Number(p)
    return { ...state, roads }
  }
  // 5-chains on opposite corners for P0 and P1
  const P0_RING = [0, 5, 4, 3, 2].map((d) => edgeId({ q: 2, r: 0 }, d))
  const P1_RING = [0, 5, 4, 3, 2].map((d) => edgeId({ q: -2, r: 0 }, d))

  it('first to five takes the card; a tie does not move it; strictly longer does', () => {
    let state = updateLongestRoad(withLen(setupComplete(), { 0: P0_RING }))
    expect(state.awards.longestRoad).toBe(0)
    state = updateLongestRoad(withLen(state, { 0: P0_RING, 1: P1_RING }))
    expect(state.awards.longestRoad).toBe(0) // tie keeps holder
    const longer = [...P1_RING, edgeId({ q: -2, r: 0 }, 1)]
    state = updateLongestRoad(withLen(state, { 0: P0_RING, 1: longer }))
    expect(state.awards.longestRoad).toBe(1)
  })

  it('under five, nobody holds it', () => {
    const state = updateLongestRoad(withLen(setupComplete(), { 0: P0_RING.slice(0, 4) }))
    expect(state.awards.longestRoad).toBeNull()
  })

  it('severing the holder below 5 with no successor sets the card aside', () => {
    let state = updateLongestRoad(withLen(setupComplete(), { 0: P0_RING }))
    expect(state.awards.longestRoad).toBe(0)
    const severed = {
      ...state,
      buildings: { ...state.buildings, [vertexId({ q: 2, r: 0 }, 4)]: { owner: 1, kind: 'settlement' as const } },
    }
    expect(updateLongestRoad(severed).awards.longestRoad).toBeNull()
  })

  it('flows through the build intent', () => {
    let state = withResources(inMain(), 0, { brick: 4, wood: 4 })
    for (const d of [5, 4, 3, 2]) {
      state = apply(state, { type: 'build', player: 0, piece: 'road', location: edgeId({ q: 2, r: 0 }, d) })
    }
    expect(state.awards.longestRoad).toBe(0) // setup road d0 + these four = 5
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/longest-road.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rules/src/catan/longest-road.ts
import type { PlayerId } from '../state'
import { MIN_LONGEST_ROAD } from './data'
import type { CatanState } from './state'
import { standardTopology, type EdgeId, type VertexId } from './topology'

/**
 * Longest simple edge-path in the player's road network. Opponent buildings
 * block passage THROUGH a vertex; paths may still start or end at one.
 */
export function longestRoadLength(state: CatanState, player: PlayerId): number {
  const topo = standardTopology()
  const owned = new Set<EdgeId>(
    Object.keys(state.roads).filter((e) => state.roads[e] === player),
  )
  if (owned.size === 0) return 0

  const blockedForPassage = (v: VertexId) => {
    const b = state.buildings[v]
    return b !== undefined && b.owner !== player
  }

  const walk = (vertex: VertexId, used: Set<EdgeId>, isStart: boolean): number => {
    if (!isStart && blockedForPassage(vertex)) return 0
    let best = 0
    for (const e of topo.vertexEdges[vertex] ?? []) {
      if (!owned.has(e) || used.has(e)) continue
      const [a, b] = topo.edgeVertices[e]!
      const next = a === vertex ? b : a
      used.add(e)
      best = Math.max(best, 1 + walk(next, used, false))
      used.delete(e)
    }
    return best
  }

  const startVertices = new Set<VertexId>()
  for (const e of owned) for (const v of topo.edgeVertices[e]!) startVertices.add(v)

  let best = 0
  for (const v of startVertices) best = Math.max(best, walk(v, new Set(), true))
  return best
}

/**
 * Award rules (spec §2): first to >=5 takes it; ties keep the holder; a
 * challenger must strictly exceed; if the holder is severed below 5, a unique
 * new max >=5 takes the card, a tie (or nobody) sets it aside.
 */
export function updateLongestRoad(state: CatanState): CatanState {
  const lengths = state.players.map((_, p) => longestRoadLength(state, p))
  const holder = state.awards.longestRoad
  const qualifying = lengths
    .map((len, p) => ({ p, len }))
    .filter((x) => x.len >= MIN_LONGEST_ROAD)

  let next: PlayerId | null
  if (holder !== null && lengths[holder]! >= MIN_LONGEST_ROAD) {
    const challengers = qualifying.filter((x) => x.p !== holder && x.len > lengths[holder]!)
    if (challengers.length === 0) {
      next = holder
    } else {
      const max = Math.max(...challengers.map((x) => x.len))
      const leaders = challengers.filter((x) => x.len === max)
      next = leaders.length === 1 ? leaders[0]!.p : null
    }
  } else if (qualifying.length > 0) {
    const max = Math.max(...qualifying.map((x) => x.len))
    const leaders = qualifying.filter((x) => x.len === max)
    next = leaders.length === 1 ? leaders[0]!.p : null
  } else {
    next = null
  }

  if (next === state.awards.longestRoad) return state
  return { ...state, awards: { ...state.awards, longestRoad: next } }
}
```

In `build.ts`, wrap the road and settlement success returns:

```ts
    return updateLongestRoad({ ...state, players, bank, roads: { ...state.roads, [intent.location]: intent.player } })
```

```ts
    return updateLongestRoad({
      ...state,
      players,
      bank,
      buildings: { ...state.buildings, [intent.location]: { owner: intent.player, kind: 'settlement' as const } },
    })
```

(the city return does not need wrapping — cities never change road connectivity). In `dev-cards.ts`, the roadBuilding branch becomes `return updateLongestRoad(next)`. Barrel-export `./longest-road`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: all PASS. (The first chain test expects `longestRoadLength(base, 0)` to be 1 on the fresh draft: P0's two setup roads are far apart, so the longest CHAIN is 1 — if this reads 2, the DFS is summing disconnected components; fix before continuing.)

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan packages/rules/test/catan
git commit -m "feat(rules): longest road computation and award transfer rules"
```

---

### Task 13: Largest Army, Victory Points, Win Check

**Files:**
- Create: `packages/rules/src/catan/score.ts`
- Modify: `packages/rules/src/catan/apply.ts` (run `checkWin` on every success; start-of-turn check falls out of it)
- Modify: `packages/rules/src/catan/dev-cards.ts` (knight branch calls `updateLargestArmy`)
- Modify: `packages/rules/src/catan/index.ts` (add `export * from './score'`)
- Test: `packages/rules/test/catan/score.test.ts`

**Interfaces:**
- Consumes: `VP_TARGET`, `MIN_LARGEST_ARMY` from `./data`.
- Produces:
  - `victoryPoints(state: CatanState, player: PlayerId, opts?: { includeHidden?: boolean }): number` — settlements 1, cities 2, each award 2, plus hidden VP cards only when `includeHidden`.
  - `updateLargestArmy(state: CatanState, justPlayed: PlayerId): CatanState` — the just-played player takes the card when `knightsPlayed >= 3` and strictly greater than the holder's count (ties keep the holder; the count never decreases so no other transfer path exists).
  - `checkWin(state: CatanState): CatanState` — if the phase is neither `setup` nor `ended` and `victoryPoints(state, state.turn.current, { includeHidden: true }) >= VP_TARGET`, sets `winner = turn.current` and `phase = 'ended'`. Wired into `applyCatanIntent`'s success path: `return checkWin({ ...result, seq: state.seq + 1 })` — this makes wins fire only on the winner's own turn (spec §2): mid-turn via their own intents, and "at the start of their turn" via the endTurn that made them current.

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/test/catan/score.test.ts
import { describe, expect, it } from 'vitest'
import { updateLargestArmy, victoryPoints, type CatanState } from '../../src/catan'
import { apply, expectError, inMain, setupComplete, withResources } from './helpers'

/** Test surgery helpers. */
function withKnights(state: CatanState, player: number, n: number): CatanState {
  const players = state.players.map((p, i) => (i === player ? { ...p, knightsPlayed: n } : p))
  return { ...state, players }
}
function withVpCards(state: CatanState, player: number, n: number): CatanState {
  const players = state.players.map((p, i) =>
    i === player
      ? { ...p, devCards: [...p.devCards, ...Array.from({ length: n }, () => ({ card: 'vp' as const, boughtOnTurn: 0 }))] }
      : p,
  )
  return { ...state, players }
}
function withAward(state: CatanState, award: 'longestRoad' | 'largestArmy', player: number): CatanState {
  return { ...state, awards: { ...state.awards, [award]: player } }
}
function withCities(state: CatanState, player: number): CatanState {
  const buildings = Object.fromEntries(
    Object.entries(state.buildings).map(([v, b]) =>
      b.owner === player ? [v, { ...b, kind: 'city' as const }] : [v, b],
    ),
  )
  return { ...state, buildings }
}

describe('victoryPoints', () => {
  it('counts buildings, awards, and (only when asked) hidden vp cards', () => {
    let state = setupComplete()
    expect(victoryPoints(state, 0)).toBe(2) // two setup settlements
    state = withCities(state, 0) // -> 4
    state = withAward(state, 'longestRoad', 0) // -> 6
    state = withAward(state, 'largestArmy', 0) // -> 8
    state = withVpCards(state, 0, 2) // hidden -> 10
    expect(victoryPoints(state, 0)).toBe(8)
    expect(victoryPoints(state, 0, { includeHidden: true })).toBe(10)
    expect(victoryPoints(state, 1)).toBe(2)
  })
})

describe('updateLargestArmy', () => {
  it('third knight takes the card; ties keep the holder; strictly more transfers', () => {
    let state = setupComplete()
    state = updateLargestArmy(withKnights(state, 0, 2), 0)
    expect(state.awards.largestArmy).toBeNull()
    state = updateLargestArmy(withKnights(state, 0, 3), 0)
    expect(state.awards.largestArmy).toBe(0)
    state = updateLargestArmy(withKnights(state, 1, 3), 1)
    expect(state.awards.largestArmy).toBe(0) // tie keeps holder
    state = updateLargestArmy(withKnights(state, 1, 4), 1)
    expect(state.awards.largestArmy).toBe(1)
  })
})

describe('winning', () => {
  it('a mid-turn intent that reaches 10 VP (hidden vp cards included) ends the game', () => {
    let state = inMain()
    state = withCities(state, 0) // 4
    state = withAward(state, 'longestRoad', 0) // 6
    state = withAward(state, 'largestArmy', 0) // 8
    state = withVpCards(state, 0, 2) // 10 hidden
    state = withResources(state, 0, { wood: 4 })
    const after = apply(state, { type: 'bankTrade', player: 0, give: 'wood', get: 'sheep' })
    expect(after.winner).toBe(0)
    expect(after.turn.phase).toBe('ended')
    expectError(after, { type: 'endTurn', player: 0 }, 'GAME_OVER')
  })

  it('an off-turn 10 only wins at the start of their own turn', () => {
    let state = inMain() // P0's turn
    state = withCities(state, 1)
    state = withAward(state, 'longestRoad', 1)
    state = withAward(state, 'largestArmy', 1)
    state = withVpCards(state, 1, 2) // P1 sits at 10 while P0 plays
    expect(state.winner).toBeNull()
    const after = apply(state, { type: 'endTurn', player: 0 })
    expect(after.winner).toBe(1) // crowned the moment their turn begins
    expect(after.turn.phase).toBe('ended')
  })

  it('setup placements never trigger a win', () => {
    const state = setupComplete()
    expect(state.winner).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/score.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// packages/rules/src/catan/score.ts
import type { PlayerId } from '../state'
import { MIN_LARGEST_ARMY, VP_TARGET } from './data'
import type { CatanState } from './state'

export function victoryPoints(
  state: CatanState,
  player: PlayerId,
  opts: { includeHidden?: boolean } = {},
): number {
  let vp = 0
  for (const b of Object.values(state.buildings)) {
    if (b.owner === player) vp += b.kind === 'city' ? 2 : 1
  }
  if (state.awards.longestRoad === player) vp += 2
  if (state.awards.largestArmy === player) vp += 2
  if (opts.includeHidden)
    vp += state.players[player]!.devCards.filter((c) => c.card === 'vp').length
  return vp
}

/** Ties keep the holder; the just-played player takes the card only when strictly ahead and >=3. */
export function updateLargestArmy(state: CatanState, justPlayed: PlayerId): CatanState {
  const holder = state.awards.largestArmy
  if (holder === justPlayed) return state
  const count = state.players[justPlayed]!.knightsPlayed
  if (count < MIN_LARGEST_ARMY) return state
  if (holder !== null && count <= state.players[holder]!.knightsPlayed) return state
  return { ...state, awards: { ...state.awards, largestArmy: justPlayed } }
}

/** Wins fire only for the current player (spec §2: "10 VP on their own turn"). */
export function checkWin(state: CatanState): CatanState {
  if (state.turn.phase === 'setup' || state.turn.phase === 'ended') return state
  const p = state.turn.current
  if (victoryPoints(state, p, { includeHidden: true }) >= VP_TARGET)
    return { ...state, winner: p, turn: { ...state.turn, phase: 'ended' } }
  return state
}
```

In `apply.ts`, change the success return of `applyCatanIntent` to:

```ts
  return checkWin({ ...result, seq: state.seq + 1 })
```

(`import { checkWin } from './score'`). In `dev-cards.ts`'s knight branch, wrap the return:

```ts
      return updateLargestArmy(
        { ...spent, players, turn: { ...spent.turn, phase: 'robber', robberReturn: phase as 'preRoll' | 'main' } },
        intent.player,
      )
```

Barrel-export `./score`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @meridian/rules test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/catan packages/rules/test/catan
git commit -m "feat(rules): largest army, victory points, and the on-your-turn win check"
```

---

### Task 14: Full-Game Integration Test, Exports Audit, Docs

**Files:**
- Test: `packages/rules/test/catan/full-game.test.ts`
- Modify: `packages/rules/README.md` (create if missing: one section on the Catan engine's API surface)
- Modify: `docs/PLAN.md` (check off / note the engine milestone if the file tracks it)

**Interfaces:** consumes the whole public API — this task proves the engine plays complete games.

- [ ] **Step 1: Write the seeded auto-player test** (this is the spec's "full scripted game with a seeded rng": dumb deterministic bots + seeded dice drive real intents through the reducer until someone wins; every step asserts engine invariants)

```ts
// packages/rules/test/catan/full-game.test.ts
import { describe, expect, it } from 'vitest'
import {
  affordable,
  applyCatanIntent,
  createCatanGame,
  createRng,
  isRuleError,
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  standardTopology,
  totalResources,
  victoryPoints,
  RESOURCES,
  type CatanIntent,
  type CatanState,
  type Rng,
} from '../../src/index'
import { coordKey } from '../../src/index'

const MAX_INTENTS = 5000
const SEEDS = [1, 2, 3, 4, 5]

function assertInvariants(state: CatanState): void {
  for (const r of RESOURCES) {
    const total = state.bank[r] + state.players.reduce((s, p) => s + p.resources[r], 0)
    expect(total).toBe(19)
    expect(state.bank[r]).toBeGreaterThanOrEqual(0)
    for (const p of state.players) expect(p.resources[r]).toBeGreaterThanOrEqual(0)
  }
  for (const p of state.players) {
    expect(p.roadsLeft).toBeGreaterThanOrEqual(0)
    expect(p.settlementsLeft).toBeGreaterThanOrEqual(0)
    expect(p.citiesLeft).toBeGreaterThanOrEqual(0)
  }
  const devTotal =
    state.devDeck.length + state.players.reduce((s, p) => s + p.devCards.length, 0) +
    state.players.reduce((s, p) => s + p.knightsPlayed, 0)
  expect(devTotal).toBeLessThanOrEqual(25) // played non-knights leave the game; knights are tracked
}

/** One deterministic bot decision for whoever must act. */
function nextIntent(state: CatanState): CatanIntent {
  const t = state.turn
  const topo = standardTopology()

  if (t.phase === 'setup') {
    const p = t.current
    if (t.setup!.expect === 'settlement') {
      const spots = legalSettlementVertices(state, p, { setup: true })
      return { type: 'placeSetupSettlement', player: p, vertex: spots[0]! }
    }
    const settlement = t.setup!.lastSettlement!
    const edge = (topo.vertexEdges[settlement] ?? []).find((e) => state.roads[e] === undefined)!
    return { type: 'placeSetupRoad', player: p, edge }
  }

  if (t.phase === 'discard') {
    const player = Number(Object.keys(t.pendingDiscards)[0]!)
    let owed = t.pendingDiscards[player]!
    const hand = { ...state.players[player]!.resources }
    const resources: Partial<Record<(typeof RESOURCES)[number], number>> = {}
    for (const r of RESOURCES) {
      const n = Math.min(hand[r], owed)
      if (n > 0) resources[r] = n
      owed -= n
      if (owed === 0) break
    }
    return { type: 'discard', player, resources }
  }

  if (t.phase === 'robber') {
    const p = t.current
    const hex = state.board.hexes.find(
      (h) =>
        coordKey(h.coord) !== state.board.robber &&
        !(topo.hexVertices[coordKey(h.coord)] ?? []).some((v) => state.buildings[v]?.owner === p),
    )!
    const key = coordKey(hex.coord)
    const victim = state.players.findIndex(
      (pl, i) =>
        i !== p &&
        totalResources(pl.resources) > 0 &&
        (topo.hexVertices[key] ?? []).some((v) => state.buildings[v]?.owner === i),
    )
    return { type: 'moveRobber', player: p, hex: hex.coord, stealFrom: victim === -1 ? null : victim }
  }

  if (t.phase === 'preRoll') return { type: 'rollDice', player: t.current }

  // main phase, greedy priorities: city > settlement > dev card > knight > road > end
  const p = t.current
  const me = state.players[p]!
  const can = affordable(state, p)
  if (can.city && me.citiesLeft > 0) {
    const spots = legalCityVertices(state, p)
    if (spots.length) return { type: 'build', player: p, piece: 'city', location: spots[0]! }
  }
  if (can.settlement && me.settlementsLeft > 0) {
    const spots = legalSettlementVertices(state, p)
    if (spots.length) return { type: 'build', player: p, piece: 'settlement', location: spots[0]! }
  }
  if (can.devCard && state.devDeck.length > 0) return { type: 'buyDevCard', player: p }
  if (!t.devPlayed && me.devCards.some((c) => c.card === 'knight' && c.boughtOnTurn < t.number))
    return { type: 'playDevCard', player: p, card: 'knight' }
  if (can.road && me.roadsLeft > 0) {
    const spots = legalRoadEdges(state, p)
    if (spots.length) return { type: 'build', player: p, piece: 'road', location: spots[0]! }
  }
  return { type: 'endTurn', player: p }
}

function playGame(seed: number): CatanState {
  const rng: Rng = createRng(seed)
  let state = createCatanGame({ playerCount: 4, layout: 'random' }, rng)
  let prevSeq = state.seq
  for (let i = 0; i < MAX_INTENTS && state.winner === null; i++) {
    const intent = nextIntent(state)
    const result = applyCatanIntent(state, intent, rng)
    if (isRuleError(result)) throw new Error(`bot generated illegal ${intent.type}: ${result.code} ${result.message}`)
    expect(result.seq).toBe(prevSeq + 1)
    prevSeq = result.seq
    assertInvariants(result)
    state = result
  }
  return state
}

describe('full seeded 4-player games', () => {
  it('bots play complete legal games; at least one seed reaches a 10-VP win', () => {
    let wins = 0
    for (const seed of SEEDS) {
      const state = playGame(seed)
      if (state.winner !== null) {
        wins++
        expect(state.turn.phase).toBe('ended')
        expect(victoryPoints(state, state.winner, { includeHidden: true })).toBeGreaterThanOrEqual(10)
        expect(victoryPoints(state, state.winner)).toBeLessThanOrEqual(12) // sanity: no runaway scoring
      }
    }
    expect(wins).toBeGreaterThanOrEqual(1)
  })

  it('the same seed replays to the identical final state', () => {
    const a = playGame(SEEDS[0]!)
    const b = playGame(SEEDS[0]!)
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @meridian/rules exec vitest run test/catan/full-game.test.ts`
Expected: PASS. Two known ways it can fail honestly — fix the ENGINE, not the assertion:
- A `bot generated illegal ...` throw means a legality query disagrees with its reducer twin — that is a real bug (the queries and reducers must agree; Task 8 tested this for roads, this test sweeps everything).
- Zero wins across all 5 seeds means dumb-greedy bots cannot convert resources into 10 VP in 5000 intents — first suspect the setup bot placing all settlements clustered (legal spots exhausted), or production paying nobody. Debug with `victoryPoints` prints before touching SEEDS; widening SEEDS is a last resort and must be committed with a comment explaining why.

- [ ] **Step 3: Docs**

Add to `packages/rules/README.md` (create the file if it does not exist) a short section:

```markdown
## Catan engine (`src/catan/`)

Headless Settlers implementation per `docs/superpowers/specs/2026-08-19-catan-pivot-design.md`.

- `createCatanGame({ playerCount, layout }, rng)` → `CatanState` (secrets included — the server redacts per-seat).
- `applyCatanIntent(state, intent, rng)` → `CatanState | CatanRuleError`. All randomness via the injected `Rng` (`createRng(seed)`), so games replay deterministically.
- Client helpers: `legalRoadEdges`, `legalSettlementVertices`, `legalCityVertices`, `affordable`, `bankTradeRate`, `victoryPoints`, `longestRoadLength`.
- Rules-as-data in `src/catan/data.ts`; board/topology facts in `src/catan/topology.ts` (54 vertices / 72 edges).
- The legacy hex-tactics engine (`applyIntent`/`GameState`) is untouched and still exported.
```

If `docs/PLAN.md` tracks an engine milestone, check it off; otherwise leave it.

- [ ] **Step 4: Full suite + lint**

Run: `pnpm --filter @meridian/rules test && pnpm --filter @meridian/rules lint`
Expected: everything green, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add packages/rules docs
git commit -m "test(rules): seeded full-game integration harness; catan engine docs"
```

---

## Self-Review Notes (already applied)

- **Spec coverage check (§2 → tasks):** board composition/validation → 3; snake draft + second-settlement payout → 5; roll/production/bank-limit → 6; 7-flow (simultaneous discard, robber, steal, robbed hex produces nothing → 6's test) → 7; building costs/placement rules/piece limits → 8; bank 4:1 + ports 3:1/2:1 → 9; player trading incl. counters → 10; dev cards (composition 3, buy/play/one-per-turn/bought-this-turn/knight-before-roll 11, VP-cards-hidden 13); longest road ≥5/ties/severing → 12; largest army ≥3/ties → 13; 10-VP-on-own-turn win incl. hidden reveal → 13; full seeded game → 14. §3: topology index → 2; secrets-in-state → 4; injected rng → 1; rules-as-data → 3; derived helpers → 8/9/12/13; property tests → 2/12; scripted game → 14.
- **Not in this plan (deliberate):** per-seat redaction and zod intent schemas are phase 3 (server); `legalMoves`-style aggregate "all legal intents" helper deferred until the client needs it; 5–6 player extension out of scope per spec.
- **Consistency:** `catanError` import alias `err` used in every handler module; all handlers return `CatanState | CatanRuleError`; `seq` is bumped exactly once, only in `applyCatanIntent`; `standardTopology()` is the only topology accessor after Task 2.
- **Known data-tuning risk:** `PORT_SPECS` offsets were hand-derived against the documented spiral walk; the 18-distinct-vertices test is the arbiter (Task 3 Step 4 note).

## Execution

Plan complete. Execute with superpowers:subagent-driven-development (fresh subagent per task, review between tasks) on branch `worktree-catan-engine`.





