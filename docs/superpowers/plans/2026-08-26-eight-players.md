# Eight-Player Meridian Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Matches of 3–8 players; 5+ players get a radius-3 (37-hex) board that the whole stack — rules, server, client — already almost supports.

**Architecture:** The 2026-08-25 spike proved a radius-3 board renders end-to-end with data changes only (`spiralCoords(radius)` is already parameterized; coastline, water, ports, rafts all scale). This plan makes board size a first-class parameter: a `BOARD_SIZES` table in rules-as-data, a `topologyFor(board)` accessor that replaces the hardcoded `standardTopology()` at every call site, player count widened to 3..8 end to end, and size-aware client presentation (camera, water plane, seat colors 5–8, compact player strip).

**Tech Stack:** Existing monorepo — @meridian/rules (pure TS), @meridian/protocol, apps/server (Colyseus), apps/client (React + R3F). Vitest everywhere.

**Spec:** No separate spec file; the Design Decisions section below is the authority, distilled from the 2026-08-25 spike (throwaway edits, reverted) and docs/DISCORD-LAUNCH.md's need for up-to-8 seats.

## Global Constraints

- TDD per repo convention: test first, watch it fail, minimal code, suite green, commit.
- Suite commands: `pnpm -C packages/rules test`, `pnpm -C apps/server test`, `pnpm -C apps/client test`; typecheck `pnpm -C <pkg> exec tsc --noEmit`.
- Never run E2E while ports 5173/2567 are busy (the config fails loud by design).
- No emoji anywhere in UI copy.
- Existing 3–4 player behavior must be bit-for-bit unchanged: radius 2 keeps `TERRAIN_POOL`, `TOKEN_SPIRAL`, spiral-order token assignment, `BEGINNER_TERRAIN`, bank 19, current dev deck.

## Design Decisions (mini-spec)

1. **Size mapping:** playerCount 3–4 → radius 2 (19 hexes, today's board, untouched). playerCount 5–8 → radius 3 (37 hexes).
2. **Radius-3 data:** terrain pool forest 8 / pasture 8 / fields 8 / hills 6 / mountains 6 / desert 1 (=37). Token pool = the base 18-token multiset doubled (=36 tokens). Ports: 11 (5 generic + one 2:1 per resource + a second sheep — mirrors the official 5–6p extension's extra sheep port) spread over the 18-hex outer ring.
3. **Token assignment at radius 3 is shuffled, not spiral-ordered.** The base game's fixed A..R spiral is a radius-2 tradition; a doubled spiral has no official geometry and may structurally violate red-token adjacency. Radius 3 shuffles the token pool per attempt and re-rolls until `validateBoard` passes (same re-roll loop the random layout already uses, `MAX_RANDOM_ATTEMPTS` unchanged).
4. **`layout: 'beginner'` stays radius-2-only** (it is test-infrastructure; the lobby always creates `random`). Requesting beginner at radius 3 throws.
5. **Bank and dev deck at radius 3:** bank 24 per resource; dev deck knight 20, vp 5, roadBuilding 3, yearOfPlenty 3, monopoly 3 (=34, official 5–6p composition). Piece limits stay 15/5/4 per player.
6. **Topology access:** new `topologyFor(board)` infers radius from `board.hexes.length` (19→2, 37→3), memoized per radius. `standardTopology()` remains as the radius-2 constant (tests use it); all production call sites move to `topologyFor`.
7. **Seat colors 5–8** (spike verdicts): purple `#6b3fa0`, kelly green `#2e8b3a`, pink `#d873a8` (the "lighter magenta" fix), sky-cyan `#56b8d8`.
8. **Client layout is board-driven:** `catanLayout`/`catanStore` stop calling `spiralCoords()` and iterate `board.hexes` (the board already carries every coord — no radius logic client-side).
9. **Scene scaling:** radius 2 keeps camera `[0, 9, 8]` / maxDistance 14 / water 28. Radius 3: camera `[0, 12.5, 11]`, maxDistance 19, water 38.
10. **HUD:** PlayerStrip gains a `compact` variant for >4 players (smaller cards, two rows). Lobby offers 3–8.

## File Structure

- `packages/rules/src/catan/data.ts` — add `BoardSize` interface + `BOARD_SIZES` table (radius 2 entry aliases the existing constants).
- `packages/rules/src/catan/board.ts` — `generateBoard(rng, layout, radius)`, `validateBoard(hexes, size)`, port resolution over `6*radius` outer hexes.
- `packages/rules/src/catan/topology.ts` — `topologyFor(board)` + per-radius memo.
- `packages/rules/src/catan/create.ts` — playerCount 3..8, size-driven bank/deck/radius.
- 17 mechanical call-site edits (listed in Task 3).
- `apps/server/src/rooms/CatanRoom.ts` — options validation 3..8.
- `apps/client/src/net/catan.ts`, `ui/Lobby.tsx`, `scene/catan/{palette,catanLayout,catanStore,CatanScene}.ts(x)`, `ui/hud.css` — widening + presentation.
- `apps/client/src/dev/board/BoardPreview.tsx` — `?radius=3` preview knob for visual sign-off.

---

### Task 1: BOARD_SIZES data + size-aware validateBoard/generateBoard

**Files:**
- Modify: `packages/rules/src/catan/data.ts`
- Modify: `packages/rules/src/catan/board.ts`
- Test: `packages/rules/test/catan/board.test.ts` (extend)

**Interfaces:**
- Produces: `interface BoardSize { radius: number; terrainPool: readonly Terrain[]; tokenPool: readonly number[]; portSpecs: readonly PortSpec[]; bankPerResource: number; devDeck: Readonly<Record<DevCard, number>>; spiralTokens: boolean }`, `const BOARD_SIZES: Readonly<Record<2 | 3, BoardSize>>`, `generateBoard(rng: Rng, layout?: 'beginner' | 'random', radius?: 2 | 3): CatanBoard`, `validateBoard(hexes: readonly HexTile[], size?: BoardSize): string | null`.

- [ ] **Step 1: Write the failing tests** (append to `board.test.ts`)

```typescript
describe('radius-3 board', () => {
  it('generates 37 hexes, 11 ports, valid tokens, robber on the desert', () => {
    const board = generateBoard(createRng(5), 'random', 3)
    expect(board.hexes).toHaveLength(37)
    expect(board.ports).toHaveLength(11)
    expect(validateBoard(board.hexes, BOARD_SIZES[3])).toBeNull()
    const desert = board.hexes.find((h) => h.terrain === 'desert')!
    expect(board.robber).toBe(coordKey(desert.coord))
  })

  it('radius-3 terrain pool: 8/8/8 wood-sheep-wheat, 6/6 brick-ore, 1 desert', () => {
    const pool = BOARD_SIZES[3].terrainPool
    expect(pool).toHaveLength(37)
    const count = (t: string) => pool.filter((x) => x === t).length
    expect([count('forest'), count('pasture'), count('fields')]).toEqual([8, 8, 8])
    expect([count('hills'), count('mountains'), count('desert')]).toEqual([6, 6, 1])
  })

  it('beginner layout refuses radius 3', () => {
    expect(() => generateBoard(createRng(1), 'beginner', 3)).toThrow(/beginner/)
  })

  it('radius 2 defaults are byte-identical to before', () => {
    const a = generateBoard(createRng(7), 'beginner')
    const b = generateBoard(createRng(7), 'beginner', 2)
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C packages/rules test board`
Expected: FAIL — `BOARD_SIZES is not defined` (and missing imports; add `BOARD_SIZES` to the test's import from `../../src/catan`).

- [ ] **Step 3: Implement `BOARD_SIZES` in data.ts**

```typescript
export interface BoardSize {
  radius: number
  terrainPool: readonly Terrain[]
  tokenPool: readonly number[]
  portSpecs: readonly PortSpec[]
  bankPerResource: number
  devDeck: Readonly<Record<DevCard, number>>
  /** Base-game tradition: tokens laid along the spiral. False = shuffled per attempt. */
  spiralTokens: boolean
}

const TERRAIN_POOL_3: readonly Terrain[] = [
  ...Array<Terrain>(8).fill('forest'),
  ...Array<Terrain>(8).fill('pasture'),
  ...Array<Terrain>(8).fill('fields'),
  ...Array<Terrain>(6).fill('hills'),
  ...Array<Terrain>(6).fill('mountains'),
  'desert',
]

/** Outer ring at radius 3 has 18 hexes; 11 ports, official-5-6p flavored (extra sheep). */
const PORT_SPECS_3: readonly PortSpec[] = [
  { outerIndex: 0, seaEdgeOffset: 0, kind: 'generic' },
  { outerIndex: 2, seaEdgeOffset: 0, kind: 'wood' },
  { outerIndex: 3, seaEdgeOffset: 1, kind: 'generic' },
  { outerIndex: 5, seaEdgeOffset: 0, kind: 'brick' },
  { outerIndex: 7, seaEdgeOffset: 0, kind: 'sheep' },
  { outerIndex: 8, seaEdgeOffset: 1, kind: 'generic' },
  { outerIndex: 10, seaEdgeOffset: 0, kind: 'wheat' },
  { outerIndex: 12, seaEdgeOffset: 0, kind: 'generic' },
  { outerIndex: 13, seaEdgeOffset: 1, kind: 'ore' },
  { outerIndex: 15, seaEdgeOffset: 0, kind: 'sheep' },
  { outerIndex: 16, seaEdgeOffset: 1, kind: 'generic' },
]

export const BOARD_SIZES: Readonly<Record<2 | 3, BoardSize>> = {
  2: {
    radius: 2,
    terrainPool: TERRAIN_POOL,
    tokenPool: TOKEN_SPIRAL,
    portSpecs: PORT_SPECS,
    bankPerResource: BANK_PER_RESOURCE,
    devDeck: DEV_DECK_COMPOSITION,
    spiralTokens: true,
  },
  3: {
    radius: 3,
    terrainPool: TERRAIN_POOL_3,
    tokenPool: [...TOKEN_SPIRAL, ...TOKEN_SPIRAL],
    portSpecs: PORT_SPECS_3,
    bankPerResource: 24,
    devDeck: { knight: 20, vp: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 },
    spiralTokens: false,
  },
}
```

- [ ] **Step 4: Parameterize board.ts**

```typescript
// assignTokens takes the tokens to lay (already in final order):
function assignTokens(coords: readonly Coord[], terrains: readonly Terrain[], tokens: readonly number[]): HexTile[] {
  let t = 0
  return coords.map((coord, i) => ({
    coord,
    terrain: terrains[i]!,
    token: terrains[i] === 'desert' ? null : tokens[t++]!,
  }))
}

// validateBoard(hexes, size = BOARD_SIZES[2]) — replace the two global reads:
//   TERRAIN_POOL  -> size.terrainPool
//   TOKEN_SPIRAL  -> size.tokenPool

// resolvePorts(coords, size) — replace:
//   coords.slice(0, 12)  -> coords.slice(0, 6 * size.radius)
//   PORT_SPECS.map(...)  -> size.portSpecs.map(...)

export function generateBoard(rng: Rng, layout: 'beginner' | 'random' = 'random', radius: 2 | 3 = 2): CatanBoard {
  const size = BOARD_SIZES[radius]
  const coords = spiralCoords(radius)
  let hexes: HexTile[]
  if (layout === 'beginner') {
    if (radius !== 2) throw new Error('beginner layout exists only for the radius-2 board')
    hexes = assignTokens(coords, BEGINNER_TERRAIN, size.tokenPool)
    const err = validateBoard(hexes, size)
    if (err) throw new Error(`beginner layout invalid: ${err}`)
  } else {
    let attempt = 0
    do {
      if (++attempt > MAX_RANDOM_ATTEMPTS) throw new Error('could not generate a valid random board')
      const tokens = size.spiralTokens ? size.tokenPool : shuffle(rng, size.tokenPool)
      hexes = assignTokens(coords, shuffle(rng, size.terrainPool), tokens)
    } while (validateBoard(hexes, size) !== null)
  }
  const desert = hexes.find((h) => h.terrain === 'desert')!
  return { hexes, ports: resolvePorts(coords, size), robber: coordKey(desert.coord) }
}
```

- [ ] **Step 5: Run rules suite**

Run: `pnpm -C packages/rules test`
Expected: all green (existing board tests pass unchanged — radius 2 path is identical: spiral tokens, same pools).

- [ ] **Step 6: Commit**

```bash
git add packages/rules/src/catan/data.ts packages/rules/src/catan/board.ts packages/rules/test/catan/board.test.ts
git commit -m "feat(rules): BOARD_SIZES table + radius-3 board generation"
```

---

### Task 2: topologyFor(board)

**Files:**
- Modify: `packages/rules/src/catan/topology.ts`
- Test: `packages/rules/test/catan/topology.test.ts` (extend)

**Interfaces:**
- Consumes: `CatanBoard` (board.ts), `buildTopology`, `spiralCoords` (already in topology.ts — import CatanBoard type only, or accept `{ hexes: { length: number } }` to avoid an import cycle; use the structural type).
- Produces: `topologyFor(board: { hexes: readonly unknown[] }): Topology` — infers radius from `hexes.length` (19→2, 37→3, anything else throws), memoized per radius. `standardTopology()` unchanged.

- [ ] **Step 1: Write the failing test**

```typescript
it('topologyFor infers radius from hex count and memoizes', () => {
  const r2 = topologyFor({ hexes: new Array(19) })
  expect(r2).toBe(standardTopology()) // same memo entry
  const r3 = topologyFor({ hexes: new Array(37) })
  expect(r3.hexes ?? true).toBeTruthy() // structural sanity below
  expect(Object.keys(r3.hexVertices)).toHaveLength(37)
  expect(topologyFor({ hexes: new Array(37) })).toBe(r3)
  expect(() => topologyFor({ hexes: new Array(20) })).toThrow(/unknown board size/)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C packages/rules test topology`
Expected: FAIL — `topologyFor is not a function`.

- [ ] **Step 3: Implement**

```typescript
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
```

- [ ] **Step 4: Run, then commit**

Run: `pnpm -C packages/rules test` — green.

```bash
git add packages/rules/src/catan/topology.ts packages/rules/test/catan/topology.test.ts
git commit -m "feat(rules): topologyFor(board) — per-radius memoized topology"
```

---

### Task 3: Migrate every production standardTopology() call site to topologyFor

**Files (every non-test `standardTopology()` call, 17 sites):**
- Modify: `packages/rules/src/catan/apply.ts:78,118` → `topologyFor(state.board)`
- Modify: `packages/rules/src/catan/production.ts:24` (inside `grossProduction`) → `topologyFor(state.board)`
- Modify: `packages/rules/src/catan/robber.ts:53` → `topologyFor(state.board)`
- Modify: `packages/rules/src/catan/placement.ts:6` → `topologyFor(state.board)`
- Modify: `packages/rules/src/catan/queries.ts:16,35` → `topologyFor(state.board)`
- Modify: `packages/rules/src/catan/bot.ts:15` → `topologyFor(state.board)`
- Modify: `packages/rules/src/catan/longest-road.ts:11` → `topologyFor(state.board)`
- Modify: `packages/rules/src/catan/companion.ts:69,215,259,273` → `topologyFor(state.board)`
- Modify: `apps/server/src/events.ts:63` → `topologyFor(before.board)`
- Modify: `apps/server/src/pilot.ts:51,71` → `topologyFor(state.board)`
- Modify: `apps/client/src/scene/catan/catanStore.ts:151,185` → `topologyFor(view.board)`

Each function already has `state`/`view`/`before` in scope; where a function receives only a vertex or hexes, thread the board's topology in from the caller rather than importing `standardTopology`. Update each file's import from `standardTopology` to `topologyFor` (keep `standardTopology` only where a test-support/default-board context genuinely wants the radius-2 constant, e.g. `SETUP_PLACEMENTS` helpers).

- [ ] **Step 1: Mechanical migration** — apply the edits above.
- [ ] **Step 2: Typecheck all packages**

Run: `for p in packages/rules packages/protocol apps/server apps/client; do pnpm -C $p exec tsc --noEmit || break; done`
Expected: clean.

- [ ] **Step 3: Run all three suites**

Run: `pnpm -C packages/rules test && pnpm -C apps/server test && pnpm -C apps/client test`
Expected: all green — behavior at radius 2 is unchanged (topologyFor returns the same memoized object).

- [ ] **Step 4: Commit**

```bash
git add -A packages/rules/src apps/server/src apps/client/src
git commit -m "refactor: topologyFor(board) at every production topology call site"
```

---

### Task 4: playerCount 3..8 through create, room, and client net

**Files:**
- Modify: `packages/rules/src/catan/create.ts`
- Modify: `apps/server/src/rooms/CatanRoom.ts:24,60-63`
- Modify: `apps/client/src/net/catan.ts:51`
- Test: `packages/rules/test/catan/create.test.ts` (extend), `apps/server/test/catan-room.test.ts` (extend)

**Interfaces:**
- Produces: `CatanPlayerCount = 3 | 4 | 5 | 6 | 7 | 8` (exported from create.ts and re-exported from the rules index), `boardRadiusFor(playerCount: CatanPlayerCount): 2 | 3`.

- [ ] **Step 1: Failing rules test**

```typescript
it('5-8 players get the radius-3 board, scaled bank and dev deck', () => {
  const state = createCatanGame({ playerCount: 6 }, createRng(3))
  expect(state.players).toHaveLength(6)
  expect(state.board.hexes).toHaveLength(37)
  expect(state.bank.wood).toBe(24)
  expect(state.devDeck).toHaveLength(34)
})

it('3-4 players keep the classic board', () => {
  const state = createCatanGame({ playerCount: 4 }, createRng(3))
  expect(state.board.hexes).toHaveLength(19)
  expect(state.bank.wood).toBe(19)
})
```

Run: `pnpm -C packages/rules test create` — FAIL (playerCount type rejects 6; then board size wrong).

- [ ] **Step 2: Implement create.ts**

```typescript
export type CatanPlayerCount = 3 | 4 | 5 | 6 | 7 | 8

export function boardRadiusFor(playerCount: CatanPlayerCount): 2 | 3 {
  return playerCount <= 4 ? 2 : 3
}
```

In `createCatanGame`: `playerCount: CatanPlayerCount`; `const radius = boardRadiusFor(options.playerCount)`; `const size = BOARD_SIZES[radius]`; `generateBoard(rng, options.layout ?? 'random', radius)`; bank from `size.bankPerResource`; dev deck built from `size.devDeck` (the existing deck-building code reads `DEV_DECK_COMPOSITION` — switch it to `size.devDeck`). A 5+ `layout: 'beginner'` request propagates board.ts's throw.

- [ ] **Step 3: Failing server test** (extend catan-room.test.ts; `seatClients` already accepts options)

```typescript
it('accepts an 8-player room and rejects 2 and 9', async () => {
  const room = await server.sdk.joinOrCreate('catan', { players: 8, bots: 7, seed: 1 })
  await settle()
  expect(room.state.targetPlayers).toBe(8)
  await room.leave()
  await expect(server.sdk.joinOrCreate('catan', { players: 2 })).rejects.toThrow()
  await expect(server.sdk.joinOrCreate('catan', { players: 9 })).rejects.toThrow()
})
```

Run: `pnpm -C apps/server test catan-room` — FAIL (validation rejects 8).

- [ ] **Step 4: Widen CatanRoom + client net**

CatanRoom options `players: number`; validation `if (!Number.isInteger(options.players) || options.players < 3 || options.players > 8) throw new Error('players must be 3..8')` (bots check `0..players-1` already generalizes). Audit the file for literal 3/4 assumptions — the early-start path at `:103` says "exactly 3 seated players in a 4-room": generalize to `targetPlayers - 1` seated (message: `` `early start needs exactly ${options.players - 1} seated players` ``). Client: `createCatanMatch(players: CatanPlayerCount, bots: number)` importing the type from `@meridian/rules`.

- [ ] **Step 5: All suites + typecheck**

Run: `pnpm -C packages/rules test && pnpm -C apps/server test && pnpm -C apps/client test && pnpm -C apps/client exec tsc --noEmit`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A packages/rules apps/server/src apps/server/test apps/client/src
git commit -m "feat: player count 3..8 — radius-3 board, scaled bank/deck, room validation"
```

---

### Task 5: Seat colors 5–8

**Files:**
- Modify: `apps/client/src/scene/catan/palette.ts:39-44`
- Test: `apps/client/test/palette.test.ts` (create)

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { SEAT_COLORS, seatColor } from '../src/scene/catan/palette'

describe('seat colors', () => {
  it('eight distinct seat colors, no fallback grey inside 0..7', () => {
    expect(SEAT_COLORS).toHaveLength(8)
    expect(new Set(SEAT_COLORS).size).toBe(8)
    for (let s = 0; s < 8; s++) expect(seatColor(s)).not.toBe('#999999')
  })
})
```

Run: `pnpm -C apps/client test palette` — FAIL (length 4).

- [ ] **Step 2: Implement** — append to `SEAT_COLORS` (spike-approved values):

```typescript
export const SEAT_COLORS: readonly string[] = [
  palette.players.red,
  palette.players.blue,
  palette.players.white,
  palette.players.orange,
  '#6b3fa0', // purple — spike-verified at distance
  '#2e8b3a', // kelly green — spike-verified
  '#d873a8', // pink (the lightened magenta — magenta drifted red at distance)
  '#56b8d8', // sky-cyan
]
```

- [ ] **Step 3: Run + commit**

Run: `pnpm -C apps/client test` — green.

```bash
git add apps/client/src/scene/catan/palette.ts apps/client/test/palette.test.ts
git commit -m "feat(client): seat colors for seats 5-8"
```

---

### Task 6: Board-driven client layout (drop spiralCoords from the client)

**Files:**
- Modify: `apps/client/src/scene/catan/catanLayout.ts:34,55` — both loops `for (const hex of spiralCoords())` become board-driven; the two functions gain a `hexes` parameter: `hexWorld(hexes: CatanBoard['hexes'])` / `vertexWorld(hexes: CatanBoard['hexes'])` (rename parameters to match the file's existing naming). Callers already hold the board.
- Modify: callers found via `rtk proxy grep -rn "hexWorld\|vertexWorld" apps/client/src` — pass `board.hexes` (Pieces.tsx already receives `board`; CatanScene/PickLayer/Highlights receive `view`/`board`). The module-level cache (`vw` in Pieces.tsx is module-cached) must key on hex count: cache in a `Map<number, ...>` keyed by `hexes.length`.
- Test: `apps/client/test/catanLayout.test.ts` (extend)

- [ ] **Step 1: Failing test**

```typescript
it('lays out a radius-3 board from its hexes alone', () => {
  const board = generateBoard(createRng(2), 'random', 3)
  const vw = vertexWorld(board.hexes)
  expect(Object.keys(topologyFor(board).hexVertices)).toHaveLength(37)
  const placements = portWorld(board, vw, 0.5)
  expect(placements).toHaveLength(11)
  for (const p of placements) expect(Number.isFinite(p.x + p.z)).toBe(true)
})
```

Run: `pnpm -C apps/client test catanLayout` — FAIL (signatures don't take hexes / positions missing for outer ring).

- [ ] **Step 2: Implement** — thread `hexes` through both functions; iterate `hexes.map((h) => h.coord)` instead of `spiralCoords()`; remove the `spiralCoords` import. Key any module-level layout cache by `hexes.length` (radius 2 and 3 boards can coexist across matches in one session).

- [ ] **Step 3: Run client suite + typecheck; commit**

```bash
git add apps/client/src apps/client/test/catanLayout.test.ts
git commit -m "refactor(client): board-driven layout — no client-side spiral assumptions"
```

---

### Task 7: Size-aware scene (camera, water, orbit) + /board radius preview

**Files:**
- Modify: `apps/client/src/scene/catan/CatanScene.tsx:23,209,223` — derive from the board:

```typescript
const big = board.hexes.length > 19
const CAMERA_POS: [number, number, number] = big ? [0, 12.5, 11] : [0, 9, 8]
const MAX_DIST = big ? 19 : 14
const waterSize = big ? 38 : 28
```

  `camera={{ position: CAMERA_POS, ... }}`, `maxDistance={MAX_DIST}`, `planeGeometry args={[waterSize, waterSize]}` (move `WATER_SIZE` from module const to a prop of `Water` — `<Water hexes={board.hexes} size={waterSize} />`). Note: the Canvas `camera` prop is initial-only; deriving it per-board is fine because a room remount recreates the Canvas.
- Modify: `apps/client/src/dev/board/BoardPreview.tsx` — accept `?radius=3` (same `numberParam` idiom as net/catan.ts) and build its local state via `createCatanGame({ playerCount: radius === 3 ? 6 : 4 }, createRng(seed))`.

- [ ] **Step 1: Implement** (presentation-only; no unit test — node env cannot render R3F. The verification step is visual.)
- [ ] **Step 2: Visual verification** — with the user's dev servers untouched, start a spare client (`pnpm -C apps/client dev -- --port 5175 --strictPort`), open `/board?radius=3`, screenshot: full 37-hex island visible from the default camera, water reaches every coast, rafts/ports render on the outer ring, orbit can pull back far enough. Compare `/board` (radius 2) is unchanged.
- [ ] **Step 3: Run client suite (unchanged) + commit**

```bash
git add apps/client/src
git commit -m "feat(client): size-aware camera/water/orbit + /board?radius=3 preview"
```

---

### Task 8: Lobby 3–8 + compact PlayerStrip

**Files:**
- Modify: `apps/client/src/ui/Lobby.tsx` — replace the two fixed buttons with a 3–8 row:

```tsx
const [players, setPlayers] = useState<CatanPlayerCount>(4)
// ...
<div className="players-choice">
  {([3, 4, 5, 6, 7, 8] as const).map((n) => (
    <button
      key={n}
      data-testid={`players-${n}`}
      className={players === n ? 'selected' : undefined}
      onClick={() => { setPlayers(n); if (bots > n - 1) setBots(n - 1) }}
    >
      {n}
    </button>
  ))}
</div>
```

  (Keep the existing bots picker logic — `maxBots = players - 1` already generalizes; clamp selected bots when players shrinks, as shown.)
- Modify: `apps/client/src/ui/CatanHud.tsx` PlayerStrip — `className={cards.length > 4 ? 'opponent-strip compact' : 'opponent-strip'}` via `playerCards(...)` result.
- Modify: `apps/client/src/ui/hud.css` — append:

```css
.catan-hud .opponent-strip.compact { flex-wrap: wrap; max-width: 340px; }
.catan-hud .opponent-strip.compact .opponent-card { font-size: 10px; padding: 4px 6px; min-width: 9em; }
```

  (Adjust the selector names to the actual classes in PlayerStrip — check `opponent-card` usage at the top of CatanHud.tsx.)
- Test: `apps/client/test/hudLogic.test.ts` — if `playerCards` needs no change (it maps over `view.players`, already length-agnostic), extend its test with an 8-player view asserting 8 cards come back in seat order.

- [ ] **Step 1: Failing hudLogic test** (8-player view → 8 cards). Run: FAIL only if playerCards hardcodes 4 — if it passes immediately, note that in the commit message and keep the test as a regression guard.
- [ ] **Step 2: Implement lobby + CSS.**
- [ ] **Step 3: Visual verification** — spare-port client, create an 8-player room with 7 bots (`?seed=1`), confirm: lobby buttons, waiting room fill, all 8 player cards legible in two rows, action log seat chips use the new colors.
- [ ] **Step 4: Suites + typecheck + commit**

```bash
git add apps/client/src apps/client/test
git commit -m "feat(client): lobby 3-8 players + compact 8-card player strip"
```

---

### Task 9: End-to-end proof — full 8-player bot game

**Files:**
- Test: `packages/rules/test/catan/companion.test.ts` (extend the existing full-game sim block)
- Test: `apps/server/test/companion-room.test.ts` (extend)

- [ ] **Step 1: Rules-level sim** — in the existing seeded-sim loop (the `for (const seed of [1, 2, 3])` block at ~line 365), lift `playerCount` and seat arrays into a parameter and run one additional pass with `playerCount: 8, seed: 1`, `for` arrays sized 8, cap 8000 intents. Assert a winner or no-stall exactly as the 4-player sim does. If a seed stalls legitimately (no winner in 8000), pin a different seed the way `catan-full-match.test.ts` documents its pinned seeds.

Run: `pnpm -C packages/rules test companion` — this is the load-bearing proof that all rules generalize to 8 seats and radius 3.

- [ ] **Step 2: Room smoke** — companion-room test: `players: 8, bots: 7, seed: 1, pilotDelayMs: 0` — human joins, starts, assert within a settle window that setup placements progress (16 buildings placed) and the game reaches `preRoll` — mirrors the existing "bots play" test at line 120, widened.

- [ ] **Step 3: Suites green + commit**

```bash
git add packages/rules/test apps/server/test
git commit -m "test: 8-player full-game sim + room smoke"
```

---

## Self-review notes

- Spec coverage: decisions 1–10 map to tasks 1 (2,3,4,5), 2–3 (6), 4 (1 partially, room/net), 5 (7), 6 (8), 7 (5), 8 (6), 9 (7), 10 (8). Proof: task 9.
- Radius-2 regression safety is asserted explicitly (task 1 step 1 last test; task 3 relies on identical memo).
- Type names used across tasks: `BoardSize`, `BOARD_SIZES`, `topologyFor`, `CatanPlayerCount`, `boardRadiusFor` — consistent.
- Known risk: token-shuffle re-roll at radius 3 could in principle exhaust 1000 attempts; terrain shuffle changes red-token positions every attempt, so failure odds are negligible — but task 1's test seeds a fixed rng, so any surprise surfaces immediately and deterministically.
