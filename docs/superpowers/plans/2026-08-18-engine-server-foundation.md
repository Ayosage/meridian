# Meridian Engine + Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Meridian Turborepo with a pure data-driven hex rules engine, shared protocol schemas, and a Colyseus authoritative server on which two simulated clients complete a full placeholder-ruleset match with reconnection — no rendering.

**Architecture:** `packages/rules` is a pure TypeScript engine (plain immutable `GameState`, zod-validated declarative rulesets, `applyIntent` reducer) that never imports colyseus/three/react. `apps/server` wraps it in a Colyseus `MatchRoom` that validates every intent through the engine and mirrors the resulting plain state into a `@colyseus/schema` tree for native diff sync. `packages/protocol` holds the zod intent/error message schemas shared across the boundary. `apps/client` is a stub this plan.

**Tech Stack:** pnpm 10, Turborepo, TypeScript (strict), zod, fast-check, Vitest, Colyseus 0.16 (+ @colyseus/schema, @colyseus/testing, @colyseus/tools), tsx, Vite + React + R3F (client stub only).

**Spec:** `docs/superpowers/specs/2026-08-18-meridian-engine-server-design.md` (parent: `docs/BRIEF.md`, `docs/PLAN.md` tasks 1–9)

## Global Constraints

- Node >= 20; `packageManager` pinned `pnpm@10.12.1` in root package.json.
- TypeScript `strict: true` + `noUncheckedIndexedAccess` in every package; no `any` in committed code.
- **`packages/rules` and `packages/protocol` must never import `colyseus`, `three`, or `react`** — not even types. They run headless.
- Package names: `@meridian/rules`, `@meridian/protocol`, `server`, `client`.
- The placeholder ruleset is DATA (`packages/rules/src/rulesets/placeholder.json`) loaded through the zod loader — no placeholder-specific logic in engine code.
- Engine state is immutable: `applyIntent` returns a new `GameState`, never mutates its input.
- Server listens on `process.env.PORT ?? 2567`. No secrets anywhere in this plan.
- Library API drift rule: if an installed Colyseus 0.16 API differs from a snippet here (most likely: custom `roomId` assignment in `onCreate`), adapt minimally to preserve the stated behavior and report the deviation in your task report.
- Commit after every task; conventional-commit messages.

---

### Task 1: Turborepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.prettierrc`, `README.md`

**Interfaces:**
- Consumes: nothing (repo currently contains only `docs/`).
- Produces: workspace where `pnpm install` and `pnpm turbo run lint test build` succeed (no tasks yet, exit 0).

- [ ] **Step 1: Create root config files**

`package.json`:

```json
{
  "name": "meridian",
  "private": true,
  "packageManager": "pnpm@10.12.1",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "dev": "turbo run dev"
  },
  "devDependencies": {
    "prettier": "^3.3.0",
    "turbo": "^2.3.0",
    "typescript": "^5.6.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "dev": { "cache": false, "persistent": true }
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true
  }
}
```

`.gitignore`:

```
node_modules/
dist/
.turbo/
.superpowers/
.claude/
*.tsbuildinfo
```

`.prettierrc`:

```json
{ "semi": false, "singleQuote": true, "printWidth": 100 }
```

`README.md` (placeholder; Task 10 writes the real one):

```markdown
# Meridian

Original online board game — R3F client, authoritative Colyseus server,
data-driven rules engine. See docs/BRIEF.md. Full README lands with the
client stub task.
```

- [ ] **Step 2: Install and verify the toolchain**

Run:

```bash
pnpm install
pnpm turbo run lint test build
```

Expected: install succeeds; turbo reports no tasks executed, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm/turborepo workspace"
```

---

### Task 2: `@meridian/rules` — hex coordinates and state types

**Files:**
- Create: `packages/rules/package.json`, `packages/rules/tsconfig.json`, `packages/rules/vitest.config.ts`, `packages/rules/src/coord.ts`, `packages/rules/src/state.ts`, `packages/rules/src/index.ts`
- Test: `packages/rules/test/coord.test.ts`

**Interfaces:**
- Consumes: root workspace from Task 1.
- Produces: `@meridian/rules` exporting `Coord {q,r}`, `DIRECTIONS`, `add(a,b): Coord`, `coordsEqual(a,b): boolean`, `coordKey(c): string` (format `"q,r"`), `neighbors(c): Coord[]` (6, DIRECTIONS order), `distance(a,b): number` (axial hex distance), `inRadius(c, radius): boolean` (hexagonal board membership: max(|q|,|r|,|q+r|) <= radius); types `PlayerId = number`, `Piece { id: string; owner: PlayerId; type: string; at: Coord }`, `GameState { ruleset: Ruleset; seq: number; currentPlayer: PlayerId; pieces: readonly Piece[]; winner: PlayerId | null }`. (`Ruleset` arrives in Task 3 via a type-only import; until then `state.ts` uses a temporary `type Ruleset = unknown` alias that Task 3 replaces.)

- [ ] **Step 1: Create package scaffolding**

`packages/rules/package.json`:

```json
{
  "name": "@meridian/rules",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": {
    "fast-check": "^3.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/rules/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/rules/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

- [ ] **Step 2: Write the failing test**

`packages/rules/test/coord.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  add,
  coordKey,
  coordsEqual,
  distance,
  inRadius,
  neighbors,
  type Coord,
} from '../src/index'

const arbCoord = fc.record({
  q: fc.integer({ min: -20, max: 20 }),
  r: fc.integer({ min: -20, max: 20 }),
})

describe('hex coordinate helpers', () => {
  it('computes known distances', () => {
    expect(distance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0)
    expect(distance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1)
    expect(distance({ q: 0, r: 0 }, { q: 1, r: -1 })).toBe(1)
    expect(distance({ q: -3, r: 0 }, { q: 3, r: 0 })).toBe(6)
    expect(distance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2)
  })

  it('distance is symmetric and zero only at identity (property)', () => {
    fc.assert(
      fc.property(arbCoord, arbCoord, (a, b) => {
        expect(distance(a, b)).toBe(distance(b, a))
        if (coordsEqual(a, b)) expect(distance(a, b)).toBe(0)
        else expect(distance(a, b)).toBeGreaterThan(0)
      }),
    )
  })

  it('distance obeys the triangle inequality (property)', () => {
    fc.assert(
      fc.property(arbCoord, arbCoord, arbCoord, (a, b, c) => {
        expect(distance(a, c)).toBeLessThanOrEqual(distance(a, b) + distance(b, c))
      }),
    )
  })

  it('every coord has 6 distinct neighbors at distance 1 (property)', () => {
    fc.assert(
      fc.property(arbCoord, (c) => {
        const ns = neighbors(c)
        expect(ns).toHaveLength(6)
        expect(new Set(ns.map(coordKey)).size).toBe(6)
        for (const n of ns) expect(distance(c, n)).toBe(1)
      }),
    )
  })

  it('add and equality behave', () => {
    expect(add({ q: 2, r: -1 }, { q: -1, r: 1 })).toEqual({ q: 1, r: 0 })
    expect(coordsEqual({ q: 1, r: 2 }, { q: 1, r: 2 })).toBe(true)
    expect(coordsEqual({ q: 1, r: 2 }, { q: 2, r: 1 })).toBe(false)
    expect(coordKey({ q: -3, r: 2 })).toBe('-3,2')
  })

  it('inRadius matches the hexagonal board rule', () => {
    expect(inRadius({ q: 0, r: 0 }, 3)).toBe(true)
    expect(inRadius({ q: -3, r: 0 }, 3)).toBe(true)
    expect(inRadius({ q: -3, r: 2 }, 3)).toBe(true)
    expect(inRadius({ q: -3, r: -1 }, 3)).toBe(false)
    expect(inRadius({ q: 4, r: 0 }, 3)).toBe(false)
    expect(inRadius({ q: 2, r: 2 }, 3)).toBe(false)
  })

  it('inRadius agrees with distance-from-origin (property)', () => {
    fc.assert(
      fc.property(arbCoord, fc.integer({ min: 1, max: 8 }), (c, radius) => {
        expect(inRadius(c, radius)).toBe(distance({ q: 0, r: 0 }, c) <= radius)
      }),
    )
  })

  it('exports state types usable at compile time', () => {
    const piece: import('../src/index').Piece = {
      id: 'p0-0',
      owner: 0,
      type: 'runner',
      at: { q: 0, r: 0 },
    }
    expect(piece.owner).toBe(0)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm install && pnpm --filter @meridian/rules test`
Expected: FAIL — cannot resolve `../src/index`.

- [ ] **Step 4: Implement**

`packages/rules/src/coord.ts`:

```ts
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
```

`packages/rules/src/state.ts`:

```ts
import type { Coord } from './coord'

// Replaced by `import type { Ruleset } from './ruleset'` in the ruleset task.
type Ruleset = unknown

export type PlayerId = number

export interface Piece {
  id: string
  owner: PlayerId
  type: string
  at: Coord
}

export interface GameState {
  ruleset: Ruleset
  seq: number
  currentPlayer: PlayerId
  pieces: readonly Piece[]
  winner: PlayerId | null
}
```

`packages/rules/src/index.ts`:

```ts
export * from './coord'
export * from './state'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @meridian/rules test`
Expected: PASS (8 tests). Also run `pnpm --filter @meridian/rules lint` — clean.

- [ ] **Step 6: Commit**

```bash
git add packages/rules
git commit -m "feat(rules): axial hex coord helpers with property tests, core state types"
```

---

### Task 3: `@meridian/rules` — declarative ruleset format, loader, placeholder ruleset, initial state

**Files:**
- Create: `packages/rules/src/ruleset.ts`, `packages/rules/src/rulesets/placeholder.json`, `packages/rules/src/placeholder.ts`, `packages/rules/src/setup.ts`
- Modify: `packages/rules/src/state.ts` (replace the `unknown` Ruleset alias), `packages/rules/src/index.ts`
- Test: `packages/rules/test/ruleset.test.ts`

**Interfaces:**
- Consumes: `Coord`, `inRadius`, `coordKey` from Task 2.
- Produces: `rulesetSchema`, `type Ruleset`, `type PieceDef`, `loadRuleset(data: unknown): Ruleset` (throws `Error` with a descriptive message on any invalid input), `placeholderRuleset: Ruleset` (the loaded placeholder), `initialState(ruleset: Ruleset): GameState` (piece ids `p{player}-{index}` where index counts that player's setup entries in order; `seq: 0`, `currentPlayer: 0`, `winner: null`).

- [ ] **Step 1: Write the failing test**

`packages/rules/test/ruleset.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { initialState, loadRuleset, placeholderRuleset } from '../src/index'

function validRuleset(): Record<string, unknown> {
  return {
    name: 'Test',
    board: { shape: 'hex', radius: 2 },
    playerCount: 2,
    pieces: [
      {
        type: 'runner',
        movement: { pattern: 'step', range: 1 },
        capture: { rule: 'displace' },
      },
    ],
    setup: [
      { player: 0, type: 'runner', at: { q: -2, r: 0 } },
      { player: 1, type: 'runner', at: { q: 2, r: 0 } },
    ],
    win: { rule: 'lastPlayerStanding' },
  }
}

describe('loadRuleset', () => {
  it('accepts a valid ruleset', () => {
    const rs = loadRuleset(validRuleset())
    expect(rs.name).toBe('Test')
    expect(rs.board.radius).toBe(2)
  })

  it('rejects a setup coordinate off the board', () => {
    const bad = validRuleset()
    ;(bad.setup as { at: { q: number; r: number } }[])[0]!.at = { q: 3, r: 0 }
    expect(() => loadRuleset(bad)).toThrow(/off the board/i)
  })

  it('rejects a setup entry with an unknown piece type', () => {
    const bad = validRuleset()
    ;(bad.setup as { type: string }[])[0]!.type = 'dragon'
    expect(() => loadRuleset(bad)).toThrow(/unknown piece type/i)
  })

  it('rejects a setup player index out of range', () => {
    const bad = validRuleset()
    ;(bad.setup as { player: number }[])[0]!.player = 2
    expect(() => loadRuleset(bad)).toThrow(/player index/i)
  })

  it('rejects duplicate setup coordinates', () => {
    const bad = validRuleset()
    ;(bad.setup as { at: { q: number; r: number } }[])[1]!.at = { q: -2, r: 0 }
    expect(() => loadRuleset(bad)).toThrow(/duplicate/i)
  })

  it('rejects structurally invalid data', () => {
    expect(() => loadRuleset({ name: 'x' })).toThrow()
    expect(() => loadRuleset(null)).toThrow()
    const bad = validRuleset()
    ;(bad.board as { shape: string }).shape = 'square'
    expect(() => loadRuleset(bad)).toThrow()
  })
})

describe('placeholder ruleset', () => {
  it('loads and matches the brief: hex radius 3, 2 players, 3 runners each', () => {
    expect(placeholderRuleset.board).toEqual({ shape: 'hex', radius: 3 })
    expect(placeholderRuleset.playerCount).toBe(2)
    expect(placeholderRuleset.setup).toHaveLength(6)
    expect(placeholderRuleset.setup.filter((s) => s.player === 0)).toHaveLength(3)
    expect(placeholderRuleset.setup.filter((s) => s.player === 1)).toHaveLength(3)
  })
})

describe('initialState', () => {
  it('places all setup pieces with deterministic ids and starting player 0', () => {
    const state = initialState(placeholderRuleset)
    expect(state.seq).toBe(0)
    expect(state.currentPlayer).toBe(0)
    expect(state.winner).toBeNull()
    expect(state.pieces).toHaveLength(6)
    const p00 = state.pieces.find((p) => p.id === 'p0-0')
    expect(p00).toMatchObject({ owner: 0, type: 'runner', at: { q: -3, r: 0 } })
    const p12 = state.pieces.find((p) => p.id === 'p1-2')
    expect(p12).toMatchObject({ owner: 1, type: 'runner', at: { q: 3, r: -2 } })
    expect(state.ruleset).toBe(placeholderRuleset)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules test`
Expected: FAIL — `loadRuleset` (etc.) not exported.

- [ ] **Step 3: Implement**

`packages/rules/src/ruleset.ts`:

```ts
import { z } from 'zod'
import { coordKey, inRadius } from './coord'

const coordSchema = z.object({ q: z.number().int(), r: z.number().int() })

const pieceDefSchema = z.object({
  type: z.string().min(1),
  movement: z.object({
    pattern: z.literal('step'),
    range: z.number().int().positive(),
  }),
  capture: z.object({ rule: z.literal('displace') }),
})

export const rulesetSchema = z.object({
  name: z.string().min(1),
  board: z.object({ shape: z.literal('hex'), radius: z.number().int().positive() }),
  playerCount: z.number().int().min(2),
  pieces: z.array(pieceDefSchema).min(1),
  setup: z
    .array(z.object({ player: z.number().int().nonnegative(), type: z.string().min(1), at: coordSchema }))
    .min(1),
  win: z.object({ rule: z.literal('lastPlayerStanding') }),
})

export type Ruleset = z.infer<typeof rulesetSchema>
export type PieceDef = Ruleset['pieces'][number]

/** Parse + cross-validate a ruleset. Throws Error with a descriptive message. */
export function loadRuleset(data: unknown): Ruleset {
  const rs = rulesetSchema.parse(data)
  const types = new Set(rs.pieces.map((p) => p.type))
  const seen = new Set<string>()
  for (const [i, entry] of rs.setup.entries()) {
    if (!inRadius(entry.at, rs.board.radius))
      throw new Error(`setup[${i}] is off the board: ${coordKey(entry.at)}`)
    if (!types.has(entry.type))
      throw new Error(`setup[${i}] has unknown piece type "${entry.type}"`)
    if (entry.player >= rs.playerCount)
      throw new Error(`setup[${i}] player index ${entry.player} >= playerCount ${rs.playerCount}`)
    const key = coordKey(entry.at)
    if (seen.has(key)) throw new Error(`duplicate setup coordinate ${key}`)
    seen.add(key)
  }
  return rs
}
```

`packages/rules/src/rulesets/placeholder.json`:

```json
{
  "name": "Placeholder Hex Tactics",
  "board": { "shape": "hex", "radius": 3 },
  "playerCount": 2,
  "pieces": [
    {
      "type": "runner",
      "movement": { "pattern": "step", "range": 1 },
      "capture": { "rule": "displace" }
    }
  ],
  "setup": [
    { "player": 0, "type": "runner", "at": { "q": -3, "r": 0 } },
    { "player": 0, "type": "runner", "at": { "q": -3, "r": 1 } },
    { "player": 0, "type": "runner", "at": { "q": -3, "r": 2 } },
    { "player": 1, "type": "runner", "at": { "q": 3, "r": 0 } },
    { "player": 1, "type": "runner", "at": { "q": 3, "r": -1 } },
    { "player": 1, "type": "runner", "at": { "q": 3, "r": -2 } }
  ],
  "win": { "rule": "lastPlayerStanding" }
}
```

`packages/rules/src/placeholder.ts`:

```ts
import placeholderJson from './rulesets/placeholder.json'
import { loadRuleset, type Ruleset } from './ruleset'

export const placeholderRuleset: Ruleset = loadRuleset(placeholderJson)
```

`packages/rules/src/setup.ts`:

```ts
import type { GameState, Piece } from './state'
import type { Ruleset } from './ruleset'

/** Build the turn-zero GameState for a ruleset. Piece ids are `p{player}-{index}`. */
export function initialState(ruleset: Ruleset): GameState {
  const perPlayerCount = new Map<number, number>()
  const pieces: Piece[] = ruleset.setup.map((entry) => {
    const index = perPlayerCount.get(entry.player) ?? 0
    perPlayerCount.set(entry.player, index + 1)
    return { id: `p${entry.player}-${index}`, owner: entry.player, type: entry.type, at: entry.at }
  })
  return { ruleset, seq: 0, currentPlayer: 0, pieces, winner: null }
}
```

In `packages/rules/src/state.ts`, replace the temporary alias:

```ts
import type { Coord } from './coord'
import type { Ruleset } from './ruleset'
```

(delete the `type Ruleset = unknown` line; the rest of the file is unchanged.)

`packages/rules/src/index.ts`:

```ts
export * from './coord'
export * from './state'
export * from './ruleset'
export * from './placeholder'
export * from './setup'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meridian/rules test && pnpm --filter @meridian/rules lint`
Expected: PASS (both test files), lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/rules
git commit -m "feat(rules): zod ruleset format, placeholder hex-tactics ruleset, initial state"
```

---

### Task 4: `@meridian/rules` — legal moves and the `applyIntent` reducer

**Files:**
- Create: `packages/rules/src/intent.ts`, `packages/rules/src/moves.ts`, `packages/rules/src/apply-intent.ts`
- Modify: `packages/rules/src/index.ts`
- Test: `packages/rules/test/apply-intent.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–3.
- Produces:
  - `type Intent = MoveIntent | EndTurnIntent`; `MoveIntent { type: 'move'; player: PlayerId; pieceId: string; to: Coord }`; `EndTurnIntent { type: 'endTurn'; player: PlayerId }`
  - `type RuleErrorCode = 'GAME_OVER' | 'NOT_YOUR_TURN' | 'UNKNOWN_PIECE' | 'NOT_PIECE_OWNER' | 'OFF_BOARD' | 'OUT_OF_RANGE' | 'OCCUPIED_BY_FRIENDLY'`
  - `RuleError { error: true; code: RuleErrorCode; message: string }`, `ruleError(code, message): RuleError`, `isRuleError(v: unknown): v is RuleError`
  - `legalMoves(state: GameState, pieceId: string): Coord[]` — destinations on the board within the piece's range, excluding its own hex and friendly-occupied hexes (enemy-occupied hexes ARE legal: displace capture)
  - `applyIntent(state: GameState, intent: Intent): GameState | RuleError` — pure; Task 4 rotates turns naively (`(currentPlayer + 1) % playerCount`, `seq + 1`); Task 5 upgrades rotation/win.

- [ ] **Step 1: Write the failing test**

`packages/rules/test/apply-intent.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  applyIntent,
  coordKey,
  initialState,
  isRuleError,
  legalMoves,
  placeholderRuleset,
  type GameState,
} from '../src/index'

function fresh(): GameState {
  return initialState(placeholderRuleset)
}

function keys(coords: { q: number; r: number }[]): Set<string> {
  return new Set(coords.map(coordKey))
}

describe('legalMoves', () => {
  it('lists on-board, non-friendly neighbor hexes for a corner piece', () => {
    expect(keys(legalMoves(fresh(), 'p0-0'))).toEqual(new Set(['-2,0', '-2,-1']))
  })

  it('includes enemy-occupied hexes (capture) and excludes friendly ones', () => {
    const state = fresh()
    // Move p0-0 adjacent to p1-0 at (3,0) by teleporting the test state
    const rigged: GameState = {
      ...state,
      pieces: state.pieces.map((p) => (p.id === 'p0-0' ? { ...p, at: { q: 2, r: 0 } } : p)),
    }
    const moves = keys(legalMoves(rigged, 'p0-0'))
    expect(moves.has('3,0')).toBe(true) // enemy: capturable
    expect(moves.has('2,0')).toBe(false) // own hex never included
  })

  it('returns [] for an unknown piece id', () => {
    expect(legalMoves(fresh(), 'nope')).toEqual([])
  })
})

describe('applyIntent — legal moves', () => {
  it('moves a piece, increments seq, rotates the turn, leaves input untouched', () => {
    const state = fresh()
    const result = applyIntent(state, {
      type: 'move',
      player: 0,
      pieceId: 'p0-0',
      to: { q: -2, r: 0 },
    })
    if (isRuleError(result)) throw new Error(result.message)
    expect(result.pieces.find((p) => p.id === 'p0-0')?.at).toEqual({ q: -2, r: 0 })
    expect(result.seq).toBe(1)
    expect(result.currentPlayer).toBe(1)
    // input state untouched
    expect(state.pieces.find((p) => p.id === 'p0-0')?.at).toEqual({ q: -3, r: 0 })
    expect(state.seq).toBe(0)
  })

  it('captures by displacement: enemy piece removed, mover takes its hex', () => {
    const state = fresh()
    const rigged: GameState = {
      ...state,
      pieces: state.pieces.map((p) => (p.id === 'p0-0' ? { ...p, at: { q: 2, r: 0 } } : p)),
    }
    const result = applyIntent(rigged, {
      type: 'move',
      player: 0,
      pieceId: 'p0-0',
      to: { q: 3, r: 0 },
    })
    if (isRuleError(result)) throw new Error(result.message)
    expect(result.pieces.find((p) => p.id === 'p1-0')).toBeUndefined()
    expect(result.pieces.find((p) => p.id === 'p0-0')?.at).toEqual({ q: 3, r: 0 })
    expect(result.pieces).toHaveLength(5)
  })

  it('endTurn passes: rotates and increments seq without moving anything', () => {
    const result = applyIntent(fresh(), { type: 'endTurn', player: 0 })
    if (isRuleError(result)) throw new Error(result.message)
    expect(result.currentPlayer).toBe(1)
    expect(result.seq).toBe(1)
    expect(result.pieces).toHaveLength(6)
  })
})

describe('applyIntent — illegal intents (state never changes)', () => {
  const cases: { name: string; code: string; run: (s: GameState) => ReturnType<typeof applyIntent> }[] = [
    {
      name: 'out of turn',
      code: 'NOT_YOUR_TURN',
      run: (s) => applyIntent(s, { type: 'move', player: 1, pieceId: 'p1-0', to: { q: 2, r: 0 } }),
    },
    {
      name: 'unknown piece',
      code: 'UNKNOWN_PIECE',
      run: (s) => applyIntent(s, { type: 'move', player: 0, pieceId: 'ghost', to: { q: -2, r: 0 } }),
    },
    {
      name: "opponent's piece",
      code: 'NOT_PIECE_OWNER',
      run: (s) => applyIntent(s, { type: 'move', player: 0, pieceId: 'p1-0', to: { q: 2, r: 0 } }),
    },
    {
      name: 'destination off board',
      code: 'OFF_BOARD',
      run: (s) => applyIntent(s, { type: 'move', player: 0, pieceId: 'p0-0', to: { q: -4, r: 0 } }),
    },
    {
      name: 'destination beyond range',
      code: 'OUT_OF_RANGE',
      run: (s) => applyIntent(s, { type: 'move', player: 0, pieceId: 'p0-0', to: { q: -1, r: 0 } }),
    },
    {
      name: 'destination equals current hex',
      code: 'OUT_OF_RANGE',
      run: (s) => applyIntent(s, { type: 'move', player: 0, pieceId: 'p0-0', to: { q: -3, r: 0 } }),
    },
    {
      name: 'destination occupied by friendly piece',
      code: 'OCCUPIED_BY_FRIENDLY',
      run: (s) => applyIntent(s, { type: 'move', player: 0, pieceId: 'p0-0', to: { q: -3, r: 1 } }),
    },
  ]

  for (const c of cases) {
    it(`rejects ${c.name} with ${c.code}`, () => {
      const state = fresh()
      const result = c.run(state)
      if (!isRuleError(result)) throw new Error('expected RuleError')
      expect(result.code).toBe(c.code)
      expect(state.seq).toBe(0)
      expect(state.pieces).toHaveLength(6)
    })
  }

  it('rejects any intent once the game is over with GAME_OVER', () => {
    const done: GameState = { ...fresh(), winner: 1 }
    const result = applyIntent(done, { type: 'endTurn', player: 0 })
    if (!isRuleError(result)) throw new Error('expected RuleError')
    expect(result.code).toBe('GAME_OVER')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules test`
Expected: FAIL — `applyIntent`/`legalMoves`/`isRuleError` not exported.

- [ ] **Step 3: Implement**

`packages/rules/src/intent.ts`:

```ts
import type { Coord } from './coord'
import type { PlayerId } from './state'

export interface MoveIntent {
  type: 'move'
  player: PlayerId
  pieceId: string
  to: Coord
}

export interface EndTurnIntent {
  type: 'endTurn'
  player: PlayerId
}

export type Intent = MoveIntent | EndTurnIntent

export type RuleErrorCode =
  | 'GAME_OVER'
  | 'NOT_YOUR_TURN'
  | 'UNKNOWN_PIECE'
  | 'NOT_PIECE_OWNER'
  | 'OFF_BOARD'
  | 'OUT_OF_RANGE'
  | 'OCCUPIED_BY_FRIENDLY'

export interface RuleError {
  error: true
  code: RuleErrorCode
  message: string
}

export function ruleError(code: RuleErrorCode, message: string): RuleError {
  return { error: true, code, message }
}

export function isRuleError(v: unknown): v is RuleError {
  return typeof v === 'object' && v !== null && (v as { error?: unknown }).error === true
}
```

`packages/rules/src/moves.ts`:

```ts
import { coordsEqual, distance, inRadius, type Coord } from './coord'
import type { GameState } from './state'

/**
 * Destinations for a piece: on the board, within its movement range,
 * not its own hex, not friendly-occupied. Enemy-occupied hexes are
 * included — capture is by displacement.
 */
export function legalMoves(state: GameState, pieceId: string): Coord[] {
  const piece = state.pieces.find((p) => p.id === pieceId)
  if (!piece) return []
  const def = state.ruleset.pieces.find((d) => d.type === piece.type)
  if (!def) return []
  const range = def.movement.range
  const radius = state.ruleset.board.radius
  const out: Coord[] = []
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const c = { q, r }
      if (!inRadius(c, radius)) continue
      const d = distance(piece.at, c)
      if (d === 0 || d > range) continue
      const occupant = state.pieces.find((p) => coordsEqual(p.at, c))
      if (occupant && occupant.owner === piece.owner) continue
      out.push(c)
    }
  }
  return out
}
```

`packages/rules/src/apply-intent.ts`:

```ts
import { coordKey, coordsEqual, distance, inRadius } from './coord'
import { ruleError, type Intent, type RuleError } from './intent'
import type { GameState } from './state'

/** Naive rotation — replaced by win-aware advanceTurn in the win task. */
function advanceTurnNaive(state: GameState): GameState {
  return {
    ...state,
    seq: state.seq + 1,
    currentPlayer: (state.currentPlayer + 1) % state.ruleset.playerCount,
  }
}

/** Pure reducer: returns a new state or a RuleError; never mutates input. */
export function applyIntent(state: GameState, intent: Intent): GameState | RuleError {
  if (state.winner !== null) return ruleError('GAME_OVER', 'the match is already decided')
  if (intent.player !== state.currentPlayer)
    return ruleError('NOT_YOUR_TURN', `it is player ${state.currentPlayer}'s turn`)

  if (intent.type === 'endTurn') return advanceTurnNaive(state)

  const piece = state.pieces.find((p) => p.id === intent.pieceId)
  if (!piece) return ruleError('UNKNOWN_PIECE', `no piece "${intent.pieceId}"`)
  if (piece.owner !== intent.player)
    return ruleError('NOT_PIECE_OWNER', `piece "${piece.id}" belongs to player ${piece.owner}`)

  const def = state.ruleset.pieces.find((d) => d.type === piece.type)
  if (!def) return ruleError('UNKNOWN_PIECE', `no piece definition for type "${piece.type}"`)

  if (!inRadius(intent.to, state.ruleset.board.radius))
    return ruleError('OFF_BOARD', `${coordKey(intent.to)} is off the board`)

  const d = distance(piece.at, intent.to)
  if (d === 0 || d > def.movement.range)
    return ruleError('OUT_OF_RANGE', `${coordKey(intent.to)} is out of range for "${piece.type}"`)

  const occupant = state.pieces.find((p) => coordsEqual(p.at, intent.to))
  if (occupant && occupant.owner === intent.player)
    return ruleError('OCCUPIED_BY_FRIENDLY', `${coordKey(intent.to)} is occupied by your own piece`)

  const pieces = state.pieces
    .filter((p) => p !== occupant)
    .map((p) => (p.id === piece.id ? { ...p, at: intent.to } : p))

  return advanceTurnNaive({ ...state, pieces })
}
```

Add to `packages/rules/src/index.ts`:

```ts
export * from './intent'
export * from './moves'
export * from './apply-intent'
```

(Do NOT re-export `isRuleError` from `apply-intent.ts` — the barrel's `export * from './intent'` is the canonical source, and a duplicate star-exported name would become ambiguous and silently dropped by TypeScript.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meridian/rules test && pnpm --filter @meridian/rules lint`
Expected: PASS (all three test files), lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/rules
git commit -m "feat(rules): legalMoves and pure applyIntent reducer with exhaustive illegal-intent tests"
```

---

### Task 5: `@meridian/rules` — win detection and turn rotation

**Files:**
- Create: `packages/rules/src/win.ts`
- Modify: `packages/rules/src/apply-intent.ts` (use `advanceTurn` from win.ts; delete `advanceTurnNaive`), `packages/rules/src/index.ts`
- Test: `packages/rules/test/win.test.ts`

**Interfaces:**
- Consumes: `GameState`, `applyIntent` from Task 4.
- Produces: `advanceTurn(state: GameState): GameState` — increments `seq`; sets `winner` when exactly one player still owns pieces (lastPlayerStanding); rotates `currentPlayer` to the next player index (mod playerCount) that still owns at least one piece; if a winner is set, `currentPlayer` is left unchanged. `applyIntent` now routes all state transitions through it.

- [ ] **Step 1: Write the failing test**

`packages/rules/test/win.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  advanceTurn,
  applyIntent,
  initialState,
  isRuleError,
  loadRuleset,
  placeholderRuleset,
  type GameState,
} from '../src/index'

/** State where player 1 has a single piece adjacent to a player-0 piece. */
function nearWinState(): GameState {
  const base = initialState(placeholderRuleset)
  return {
    ...base,
    pieces: [
      { id: 'p0-0', owner: 0, type: 'runner', at: { q: 0, r: 0 } },
      { id: 'p1-0', owner: 1, type: 'runner', at: { q: 1, r: 0 } },
    ],
  }
}

describe('win detection', () => {
  it('capturing the last enemy piece sets the winner', () => {
    const result = applyIntent(nearWinState(), {
      type: 'move',
      player: 0,
      pieceId: 'p0-0',
      to: { q: 1, r: 0 },
    })
    if (isRuleError(result)) throw new Error(result.message)
    expect(result.winner).toBe(0)
    expect(result.pieces).toHaveLength(1)
  })

  it('a non-final capture does not set a winner', () => {
    const state = initialState(placeholderRuleset)
    const rigged: GameState = {
      ...state,
      pieces: state.pieces.map((p) => (p.id === 'p0-0' ? { ...p, at: { q: 2, r: 0 } } : p)),
    }
    const result = applyIntent(rigged, { type: 'move', player: 0, pieceId: 'p0-0', to: { q: 3, r: 0 } })
    if (isRuleError(result)) throw new Error(result.message)
    expect(result.winner).toBeNull()
  })

  it('after a win, further intents are rejected with GAME_OVER', () => {
    const won = applyIntent(nearWinState(), {
      type: 'move',
      player: 0,
      pieceId: 'p0-0',
      to: { q: 1, r: 0 },
    })
    if (isRuleError(won)) throw new Error(won.message)
    const after = applyIntent(won, { type: 'endTurn', player: won.currentPlayer })
    if (!isRuleError(after)) throw new Error('expected RuleError')
    expect(after.code).toBe('GAME_OVER')
  })
})

describe('turn rotation', () => {
  it('rotation skips eliminated players (3-player ruleset)', () => {
    const three = loadRuleset({
      name: 'Three',
      board: { shape: 'hex', radius: 3 },
      playerCount: 3,
      pieces: [
        { type: 'runner', movement: { pattern: 'step', range: 1 }, capture: { rule: 'displace' } },
      ],
      setup: [
        { player: 0, type: 'runner', at: { q: -3, r: 0 } },
        { player: 1, type: 'runner', at: { q: 3, r: 0 } },
        { player: 2, type: 'runner', at: { q: 0, r: 3 } },
      ],
      win: { rule: 'lastPlayerStanding' },
    })
    const base = initialState(three)
    // Player 1 eliminated: remove their piece; players 0 and 2 remain.
    const state: GameState = { ...base, pieces: base.pieces.filter((p) => p.owner !== 1) }
    const next = advanceTurn(state)
    expect(next.currentPlayer).toBe(2)
    expect(next.seq).toBe(1)
    expect(next.winner).toBeNull()
  })

  it('two live players rotate 0 -> 1 -> 0', () => {
    const s0 = initialState(placeholderRuleset)
    const s1 = advanceTurn(s0)
    expect(s1.currentPlayer).toBe(1)
    const s2 = advanceTurn(s1)
    expect(s2.currentPlayer).toBe(0)
    expect(s2.seq).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meridian/rules test`
Expected: FAIL — `advanceTurn` not exported (and the GAME_OVER-after-win test fails since naive rotation never sets winner).

- [ ] **Step 3: Implement**

`packages/rules/src/win.ts`:

```ts
import type { GameState, PlayerId } from './state'

function playersWithPieces(state: GameState): Set<PlayerId> {
  return new Set(state.pieces.map((p) => p.owner))
}

/**
 * Advance to the next turn: bump seq, detect lastPlayerStanding, rotate to
 * the next player that still owns pieces. When a winner is set the
 * currentPlayer is left as-is (no further turns exist).
 */
export function advanceTurn(state: GameState): GameState {
  const alive = playersWithPieces(state)
  const winner = alive.size === 1 ? [...alive][0]! : null
  if (winner !== null) return { ...state, seq: state.seq + 1, winner }

  const n = state.ruleset.playerCount
  let next = (state.currentPlayer + 1) % n
  while (!alive.has(next)) next = (next + 1) % n
  return { ...state, seq: state.seq + 1, currentPlayer: next }
}
```

In `packages/rules/src/apply-intent.ts`: add `import { advanceTurn } from './win'`, delete the `advanceTurnNaive` function, and replace both call sites (`advanceTurnNaive(state)` for endTurn, `advanceTurnNaive({ ...state, pieces })` for moves) with `advanceTurn(...)`.

Add to `packages/rules/src/index.ts`:

```ts
export * from './win'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meridian/rules test && pnpm --filter @meridian/rules lint`
Expected: PASS (all four test files), lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/rules
git commit -m "feat(rules): lastPlayerStanding win detection and elimination-aware turn rotation"
```

---

### Task 6: `@meridian/protocol` — boundary message schemas

**Files:**
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/vitest.config.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/protocol.test.ts`

**Interfaces:**
- Consumes: nothing at runtime (zod only). Type-compatibility with `@meridian/rules` intents is asserted in tests.
- Produces: `@meridian/protocol` exporting:
  - `MSG = { INTENT: 'intent', RULE_ERROR: 'ruleError', SNAPSHOT: 'snapshot', MATCH_ENDED: 'matchEnded' } as const`
  - `clientIntentSchema` (discriminated union: `{type:'move', pieceId, to:{q,r}}` | `{type:'endTurn'}`) and `type ClientIntent` — **no `player` field**: the server derives the seat from the connection, never trusts the client
  - `ruleErrorPayloadSchema` `{ code: string, message: string }`, `type RuleErrorPayload`
  - `matchEndedPayloadSchema` `{ reason: 'win' | 'forfeit', winner: number }`, `type MatchEndedPayload`
  - State-sync schemas are deliberately absent — Colyseus schema owns state sync (spec §5).

- [ ] **Step 1: Create package scaffolding**

`packages/protocol/package.json`:

```json
{
  "name": "@meridian/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": {
    "@meridian/rules": "workspace:*",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

(`@meridian/rules` is a devDependency: used only by the type-compatibility test.)

`packages/protocol/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/protocol/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

- [ ] **Step 2: Write the failing test**

`packages/protocol/test/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Intent, PlayerId } from '@meridian/rules'
import {
  MSG,
  clientIntentSchema,
  matchEndedPayloadSchema,
  ruleErrorPayloadSchema,
  type ClientIntent,
} from '../src/index'

describe('clientIntentSchema', () => {
  it('accepts a move intent', () => {
    const parsed = clientIntentSchema.parse({
      type: 'move',
      pieceId: 'p0-0',
      to: { q: -2, r: 0 },
    })
    expect(parsed.type).toBe('move')
  })

  it('accepts an endTurn intent', () => {
    expect(clientIntentSchema.parse({ type: 'endTurn' }).type).toBe('endTurn')
  })

  it('rejects a client-supplied player field', () => {
    const r = clientIntentSchema.safeParse({
      type: 'endTurn',
      player: 1,
    })
    // strict schema: unknown keys rejected so clients cannot smuggle a seat
    expect(r.success).toBe(false)
  })

  it('rejects malformed payloads', () => {
    expect(clientIntentSchema.safeParse({ type: 'move' }).success).toBe(false)
    expect(clientIntentSchema.safeParse({ type: 'move', pieceId: '', to: { q: 0, r: 0 } }).success).toBe(false)
    expect(clientIntentSchema.safeParse({ type: 'teleport', pieceId: 'x', to: { q: 0, r: 0 } }).success).toBe(false)
    expect(clientIntentSchema.safeParse({ type: 'move', pieceId: 'x', to: { q: 0.5, r: 0 } }).success).toBe(false)
    expect(clientIntentSchema.safeParse(null).success).toBe(false)
  })

  it('a parsed ClientIntent plus a server seat is a valid engine Intent (compile-time)', () => {
    const clientIntent: ClientIntent = { type: 'endTurn' }
    const seat: PlayerId = 0
    const engineIntent: Intent = { ...clientIntent, player: seat }
    expect(engineIntent.player).toBe(0)
  })
})

describe('server payload schemas', () => {
  it('validates rule error payloads', () => {
    expect(
      ruleErrorPayloadSchema.parse({ code: 'NOT_YOUR_TURN', message: 'wait' }).code,
    ).toBe('NOT_YOUR_TURN')
    expect(ruleErrorPayloadSchema.safeParse({ code: 'X' }).success).toBe(false)
  })

  it('validates match ended payloads', () => {
    expect(matchEndedPayloadSchema.parse({ reason: 'forfeit', winner: 1 }).reason).toBe('forfeit')
    expect(matchEndedPayloadSchema.safeParse({ reason: 'ragequit', winner: 1 }).success).toBe(false)
  })

  it('exposes stable message-type names', () => {
    expect(MSG).toEqual({
      INTENT: 'intent',
      RULE_ERROR: 'ruleError',
      SNAPSHOT: 'snapshot',
      MATCH_ENDED: 'matchEnded',
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm install && pnpm --filter @meridian/protocol test`
Expected: FAIL — cannot resolve `../src/index`.

- [ ] **Step 4: Implement**

`packages/protocol/src/index.ts`:

```ts
import { z } from 'zod'

/** Message-type names shared by client and server. */
export const MSG = {
  INTENT: 'intent',
  RULE_ERROR: 'ruleError',
  SNAPSHOT: 'snapshot',
  MATCH_ENDED: 'matchEnded',
} as const

const coordSchema = z.object({ q: z.number().int(), r: z.number().int() }).strict()

/**
 * Client -> server intents. Deliberately has NO player field: the server
 * derives the seat from the connection. Strict: unknown keys are rejected.
 */
export const clientIntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), pieceId: z.string().min(1), to: coordSchema }).strict(),
  z.object({ type: z.literal('endTurn') }).strict(),
])
export type ClientIntent = z.infer<typeof clientIntentSchema>

export const ruleErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
})
export type RuleErrorPayload = z.infer<typeof ruleErrorPayloadSchema>

export const matchEndedPayloadSchema = z.object({
  reason: z.enum(['win', 'forfeit']),
  winner: z.number().int().nonnegative(),
})
export type MatchEndedPayload = z.infer<typeof matchEndedPayloadSchema>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @meridian/protocol test && pnpm --filter @meridian/protocol lint`
Expected: PASS (8 tests), lint clean.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): zod intent and server-payload schemas shared across the boundary"
```

---

### Task 7: `apps/server` — scaffold, Colyseus schema mirror

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`, `apps/server/src/schema/MatchState.ts`
- Test: `apps/server/test/sync.test.ts`

**Interfaces:**
- Consumes: `GameState`, `initialState`, `placeholderRuleset`, `applyIntent`, `isRuleError` from `@meridian/rules`.
- Produces: `PieceSchema` (`id: string`, `owner: number`, `pieceType: string`, `q: number`, `r: number`), `MatchState` (`phase: string` — `'waiting' | 'playing' | 'ended'`, `currentPlayer: number`, `winner: number` — `-1` for none, `seq: number`, `pieces: MapSchema<PieceSchema>` keyed by piece id, `seats: ArraySchema<string>` of sessionIds by seat), and `syncFromGameState(target: MatchState, gs: GameState): void` which reconciles scalars and the pieces map (upsert current pieces, delete captured ones). Later tasks rely on these exact names.

- [ ] **Step 1: Create package scaffolding**

`apps/server/package.json`:

```json
{
  "name": "server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@colyseus/schema": "^3.0.0",
    "@colyseus/tools": "^0.16.0",
    "@meridian/protocol": "workspace:*",
    "@meridian/rules": "workspace:*",
    "colyseus": "^0.16.0"
  },
  "devDependencies": {
    "@colyseus/testing": "^0.16.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`apps/server/tsconfig.json` (`@colyseus/schema` decorators need these two compiler flags):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "experimentalDecorators": true,
    "useDefineForClassFields": false
  },
  "include": ["src", "test"]
}
```

`apps/server/vitest.config.ts` (integration tests boot one game server — no parallel files; generous timeout for reconnection tests):

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { environment: 'node', fileParallelism: false, testTimeout: 20000 },
})
```

- [ ] **Step 2: Write the failing test**

`apps/server/test/sync.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyIntent, initialState, isRuleError, placeholderRuleset } from '@meridian/rules'
import { MatchState, syncFromGameState } from '../src/schema/MatchState'

describe('syncFromGameState', () => {
  it('mirrors scalars and all pieces of the initial state', () => {
    const gs = initialState(placeholderRuleset)
    const schema = new MatchState()
    syncFromGameState(schema, gs)
    expect(schema.seq).toBe(0)
    expect(schema.currentPlayer).toBe(0)
    expect(schema.winner).toBe(-1)
    expect(schema.pieces.size).toBe(6)
    const p00 = schema.pieces.get('p0-0')
    expect(p00).toBeDefined()
    expect(p00!.owner).toBe(0)
    expect(p00!.pieceType).toBe('runner')
    expect(p00!.q).toBe(-3)
    expect(p00!.r).toBe(0)
  })

  it('re-sync after a capture removes the captured piece and moves the capturer', () => {
    const gs0 = initialState(placeholderRuleset)
    const rigged = {
      ...gs0,
      pieces: gs0.pieces.map((p) => (p.id === 'p0-0' ? { ...p, at: { q: 2, r: 0 } } : p)),
    }
    const schema = new MatchState()
    syncFromGameState(schema, rigged)
    expect(schema.pieces.size).toBe(6)

    const gs1 = applyIntent(rigged, { type: 'move', player: 0, pieceId: 'p0-0', to: { q: 3, r: 0 } })
    if (isRuleError(gs1)) throw new Error(gs1.message)
    syncFromGameState(schema, gs1)
    expect(schema.pieces.size).toBe(5)
    expect(schema.pieces.get('p1-0')).toBeUndefined()
    expect(schema.pieces.get('p0-0')!.q).toBe(3)
    expect(schema.seq).toBe(1)
    expect(schema.currentPlayer).toBe(1)
  })

  it('mirrors a decided winner', () => {
    const gs = { ...initialState(placeholderRuleset), winner: 1 }
    const schema = new MatchState()
    syncFromGameState(schema, gs)
    expect(schema.winner).toBe(1)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm install && pnpm --filter server test`
Expected: FAIL — cannot resolve `../src/schema/MatchState`.

- [ ] **Step 4: Implement**

`apps/server/src/schema/MatchState.ts`:

```ts
import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema'
import type { GameState } from '@meridian/rules'

export class PieceSchema extends Schema {
  @type('string') id = ''
  @type('number') owner = 0
  @type('string') pieceType = ''
  @type('number') q = 0
  @type('number') r = 0
}

export class MatchState extends Schema {
  @type('string') phase: 'waiting' | 'playing' | 'ended' = 'waiting'
  @type('number') currentPlayer = 0
  /** -1 = no winner yet (schema numbers cannot be null) */
  @type('number') winner = -1
  @type('number') seq = 0
  @type({ map: PieceSchema }) pieces = new MapSchema<PieceSchema>()
  /** sessionIds by seat index */
  @type(['string']) seats = new ArraySchema<string>()
}

/** Mirror the authoritative plain GameState into the synced schema tree. */
export function syncFromGameState(target: MatchState, gs: GameState): void {
  target.currentPlayer = gs.currentPlayer
  target.winner = gs.winner ?? -1
  target.seq = gs.seq

  const liveIds = new Set<string>()
  for (const piece of gs.pieces) {
    liveIds.add(piece.id)
    let entry = target.pieces.get(piece.id)
    if (!entry) {
      entry = new PieceSchema()
      target.pieces.set(piece.id, entry)
    }
    entry.id = piece.id
    entry.owner = piece.owner
    entry.pieceType = piece.type
    entry.q = piece.at.q
    entry.r = piece.at.r
  }
  for (const key of [...target.pieces.keys()]) {
    if (!liveIds.has(key)) target.pieces.delete(key)
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter server test && pnpm --filter server lint`
Expected: PASS (3 tests), lint clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): colyseus schema mirror of the pure GameState"
```

---

### Task 8: `apps/server` — MatchRoom: join-code lobby and the authoritative loop

**Files:**
- Create: `apps/server/src/room-id.ts`, `apps/server/src/rooms/MatchRoom.ts`, `apps/server/src/app.config.ts`, `apps/server/src/index.ts`
- Test: `apps/server/test/match-room.test.ts`

**Interfaces:**
- Consumes: `MatchState`, `syncFromGameState` (Task 7); `applyIntent`, `initialState`, `isRuleError`, `placeholderRuleset` from `@meridian/rules`; `MSG`, `clientIntentSchema` from `@meridian/protocol`.
- Produces: `MatchRoom` registered as `'match'`; room ids are unique 4-letter A–Z join codes; `appConfig` default export (`apps/server/src/app.config.ts`) consumed by `@colyseus/testing`'s `boot()` and by `src/index.ts`; room creation option `{ graceSeconds?: number }` (default 60) that Task 9's reconnection uses. Behavior later tasks rely on: seat = join order (0, 1); on the 2nd join phase flips to `'playing'`, the initial placeholder GameState is created and mirrored, and the room locks; every `MSG.INTENT` is zod-validated then engine-validated; errors go back only to the sender on `MSG.RULE_ERROR`; wins broadcast `MSG.MATCH_ENDED { reason: 'win', winner }` and set phase `'ended'`.

- [ ] **Step 1: Write the failing test**

`apps/server/test/match-room.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as ClientRoom } from 'colyseus.js'
import appConfig from '../src/app.config'
import type { MatchState } from '../src/schema/MatchState'

let server: ColyseusTestServer

beforeAll(async () => {
  server = await boot(appConfig)
})
afterAll(async () => {
  await server.shutdown()
})
afterEach(async () => {
  await server.cleanup()
})

/** Register a promise for one message BEFORE triggering it. */
function nextMessage<T>(client: ClientRoom, type: string): Promise<T> {
  return new Promise((resolve) => client.onMessage(type, (payload: T) => resolve(payload)))
}

/** Swallow messages we are not asserting on, keeping test output clean. */
function muteUnhandled(client: ClientRoom): void {
  client.onMessage('*', () => undefined)
}

async function createMatch() {
  const room = await server.createRoom<MatchState>('match', {})
  const c0 = await server.connectTo(room)
  muteUnhandled(c0)
  const c1 = await server.sdk.joinById(room.roomId)
  muteUnhandled(c1)
  await room.waitForNextPatch()
  return { room, c0, c1 }
}

describe('lobby', () => {
  it('room id is a 4-letter join code and a second client can join by it', async () => {
    const { room, c1 } = await createMatch()
    expect(room.roomId).toMatch(/^[A-Z]{4}$/)
    expect(c1.roomId).toBe(room.roomId)
    expect(room.state.phase).toBe('playing')
    expect(room.state.seats.length).toBe(2)
    expect(room.state.pieces.size).toBe(6)
  })

  it('a third client cannot join (room locked at 2)', async () => {
    const { room } = await createMatch()
    await expect(server.sdk.joinById(room.roomId)).rejects.toThrow()
  })
})

describe('authoritative loop', () => {
  it('a valid intent from the current player advances shared state', async () => {
    const { room, c0 } = await createMatch()
    c0.send('intent', { type: 'move', pieceId: 'p0-0', to: { q: -2, r: 0 } })
    await room.waitForNextPatch()
    expect(room.state.seq).toBe(1)
    expect(room.state.currentPlayer).toBe(1)
    expect(room.state.pieces.get('p0-0')!.q).toBe(-2)
  })

  it('an out-of-turn intent is rejected to the sender only; state unchanged', async () => {
    const { room, c1 } = await createMatch()
    const errPromise = nextMessage<{ code: string }>(c1, 'ruleError')
    c1.send('intent', { type: 'move', pieceId: 'p1-0', to: { q: 2, r: 0 } })
    const err = await errPromise
    expect(err.code).toBe('NOT_YOUR_TURN')
    expect(room.state.seq).toBe(0)
  })

  it('a malformed message is rejected at the protocol boundary', async () => {
    const { room, c0 } = await createMatch()
    const errPromise = nextMessage<{ code: string }>(c0, 'ruleError')
    c0.send('intent', { type: 'teleport', anywhere: true })
    const err = await errPromise
    expect(err.code).toBe('BAD_MESSAGE')
    expect(room.state.seq).toBe(0)
  })

  it('two clients complete a scripted full match to a win', async () => {
    const { room, c0, c1 } = await createMatch()
    const ended = nextMessage<{ reason: string; winner: number }>(c0, 'matchEnded')

    // Seat 0 marches p0-0 from (-3,0) across the board and captures all three
    // of seat 1's pieces; seat 1 passes every turn.
    const path = [
      { q: -2, r: 0 },
      { q: -1, r: 0 },
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },   // captures p1-0
      { q: 3, r: -1 },  // captures p1-1
      { q: 3, r: -2 },  // captures p1-2
    ]
    for (const to of path) {
      c0.send('intent', { type: 'move', pieceId: 'p0-0', to })
      await room.waitForNextPatch()
      if (room.state.winner !== -1) break
      c1.send('intent', { type: 'endTurn' })
      await room.waitForNextPatch()
    }

    const result = await ended
    expect(result).toEqual({ reason: 'win', winner: 0 })
    expect(room.state.phase).toBe('ended')
    expect(room.state.winner).toBe(0)
    expect(room.state.pieces.size).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test`
Expected: FAIL — cannot resolve `../src/app.config`.

- [ ] **Step 3: Implement**

`apps/server/src/room-id.ts`:

```ts
import type { Presence } from 'colyseus'

const CODE_KEY = 'meridian:roomIds'
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function randomCode(): string {
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return code
}

/** Reserve a unique 4-letter join code via the shared presence set. */
export async function generateRoomId(presence: Presence): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = randomCode()
    const added = await presence.sadd(CODE_KEY, code)
    if (added) return code
  }
  throw new Error('could not allocate a unique room code')
}

export async function releaseRoomId(presence: Presence, code: string): Promise<void> {
  await presence.srem(CODE_KEY, code)
}
```

`apps/server/src/rooms/MatchRoom.ts`:

```ts
import { Room, type Client } from 'colyseus'
import {
  applyIntent,
  initialState,
  isRuleError,
  placeholderRuleset,
  type GameState,
} from '@meridian/rules'
import { MSG, clientIntentSchema } from '@meridian/protocol'
import { MatchState, syncFromGameState } from '../schema/MatchState'
import { generateRoomId, releaseRoomId } from '../room-id'

interface CreateOptions {
  graceSeconds?: number
}

export class MatchRoom extends Room<MatchState> {
  maxClients = 2

  private game: GameState | null = null
  private graceSeconds = 60

  async onCreate(options: CreateOptions) {
    this.roomId = await generateRoomId(this.presence)
    this.graceSeconds = options.graceSeconds ?? 60
    this.setState(new MatchState())

    this.onMessage(MSG.INTENT, (client, raw: unknown) => this.handleIntent(client, raw))
  }

  onJoin(client: Client) {
    this.state.seats.push(client.sessionId)
    if (this.state.seats.length === 2) {
      this.game = initialState(placeholderRuleset)
      this.state.phase = 'playing'
      syncFromGameState(this.state, this.game)
      this.lock()
    }
  }

  private seatOf(client: Client): number {
    return this.state.seats.findIndex((s) => s === client.sessionId)
  }

  private handleIntent(client: Client, raw: unknown) {
    const parsed = clientIntentSchema.safeParse(raw)
    if (!parsed.success) {
      client.send(MSG.RULE_ERROR, { code: 'BAD_MESSAGE', message: 'malformed intent' })
      return
    }
    if (this.state.phase !== 'playing' || !this.game) {
      client.send(MSG.RULE_ERROR, { code: 'NOT_PLAYING', message: 'match is not in progress' })
      return
    }
    const seat = this.seatOf(client)
    const result = applyIntent(this.game, { ...parsed.data, player: seat })
    if (isRuleError(result)) {
      client.send(MSG.RULE_ERROR, { code: result.code, message: result.message })
      return
    }
    this.game = result
    syncFromGameState(this.state, this.game)
    if (this.game.winner !== null) {
      this.state.phase = 'ended'
      this.broadcast(MSG.MATCH_ENDED, { reason: 'win', winner: this.game.winner })
    }
  }

  async onLeave(client: Client, consented: boolean) {
    // Reconnection handling lands in the next task; for now a leave during
    // play simply keeps the seat (sessionId stays in seats).
    void client
    void consented
  }

  async onDispose() {
    await releaseRoomId(this.presence, this.roomId)
  }
}
```

`apps/server/src/app.config.ts`:

```ts
import config from '@colyseus/tools'
import { MatchRoom } from './rooms/MatchRoom'

export default config({
  initializeGameServer: (gameServer) => {
    gameServer.define('match', MatchRoom)
  },
})
```

`apps/server/src/index.ts`:

```ts
import { listen } from '@colyseus/tools'
import appConfig from './app.config'

const port = Number(process.env.PORT ?? 2567)
void listen(appConfig, port)
```

(If the installed `@colyseus/tools` exports `listen` differently — e.g. default-only —, adapt: the requirement is `pnpm --filter server dev` starts a server on the port. Report the deviation.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test && pnpm --filter server lint`
Expected: PASS (both server test files: 3 sync + 6 room tests), lint clean, no unhandled-message warnings in output.

- [ ] **Step 5: Smoke-run the real server**

Run: `pnpm --filter server start` (then Ctrl-C / kill after the listening line appears)
Expected: Colyseus prints its listening banner on :2567 with no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): MatchRoom with join-code lobby and engine-validated authoritative loop"
```

---

### Task 9: `apps/server` — reconnection and forfeit

**Files:**
- Modify: `apps/server/src/rooms/MatchRoom.ts` (replace the `onLeave` stub)
- Test: `apps/server/test/reconnection.test.ts`

**Interfaces:**
- Consumes: everything from Task 8.
- Produces: mid-match disconnects hold the seat for `graceSeconds` via `allowReconnection`; a client that reconnects with its reconnection token gets the same seat, a converged schema state, and a `MSG.SNAPSHOT` message carrying the full plain `GameState`; if the grace window expires the opponent wins by forfeit (`MSG.MATCH_ENDED { reason: 'forfeit', winner }`, phase `'ended'`, schema winner set). Consented leaves and leaves outside `'playing'` end reconnection eligibility immediately.

- [ ] **Step 1: Write the failing test**

`apps/server/test/reconnection.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as ClientRoom } from 'colyseus.js'
import appConfig from '../src/app.config'
import type { MatchState } from '../src/schema/MatchState'

let server: ColyseusTestServer

beforeAll(async () => {
  server = await boot(appConfig)
})
afterAll(async () => {
  await server.shutdown()
})
afterEach(async () => {
  await server.cleanup()
})

function nextMessage<T>(client: ClientRoom, type: string): Promise<T> {
  return new Promise((resolve) => client.onMessage(type, (payload: T) => resolve(payload)))
}

function muteUnhandled(client: ClientRoom): void {
  client.onMessage('*', () => undefined)
}

async function createMatch(graceSeconds: number) {
  const room = await server.createRoom<MatchState>('match', { graceSeconds })
  const c0 = await server.connectTo(room)
  muteUnhandled(c0)
  const c1 = await server.sdk.joinById(room.roomId)
  muteUnhandled(c1)
  await room.waitForNextPatch()
  return { room, c0, c1 }
}

describe('reconnection', () => {
  it('a dropped client reconnects to the same seat and converged state', async () => {
    const { room, c0, c1 } = await createMatch(5)

    // Advance the match one move so the rejoining client must converge.
    c0.send('intent', { type: 'move', pieceId: 'p0-0', to: { q: -2, r: 0 } })
    await room.waitForNextPatch()

    const token = c1.reconnectionToken
    await c1.leave(false) // simulate a drop (non-consented)

    const c1b = await server.sdk.reconnect(token)
    muteUnhandled(c1b)
    const snapshot = nextMessage<{ state: { seq: number } }>(c1b, 'snapshot')
    await c1b.waitForNextPatch?.()

    // Same seat, converged authoritative state.
    expect(c1b.sessionId).toBe(room.state.seats[1])
    const snap = await snapshot
    expect(snap.state.seq).toBe(1)
    expect(room.state.phase).toBe('playing')

    // The reconnected client can act when it is their turn.
    c1b.send('intent', { type: 'move', pieceId: 'p1-0', to: { q: 2, r: 0 } })
    await room.waitForNextPatch()
    expect(room.state.seq).toBe(2)
  })

  it('an expired grace window forfeits the match to the opponent', async () => {
    const { room, c0, c1 } = await createMatch(1)
    const ended = nextMessage<{ reason: string; winner: number }>(c0, 'matchEnded')

    await c1.leave(false)

    const result = await ended
    expect(result).toEqual({ reason: 'forfeit', winner: 0 })
    expect(room.state.phase).toBe('ended')
    expect(room.state.winner).toBe(0)
  })

  it('a consented leave mid-match forfeits immediately', async () => {
    const { room, c0, c1 } = await createMatch(30)
    const ended = nextMessage<{ reason: string; winner: number }>(c0, 'matchEnded')

    await c1.leave(true) // consented: no reconnection window

    const result = await ended
    expect(result).toEqual({ reason: 'forfeit', winner: 0 })
    expect(room.state.phase).toBe('ended')
  })
})
```

(Note on `c1b.waitForNextPatch?.()`: the testing SDK's client room exposes `waitForNextPatch` in current versions; the optional call keeps the test resilient if only the server-side room has it — the snapshot await is the real synchronization point.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test`
Expected: FAIL — reconnect rejects / forfeit messages never arrive (onLeave stub does nothing).

- [ ] **Step 3: Implement**

Replace the `onLeave` stub in `apps/server/src/rooms/MatchRoom.ts` with:

```ts
  async onLeave(client: Client, consented: boolean) {
    if (this.state.phase !== 'playing') return

    if (!consented) {
      try {
        await this.allowReconnection(client, this.graceSeconds)
        // Same sessionId, same seat. Schema sync converges the client;
        // the snapshot is the belt-and-braces full-state resend (spec §4).
        if (this.game) client.send(MSG.SNAPSHOT, { state: this.game })
        return
      } catch {
        // grace window expired — fall through to forfeit
      }
    }

    const seat = this.seatOf(client)
    const winner = seat === 0 ? 1 : 0
    this.state.phase = 'ended'
    this.state.winner = winner
    this.broadcast(MSG.MATCH_ENDED, { reason: 'forfeit', winner })
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test && pnpm --filter server lint`
Expected: PASS (all three server test files), lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): reconnection with grace window, snapshot resend, and forfeit"
```

---

### Task 10: `apps/client` stub, README, workspace wrap-up

**Files:**
- Create: `apps/client/package.json`, `apps/client/tsconfig.json`, `apps/client/vite.config.ts`, `apps/client/vitest.config.ts`, `apps/client/index.html`, `apps/client/src/main.tsx`, `apps/client/src/App.tsx`
- Test: `apps/client/test/smoke.test.tsx`
- Modify: `README.md` (replace the Task 1 placeholder)

**Interfaces:**
- Consumes: nothing from other packages yet (plan 2 wires `@meridian/rules` + colyseus.js into the client).
- Produces: `pnpm --filter client dev` serves an R3F canvas placeholder; `pnpm turbo run lint test build --force` is green across all four packages.

- [ ] **Step 1: Create the client stub**

`apps/client/package.json`:

```json
{
  "name": "client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@react-three/fiber": "^8.17.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "three": "^0.169.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/three": "^0.169.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

`apps/client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"]
}
```

`apps/client/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
})
```

`apps/client/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

`apps/client/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Meridian</title>
    <style>
      html, body, #root { margin: 0; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/client/src/App.tsx`:

```tsx
import { Canvas } from '@react-three/fiber'

export function App() {
  return (
    <Canvas camera={{ position: [0, 2, 4] }}>
      <ambientLight intensity={0.6} />
      <mesh rotation={[0.4, 0.6, 0]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshNormalMaterial />
      </mesh>
    </Canvas>
  )
}
```

`apps/client/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root element')
createRoot(root).render(<App />)
```

`apps/client/test/smoke.test.tsx`:

```tsx
import { expect, it } from 'vitest'
import { App } from '../src/App'

it('App component is exported and renderable as an element', () => {
  expect(typeof App).toBe('function')
  expect(<App />).toBeTruthy()
})
```

- [ ] **Step 2: Verify the client package**

Run:

```bash
pnpm install
pnpm --filter client test && pnpm --filter client lint && pnpm --filter client build
```

Expected: all pass; `vite build` emits `apps/client/dist/`.

- [ ] **Step 3: Write the real README**

Replace `README.md` content with:

```markdown
# Meridian

Original online board game. Hyper-stylized R3F client, authoritative
Colyseus server, and a data-driven rules engine — rules are content, not
code, so new games and expansions are JSON drops.

Docs: `docs/BRIEF.md` (pillars) · `docs/superpowers/specs/` (designs) ·
`docs/PLAN.md` (roadmap).

## Monorepo

- `packages/rules` — pure TypeScript rules engine (no colyseus/three/react):
  hex math, zod-validated declarative rulesets, `applyIntent` reducer, win
  detection. The placeholder hex-tactics ruleset lives in
  `src/rulesets/placeholder.json`.
- `packages/protocol` — zod schemas for client↔server messages.
- `apps/server` — Colyseus authoritative server: 4-letter join codes,
  engine-validated intents, schema diff sync, reconnection with forfeit.
- `apps/client` — Vite + React Three Fiber (stub; rendering lands next plan).

## Development

Requirements: Node 20+, pnpm 10.

    pnpm install
    pnpm test                  # all package tests
    pnpm --filter server dev   # ws://localhost:2567
    pnpm --filter client dev   # http://localhost:5173

The server owns all game state: clients send intents, receive state diffs.
```

- [ ] **Step 4: Final verification from clean state**

Run:

```bash
pnpm turbo run lint test build --force
```

Expected: every task green with caching disabled (rules, protocol, server, client).

- [ ] **Step 5: Commit**

```bash
git add apps/client README.md
git commit -m "feat(client): vite + r3f stub; docs: real monorepo README"
```
