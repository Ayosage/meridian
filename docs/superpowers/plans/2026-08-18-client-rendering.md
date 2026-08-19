# Meridian Client Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/client` into a playable web client: lobby with join codes, instanced 3D hex board rendered from server state, click-to-move with legal-move highlighting, a first custom board shader, and the Milestone-1 two-browser E2E + perf snapshot.

**Architecture:** The client bundles `placeholderRuleset` from `@meridian/rules` and reconstructs a plain engine `GameState` from the synced Colyseus schema via a duck-typed adapter, so the engine's `legalMoves` is reused verbatim. One zustand store holds connection/match/selection state; the non-serializable Colyseus room lives in a module (`src/net/connection.ts`). Rendering is two `InstancedMesh`es (tiles, pieces) with per-instance visual state through a single choke point; R3F pointer events carry `instanceId`. No client prediction; no setState in useFrame; no per-frame allocations.

**Tech Stack:** colyseus.js 0.16, zustand 5, React Three Fiber 8 + three 0.169 (already present), @playwright/test for the E2E.

**Spec:** `docs/superpowers/specs/2026-08-18-client-rendering-design.md` (parent: plan-1 spec + `docs/BRIEF.md` + `docs/PLAN.md` tasks 10–13)

## Global Constraints

- TypeScript `strict: true` + `noUncheckedIndexedAccess`; no `any` in committed code.
- **Do not modify `packages/rules`, `packages/protocol`, or `apps/server`** — this plan is client-only. The existing 58 tests must stay green.
- The client never imports server source; the schema is consumed through the duck-typed `ClientMatchState` interface only.
- Perf pillar rules: never `setState` inside `useFrame`; no object allocation inside `useFrame` or per-instance loops (reuse module-level scratch `Matrix4`/`Color`); board/piece rendering stays 2 instanced draw calls.
- Board geometry is derived from `ruleset.board.radius` — never hardcode tile counts.
- Neutral placeholder aesthetics: no theme/lore copy anywhere (the game-design cycle owns identity); UI copy is functional ("Create match", "Join", "END TURN").
- Server URL from `import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:2567'`.
- Library API drift rule: if an installed colyseus.js / three / playwright API differs from a snippet, adapt minimally to preserve stated behavior and report the deviation.
- Commit after every task; conventional-commit messages.

---

### Task 1: Client deps + hex layout math

**Files:**
- Modify: `apps/client/package.json`
- Create: `apps/client/src/scene/layout.ts`
- Test: `apps/client/test/layout.test.ts`

**Interfaces:**
- Consumes: `Coord`, `inRadius`, `coordKey`, `neighbors` from `@meridian/rules`.
- Produces: `TILE_SIZE = 1`; `coordToWorld(c: Coord, size?: number): [number, number, number]` (pointy-top axial layout: `x = size·√3·(q + r/2)`, `y = 0`, `z = size·1.5·r`); `boardCoords(radius: number): Coord[]` (row-major, deterministic order — the tile instance order every later task relies on); `buildCoordIndex(coords: readonly Coord[]): Map<string, number>` (coordKey → instance index).

- [ ] **Step 1: Add dependencies**

In `apps/client/package.json` add to `"dependencies"`:

```json
"@meridian/protocol": "workspace:*",
"@meridian/rules": "workspace:*",
"colyseus.js": "^0.16.0",
"zustand": "^5.0.0"
```

Run `pnpm install`.

- [ ] **Step 2: Write the failing test**

`apps/client/test/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { coordKey, distance, neighbors } from '@meridian/rules'
import { TILE_SIZE, boardCoords, buildCoordIndex, coordToWorld } from '../src/scene/layout'

describe('boardCoords', () => {
  it('generates the full hexagonal board for a radius', () => {
    expect(boardCoords(1)).toHaveLength(7)
    expect(boardCoords(3)).toHaveLength(37)
  })

  it('every generated coord is within the radius and unique', () => {
    const coords = boardCoords(3)
    const keys = new Set(coords.map(coordKey))
    expect(keys.size).toBe(37)
    for (const c of coords) expect(distance({ q: 0, r: 0 }, c)).toBeLessThanOrEqual(3)
  })
})

describe('coordToWorld', () => {
  it('places the origin at world zero on the ground plane', () => {
    expect(coordToWorld({ q: 0, r: 0 })).toEqual([0, 0, 0])
  })

  it('places all six neighbors at equal world distance (pointy-top spacing)', () => {
    const [ox, , oz] = coordToWorld({ q: 0, r: 0 })
    for (const n of neighbors({ q: 0, r: 0 })) {
      const [x, , z] = coordToWorld(n)
      const d = Math.hypot(x - ox, z - oz)
      expect(d).toBeCloseTo(Math.sqrt(3) * TILE_SIZE, 10)
    }
  })

  it('scales with tile size', () => {
    const [x, , z] = coordToWorld({ q: 2, r: -1 }, 2)
    const [x1, , z1] = coordToWorld({ q: 2, r: -1 }, 1)
    expect(x).toBeCloseTo(x1 * 2, 10)
    expect(z).toBeCloseTo(z1 * 2, 10)
  })
})

describe('buildCoordIndex', () => {
  it('round-trips every coord to its instance index', () => {
    const coords = boardCoords(2)
    const index = buildCoordIndex(coords)
    coords.forEach((c, i) => expect(index.get(coordKey(c))).toBe(i))
    expect(index.size).toBe(coords.length)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter client test`
Expected: FAIL — cannot resolve `../src/scene/layout`.

- [ ] **Step 4: Implement**

`apps/client/src/scene/layout.ts`:

```ts
import { coordKey, inRadius, type Coord } from '@meridian/rules'

export const TILE_SIZE = 1

/** Pointy-top axial layout on the XZ ground plane. */
export function coordToWorld(c: Coord, size: number = TILE_SIZE): [number, number, number] {
  const x = size * Math.sqrt(3) * (c.q + c.r / 2)
  const z = size * 1.5 * c.r
  return [x, 0, z]
}

/**
 * Every coord of a hexagonal board, in deterministic row-major (q, then r)
 * order. This order IS the tile instance order — all later lookups rely on it.
 */
export function boardCoords(radius: number): Coord[] {
  const out: Coord[] = []
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const c = { q, r }
      if (inRadius(c, radius)) out.push(c)
    }
  }
  return out
}

export function buildCoordIndex(coords: readonly Coord[]): Map<string, number> {
  const index = new Map<string, number>()
  coords.forEach((c, i) => index.set(coordKey(c), i))
  return index
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter client test && pnpm --filter client lint`
Expected: PASS (5 new tests + existing smoke test), lint clean.

- [ ] **Step 6: Commit**

```bash
git add apps/client pnpm-lock.yaml
git commit -m "feat(client): colyseus/zustand deps and pointy-top hex board layout math"
```

---

### Task 2: Schema adapter — `toGameState`

**Files:**
- Create: `apps/client/src/net/types.ts`, `apps/client/src/net/toGameState.ts`
- Test: `apps/client/test/toGameState.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Piece`, `Ruleset`, `placeholderRuleset` from `@meridian/rules`.
- Produces: `ClientPiece { id; owner; pieceType; q; r }`, `ClientMatchState { phase: string; currentPlayer: number; winner: number; seq: number; pieces: { forEach(cb: (p: ClientPiece) => void): void }; seats: { indexOf(sessionId: string): number; length: number } }` (duck type — matches both the live colyseus.js decoded state and plain test fixtures); `toGameState(schema: ClientMatchState, ruleset: Ruleset): GameState` — pieces sorted by id (MapSchema iteration order is not guaranteed), `winner: -1 → null`, `pieceType → type`.

- [ ] **Step 1: Write the failing test**

`apps/client/test/toGameState.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { placeholderRuleset } from '@meridian/rules'
import { toGameState } from '../src/net/toGameState'
import type { ClientMatchState, ClientPiece } from '../src/net/types'

function fakeState(pieces: ClientPiece[], overrides: Partial<ClientMatchState> = {}): ClientMatchState {
  return {
    phase: 'playing',
    currentPlayer: 0,
    winner: -1,
    seq: 0,
    pieces: { forEach: (cb) => pieces.forEach(cb) },
    seats: { indexOf: () => -1, length: 2 },
    ...overrides,
  }
}

const P = (id: string, owner: number, q: number, r: number): ClientPiece => ({
  id,
  owner,
  pieceType: 'runner',
  q,
  r,
})

describe('toGameState', () => {
  it('reconstructs pieces with engine field names, sorted by id', () => {
    const gs = toGameState(fakeState([P('p1-0', 1, 3, 0), P('p0-0', 0, -3, 0)]), placeholderRuleset)
    expect(gs.pieces.map((p) => p.id)).toEqual(['p0-0', 'p1-0'])
    expect(gs.pieces[0]).toEqual({ id: 'p0-0', owner: 0, type: 'runner', at: { q: -3, r: 0 } })
    expect(gs.ruleset).toBe(placeholderRuleset)
  })

  it('maps scalar fields and the -1 winner sentinel to null', () => {
    const gs = toGameState(fakeState([], { currentPlayer: 1, seq: 7, winner: -1 }), placeholderRuleset)
    expect(gs.currentPlayer).toBe(1)
    expect(gs.seq).toBe(7)
    expect(gs.winner).toBeNull()
  })

  it('maps a decided winner through', () => {
    const gs = toGameState(fakeState([], { winner: 1 }), placeholderRuleset)
    expect(gs.winner).toBe(1)
  })

  it('the reconstructed state feeds the engine: legalMoves works on it', async () => {
    const { legalMoves, coordKey } = await import('@meridian/rules')
    const gs = toGameState(
      fakeState([P('p0-0', 0, -3, 0), P('p0-1', 0, -3, 1)]),
      placeholderRuleset,
    )
    const keys = new Set(legalMoves(gs, 'p0-0').map(coordKey))
    expect(keys).toEqual(new Set(['-2,0', '-2,-1']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test`
Expected: FAIL — cannot resolve `../src/net/toGameState`.

- [ ] **Step 3: Implement**

`apps/client/src/net/types.ts`:

```ts
/**
 * Duck-typed view of the server's MatchState schema as decoded by
 * colyseus.js. The client deliberately does NOT import server code —
 * these structural types are the entire coupling surface.
 */
export interface ClientPiece {
  id: string
  owner: number
  pieceType: string
  q: number
  r: number
}

export interface ClientMatchState {
  phase: string
  currentPlayer: number
  winner: number
  seq: number
  pieces: { forEach(cb: (p: ClientPiece) => void): void }
  seats: { indexOf(sessionId: string): number; length: number }
}
```

`apps/client/src/net/toGameState.ts`:

```ts
import type { GameState, Piece, Ruleset } from '@meridian/rules'
import type { ClientMatchState } from './types'

/**
 * Reconstruct the plain engine GameState from the synced schema plus the
 * bundled ruleset (the schema does not carry the ruleset — spec §2).
 * Pieces are sorted by id: MapSchema iteration order is not guaranteed.
 */
export function toGameState(schema: ClientMatchState, ruleset: Ruleset): GameState {
  const pieces: Piece[] = []
  schema.pieces.forEach((p) => {
    pieces.push({ id: p.id, owner: p.owner, type: p.pieceType, at: { q: p.q, r: p.r } })
  })
  pieces.sort((a, b) => a.id.localeCompare(b.id))
  return {
    ruleset,
    seq: schema.seq,
    currentPlayer: schema.currentPlayer,
    pieces,
    winner: schema.winner === -1 ? null : schema.winner,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test && pnpm --filter client lint`
Expected: PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/client
git commit -m "feat(client): duck-typed schema adapter reconstructing the engine GameState"
```

---

### Task 3: The zustand store

**Files:**
- Create: `apps/client/src/store.ts`
- Test: `apps/client/test/store.test.ts`

**Interfaces:**
- Consumes: `GameState`, `legalMoves`, `coordKey`, `initialState`, `placeholderRuleset` from `@meridian/rules`.
- Produces: `useMeridianStore` (zustand) with state `{ status: 'idle'|'connecting'|'waiting'|'playing'|'ended'|'reconnecting'|'error'; joinCode: string|null; seat: number|null; error: string|null; game: GameState|null; matchResult: { reason: 'win'|'forfeit'; winner: number }|null; selectedPieceId: string|null; legalTargets: ReadonlySet<string> }` and actions `setStatus`, `setJoined(joinCode)`, `setSeat(seat)`, `setGame(game)`, `setError(message|null)`, `setMatchResult(result)`, `selectPiece(pieceId)`, `clearSelection()`, `reset()`. Selection rules: only own piece, on own turn, no winner; `setGame` re-derives or clears selection; `setMatchResult` forces `ended` and clears selection.

- [ ] **Step 1: Write the failing test**

`apps/client/test/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { applyIntent, initialState, isRuleError, placeholderRuleset } from '@meridian/rules'
import { useMeridianStore } from '../src/store'

function fresh() {
  return initialState(placeholderRuleset)
}

beforeEach(() => {
  useMeridianStore.getState().reset()
})

describe('selection rules', () => {
  it('selecting an own piece on own turn computes legal targets', () => {
    const s = useMeridianStore.getState()
    s.setSeat(0)
    s.setGame(fresh())
    useMeridianStore.getState().selectPiece('p0-0')
    const after = useMeridianStore.getState()
    expect(after.selectedPieceId).toBe('p0-0')
    expect(after.legalTargets).toEqual(new Set(['-2,0', '-2,-1']))
  })

  it("refuses to select the opponent's piece or out of turn", () => {
    const s = useMeridianStore.getState()
    s.setSeat(0)
    s.setGame(fresh())
    useMeridianStore.getState().selectPiece('p1-0') // opponent's
    expect(useMeridianStore.getState().selectedPieceId).toBeNull()

    useMeridianStore.getState().setSeat(1) // now we're seat 1, but currentPlayer is 0
    useMeridianStore.getState().selectPiece('p1-0')
    expect(useMeridianStore.getState().selectedPieceId).toBeNull()
  })

  it('a new game state after our move clears the stale selection', () => {
    const s = useMeridianStore.getState()
    s.setSeat(0)
    s.setGame(fresh())
    useMeridianStore.getState().selectPiece('p0-0')
    const moved = applyIntent(fresh(), { type: 'move', player: 0, pieceId: 'p0-0', to: { q: -2, r: 0 } })
    if (isRuleError(moved)) throw new Error(moved.message)
    useMeridianStore.getState().setGame(moved) // turn is now seat 1's
    const after = useMeridianStore.getState()
    expect(after.selectedPieceId).toBeNull()
    expect(after.legalTargets.size).toBe(0)
  })
})

describe('status transitions', () => {
  it('setJoined enters waiting with the code', () => {
    useMeridianStore.getState().setJoined('ABCD')
    const s = useMeridianStore.getState()
    expect(s.status).toBe('waiting')
    expect(s.joinCode).toBe('ABCD')
  })

  it('setGame flips to playing, or ended when a winner exists', () => {
    useMeridianStore.getState().setGame(fresh())
    expect(useMeridianStore.getState().status).toBe('playing')
    useMeridianStore.getState().setGame({ ...fresh(), winner: 1 })
    expect(useMeridianStore.getState().status).toBe('ended')
  })

  it('setMatchResult ends the match and clears selection', () => {
    const s = useMeridianStore.getState()
    s.setSeat(0)
    s.setGame(fresh())
    useMeridianStore.getState().selectPiece('p0-0')
    useMeridianStore.getState().setMatchResult({ reason: 'forfeit', winner: 0 })
    const after = useMeridianStore.getState()
    expect(after.status).toBe('ended')
    expect(after.matchResult).toEqual({ reason: 'forfeit', winner: 0 })
    expect(after.selectedPieceId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test`
Expected: FAIL — cannot resolve `../src/store`.

- [ ] **Step 3: Implement**

`apps/client/src/store.ts`:

```ts
import { create } from 'zustand'
import { coordKey, legalMoves, type GameState } from '@meridian/rules'

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'playing'
  | 'ended'
  | 'reconnecting'
  | 'error'

export interface MatchResult {
  reason: 'win' | 'forfeit'
  winner: number
}

const EMPTY: ReadonlySet<string> = new Set()

interface MeridianState {
  status: ConnectionStatus
  joinCode: string | null
  seat: number | null
  error: string | null
  game: GameState | null
  matchResult: MatchResult | null
  selectedPieceId: string | null
  legalTargets: ReadonlySet<string>
  setStatus(status: ConnectionStatus): void
  setJoined(joinCode: string): void
  setSeat(seat: number): void
  setGame(game: GameState): void
  setError(message: string | null): void
  setMatchResult(result: MatchResult): void
  selectPiece(pieceId: string): void
  clearSelection(): void
  reset(): void
}

export const useMeridianStore = create<MeridianState>((set, get) => ({
  status: 'idle',
  joinCode: null,
  seat: null,
  error: null,
  game: null,
  matchResult: null,
  selectedPieceId: null,
  legalTargets: EMPTY,

  setStatus: (status) => set({ status }),
  setJoined: (joinCode) => set({ joinCode, status: 'waiting' }),
  setSeat: (seat) => set({ seat }),

  setGame: (game) => {
    const { selectedPieceId, seat } = get()
    const ourTurn = game.winner === null && seat !== null && game.currentPlayer === seat
    const stillOurs =
      selectedPieceId !== null && game.pieces.some((p) => p.id === selectedPieceId && p.owner === seat)
    if (ourTurn && stillOurs && selectedPieceId !== null) {
      set({
        game,
        status: 'playing',
        legalTargets: new Set(legalMoves(game, selectedPieceId).map(coordKey)),
      })
    } else {
      set({
        game,
        status: game.winner === null ? 'playing' : 'ended',
        selectedPieceId: null,
        legalTargets: EMPTY,
      })
    }
  },

  setError: (error) => set({ error }),

  setMatchResult: (matchResult) =>
    set({ matchResult, status: 'ended', selectedPieceId: null, legalTargets: EMPTY }),

  selectPiece: (pieceId) => {
    const { game, seat } = get()
    if (!game || seat === null || game.winner !== null || game.currentPlayer !== seat) return
    const piece = game.pieces.find((p) => p.id === pieceId)
    if (!piece || piece.owner !== seat) return
    set({ selectedPieceId: pieceId, legalTargets: new Set(legalMoves(game, pieceId).map(coordKey)) })
  },

  clearSelection: () => set({ selectedPieceId: null, legalTargets: EMPTY }),

  reset: () =>
    set({
      status: 'idle',
      joinCode: null,
      seat: null,
      error: null,
      game: null,
      matchResult: null,
      selectedPieceId: null,
      legalTargets: EMPTY,
    }),
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test && pnpm --filter client lint`
Expected: PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/client
git commit -m "feat(client): zustand store with engine-derived selection and legal targets"
```

---

### Task 4: Connection layer

**Files:**
- Create: `apps/client/src/net/tokenStorage.ts`, `apps/client/src/net/connection.ts`
- Test: `apps/client/test/connection.test.ts`

**Interfaces:**
- Consumes: store actions (Task 3), `toGameState` (Task 2), `placeholderRuleset` from `@meridian/rules`, `MSG`, `ClientIntent` from `@meridian/protocol`, colyseus.js `Client`/`Room`.
- Produces: `createMatch(): Promise<void>`, `joinMatch(code: string): Promise<void>` (uppercases the code), `reconnectMatch(): Promise<boolean>` (token from `tokenStorage`; clears it on failure), `sendIntent(intent: ClientIntent): void`, `leaveMatch(): void`, `getRoom()`. `tokenStorage` = `{ get(): string|null; set(token: string): void; clear(): void }` backed by `sessionStorage` when available, in-memory otherwise. Room wiring: `onStateChange` → seat from `seats.indexOf(sessionId)` + `setJoined`-then-`setGame`/waiting; `ruleError` → `setError` + `clearSelection`; `matchEnded` → `setMatchResult`; `snapshot` → `setGame(payload.state)`; catch-all `'*'` handler; abnormal `onLeave` → one reconnect attempt, else `error` status.

- [ ] **Step 1: Write the failing test**

`apps/client/test/connection.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyIntent, initialState, isRuleError, placeholderRuleset } from '@meridian/rules'

// ---- fake colyseus.js -------------------------------------------------
type Handler = (payload: unknown) => void

class FakeRoom {
  roomId = 'ABCD'
  sessionId = 'sess-0'
  reconnectionToken = 'tok-123'
  private stateHandlers: ((state: unknown) => void)[] = []
  private messageHandlers = new Map<string, Handler>()
  sent: { type: string; payload: unknown }[] = []
  leaveHandlers: ((code: number) => void)[] = []

  onStateChange(cb: (state: unknown) => void) {
    this.stateHandlers.push(cb)
  }
  onMessage(type: string, cb: Handler) {
    this.messageHandlers.set(type, cb)
  }
  onLeave(cb: (code: number) => void) {
    this.leaveHandlers.push(cb)
  }
  send(type: string, payload: unknown) {
    this.sent.push({ type, payload })
  }
  leave() {
    return Promise.resolve()
  }

  // test drivers
  pushState(state: unknown) {
    for (const cb of this.stateHandlers) cb(state)
  }
  pushMessage(type: string, payload: unknown) {
    this.messageHandlers.get(type)?.(payload)
  }
}

const fake = { room: new FakeRoom(), createCalls: 0, joinCalls: [] as string[], reconnectCalls: [] as string[] }

vi.mock('colyseus.js', () => ({
  Client: class {
    create() {
      fake.createCalls += 1
      return Promise.resolve(fake.room)
    }
    joinById(code: string) {
      fake.joinCalls.push(code)
      return Promise.resolve(fake.room)
    }
    reconnect(token: string) {
      fake.reconnectCalls.push(token)
      return Promise.resolve(fake.room)
    }
  },
}))

import { useMeridianStore } from '../src/store'
import { tokenStorage } from '../src/net/tokenStorage'
import { createMatch, joinMatch, sendIntent } from '../src/net/connection'

function schemaOf(seats: string[], gameSeq = 0, phase = 'playing') {
  const gs = initialState(placeholderRuleset)
  return {
    phase,
    currentPlayer: gs.currentPlayer,
    winner: -1,
    seq: gameSeq,
    pieces: {
      forEach: (cb: (p: { id: string; owner: number; pieceType: string; q: number; r: number }) => void) =>
        gs.pieces.forEach((p) => cb({ id: p.id, owner: p.owner, pieceType: p.type, q: p.at.q, r: p.at.r })),
    },
    seats: { indexOf: (s: string) => seats.indexOf(s), length: seats.length },
  }
}

beforeEach(() => {
  useMeridianStore.getState().reset()
  tokenStorage.clear()
  fake.room = new FakeRoom()
  fake.createCalls = 0
  fake.joinCalls = []
  fake.reconnectCalls = []
})

describe('connection wiring', () => {
  it('createMatch stores the join code, persists the token, and derives the seat from state', async () => {
    await createMatch()
    expect(useMeridianStore.getState().joinCode).toBe('ABCD')
    expect(tokenStorage.get()).toBe('tok-123')

    fake.room.pushState(schemaOf(['sess-0'], 0, 'waiting'))
    expect(useMeridianStore.getState().seat).toBe(0)
    expect(useMeridianStore.getState().status).toBe('waiting')

    fake.room.pushState(schemaOf(['sess-0', 'other'], 0, 'playing'))
    const s = useMeridianStore.getState()
    expect(s.status).toBe('playing')
    expect(s.game?.pieces).toHaveLength(6)
  })

  it('joinMatch uppercases the code', async () => {
    await joinMatch('abcd')
    expect(fake.joinCalls).toEqual(['ABCD'])
  })

  it('ruleError messages surface as transient errors and clear selection', async () => {
    await createMatch()
    fake.room.pushState(schemaOf(['sess-0', 'other']))
    useMeridianStore.getState().selectPiece('p0-0')
    expect(useMeridianStore.getState().selectedPieceId).toBe('p0-0')

    fake.room.pushMessage('ruleError', { code: 'NOT_YOUR_TURN', message: 'wait' })
    const s = useMeridianStore.getState()
    expect(s.error).toContain('NOT_YOUR_TURN')
    expect(s.selectedPieceId).toBeNull()
  })

  it('matchEnded sets the result; snapshot state is accepted as authoritative', async () => {
    await createMatch()
    fake.room.pushMessage('matchEnded', { reason: 'win', winner: 0 })
    expect(useMeridianStore.getState().matchResult).toEqual({ reason: 'win', winner: 0 })

    const moved = applyIntent(initialState(placeholderRuleset), {
      type: 'move',
      player: 0,
      pieceId: 'p0-0',
      to: { q: -2, r: 0 },
    })
    if (isRuleError(moved)) throw new Error(moved.message)
    fake.room.pushMessage('snapshot', { state: moved })
    expect(useMeridianStore.getState().game?.seq).toBe(1)
  })

  it('sendIntent forwards to the room', async () => {
    await createMatch()
    sendIntent({ type: 'endTurn' })
    expect(fake.room.sent).toEqual([{ type: 'intent', payload: { type: 'endTurn' } }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test`
Expected: FAIL — cannot resolve `../src/net/connection`.

- [ ] **Step 3: Implement**

`apps/client/src/net/tokenStorage.ts`:

```ts
const KEY = 'meridian:reconnectionToken'
let memory: string | null = null

function hasSession(): boolean {
  return typeof sessionStorage !== 'undefined'
}

/** Reconnection token persistence: sessionStorage in the browser, in-memory in tests. */
export const tokenStorage = {
  get(): string | null {
    return hasSession() ? sessionStorage.getItem(KEY) : memory
  },
  set(token: string): void {
    if (hasSession()) sessionStorage.setItem(KEY, token)
    else memory = token
  },
  clear(): void {
    if (hasSession()) sessionStorage.removeItem(KEY)
    memory = null
  },
}
```

`apps/client/src/net/connection.ts`:

```ts
import { Client, type Room } from 'colyseus.js'
import { MSG, type ClientIntent, type MatchEndedPayload, type RuleErrorPayload } from '@meridian/protocol'
import { placeholderRuleset, type GameState } from '@meridian/rules'
import { useMeridianStore } from '../store'
import { toGameState } from './toGameState'
import { tokenStorage } from './tokenStorage'
import type { ClientMatchState } from './types'

const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:2567'

let client: Client | null = null
let room: Room<ClientMatchState> | null = null

function getClient(): Client {
  client ??= new Client(SERVER_URL)
  return client
}

export function getRoom(): Room<ClientMatchState> | null {
  return room
}

export async function createMatch(): Promise<void> {
  useMeridianStore.getState().setStatus('connecting')
  enterRoom(await getClient().create<ClientMatchState>('match'))
}

export async function joinMatch(code: string): Promise<void> {
  useMeridianStore.getState().setStatus('connecting')
  enterRoom(await getClient().joinById<ClientMatchState>(code.toUpperCase()))
}

/** Try to resume via a persisted token. Clears the token if it is dead. */
export async function reconnectMatch(): Promise<boolean> {
  const token = tokenStorage.get()
  if (!token) return false
  try {
    useMeridianStore.getState().setStatus('reconnecting')
    enterRoom(await getClient().reconnect<ClientMatchState>(token))
    return true
  } catch {
    tokenStorage.clear()
    return false
  }
}

export function sendIntent(intent: ClientIntent): void {
  room?.send(MSG.INTENT, intent)
}

export function leaveMatch(): void {
  void room?.leave()
  room = null
  tokenStorage.clear()
  useMeridianStore.getState().reset()
}

function enterRoom(r: Room<ClientMatchState>): void {
  room = r
  tokenStorage.set(r.reconnectionToken)
  const store = () => useMeridianStore.getState()
  store().setJoined(r.roomId)

  r.onStateChange((state) => {
    const seat = state.seats.indexOf(r.sessionId)
    if (seat !== -1 && store().seat !== seat) store().setSeat(seat)
    if (state.phase === 'waiting') store().setStatus('waiting')
    else store().setGame(toGameState(state, placeholderRuleset))
  })

  r.onMessage(MSG.RULE_ERROR, (payload: RuleErrorPayload) => {
    store().setError(`${payload.code}: ${payload.message}`)
    store().clearSelection()
  })
  r.onMessage(MSG.MATCH_ENDED, (payload: MatchEndedPayload) => {
    store().setMatchResult(payload)
  })
  r.onMessage(MSG.SNAPSHOT, (payload: { state: GameState }) => {
    store().setGame(payload.state)
  })
  r.onMessage('*', () => undefined)

  r.onLeave(() => {
    if (store().status === 'ended' || store().status === 'idle') return
    void reconnectMatch().then((ok) => {
      if (!ok) {
        store().setError('connection lost')
        store().setStatus('error')
      }
    })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test && pnpm --filter client lint`
Expected: PASS, lint clean, no unhandled-message noise.

- [ ] **Step 5: Commit**

```bash
git add apps/client
git commit -m "feat(client): colyseus connection layer wiring room events into the store"
```

---

### Task 5: Instanced board and pieces rendering

**Files:**
- Create: `apps/client/src/scene/tileVisuals.ts`, `apps/client/src/scene/Board.tsx`, `apps/client/src/scene/Pieces.tsx`, `apps/client/src/scene/MatchScene.tsx`
- Test: `apps/client/test/tileVisuals.test.ts`

**Interfaces:**
- Consumes: layout helpers (Task 1), store (Task 3), `GameState`/`Coord`/`coordKey` from `@meridian/rules`.
- Produces:
  - `tileVisuals.ts`: `TILE_STATE = { none: 0, hover: 1, legal: 2, selected: 3 } as const`, `type TileStateName = keyof typeof TILE_STATE`, `tileStateFor(key: string, hoveredKey: string | null, selectedKey: string | null, legalTargets: ReadonlySet<string>): TileStateName`, `TILE_COLORS: Record<TileStateName, readonly [number, number, number]>`. This module is the single choke point the shader task upgrades.
  - `Board` component `{ radius, legalTargets, selectedCoordKey, onTileClick(c: Coord), onTileHover?(key: string | null) }` — one `InstancedMesh`, hex-prism geometry (`CylinderGeometry(0.94, 0.94, 0.15, 6)` rotated `Y` by `π/6` for pointy-top), matrices from `coordToWorld`, colors via `setColorAt` driven by `tileStateFor`, R3F pointer events using `event.instanceId`, hover tracked in a ref (no per-frame React state).
  - `Pieces` component `{ game, selectedPieceId, onPieceClick(id: string) }` — one `InstancedMesh` (cone `ConeGeometry(0.35, 0.8, 5)` at y≈0.5), capacity `game.ruleset.setup.length`, `mesh.count = game.pieces.length`, team colors via `setColorAt` (seat 0 `#4f7cff`, seat 1 `#ff5f4f`), selected piece scaled 1.15×, instance→pieceId lookup rebuilt on every `game` change (pieces sorted by id from the adapter, so order is stable).
  - `MatchScene` — R3F content: lights (ambient 0.5 + directional [6,10,4] 0.9), fixed camera handled by the parent `<Canvas camera={{ position: [0, 9.5, 8.5], fov: 45 }}>` looking at origin (set via `onCreated={({ camera }) => camera.lookAt(0, 0, 0)}` in App), `Board` + `Pieces` wired to store selectors and the interaction handlers passed in as props.
- All scratch objects (`Matrix4`, `Color`) are module-level constants — none allocated in effects' loops or frames.

- [ ] **Step 1: Write the failing test (pure choke point only — components are E2E-covered)**

`apps/client/test/tileVisuals.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TILE_COLORS, TILE_STATE, tileStateFor } from '../src/scene/tileVisuals'

describe('tileStateFor', () => {
  const legal = new Set(['-2,0', '-2,-1'])

  it('selected beats legal beats hover beats none', () => {
    expect(tileStateFor('-3,0', null, '-3,0', legal)).toBe('selected')
    expect(tileStateFor('-2,0', '-2,0', null, legal)).toBe('legal')
    expect(tileStateFor('1,1', '1,1', null, legal)).toBe('hover')
    expect(tileStateFor('1,1', null, null, legal)).toBe('none')
  })

  it('exposes a color and a numeric state id for every state', () => {
    for (const name of Object.keys(TILE_STATE) as (keyof typeof TILE_STATE)[]) {
      expect(TILE_COLORS[name]).toHaveLength(3)
      expect(typeof TILE_STATE[name]).toBe('number')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test`
Expected: FAIL — cannot resolve `../src/scene/tileVisuals`.

- [ ] **Step 3: Implement the choke point**

`apps/client/src/scene/tileVisuals.ts`:

```ts
export const TILE_STATE = { none: 0, hover: 1, legal: 2, selected: 3 } as const
export type TileStateName = keyof typeof TILE_STATE

export const TILE_COLORS: Record<TileStateName, readonly [number, number, number]> = {
  none: [0.16, 0.18, 0.22],
  hover: [0.28, 0.32, 0.4],
  legal: [0.2, 0.45, 0.35],
  selected: [0.55, 0.45, 0.2],
}

/** Priority: selected > legal > hover > none. Single source of tile visual state. */
export function tileStateFor(
  key: string,
  hoveredKey: string | null,
  selectedKey: string | null,
  legalTargets: ReadonlySet<string>,
): TileStateName {
  if (key === selectedKey) return 'selected'
  if (legalTargets.has(key)) return 'legal'
  if (key === hoveredKey) return 'hover'
  return 'none'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test`
Expected: PASS.

- [ ] **Step 5: Implement the components**

`apps/client/src/scene/Board.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { coordKey, type Coord } from '@meridian/rules'
import { TILE_SIZE, boardCoords, coordToWorld } from './layout'
import { TILE_COLORS, tileStateFor } from './tileVisuals'

const SCRATCH_MATRIX = new THREE.Matrix4()
const SCRATCH_COLOR = new THREE.Color()

interface BoardProps {
  radius: number
  legalTargets: ReadonlySet<string>
  selectedCoordKey: string | null
  onTileClick(c: Coord): void
}

export function Board({ radius, legalTargets, selectedCoordKey, onTileClick }: BoardProps) {
  const coords = useMemo(() => boardCoords(radius), [radius])
  const keys = useMemo(() => coords.map(coordKey), [coords])
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const hoveredRef = useRef<string | null>(null)

  const geometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(TILE_SIZE * 0.94, TILE_SIZE * 0.94, 0.15, 6)
    g.rotateY(Math.PI / 6) // pointy-top orientation to match the layout
    return g
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // Static transforms: once per board.
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    coords.forEach((c, i) => {
      const [x, y, z] = coordToWorld(c)
      SCRATCH_MATRIX.identity().setPosition(x, y, z)
      mesh.setMatrixAt(i, SCRATCH_MATRIX)
    })
    mesh.instanceMatrix.needsUpdate = true
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords])

  // Repaint when highlight inputs change.
  useEffect(() => {
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legalTargets, selectedCoordKey])

  function paint(): void {
    const mesh = meshRef.current
    if (!mesh) return
    keys.forEach((key, i) => {
      const state = tileStateFor(key, hoveredRef.current, selectedCoordKey, legalTargets)
      const [r, g, b] = TILE_COLORS[state]
      mesh.setColorAt(i, SCRATCH_COLOR.setRGB(r, g, b))
    })
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  function setHover(key: string | null): void {
    if (hoveredRef.current === key) return
    hoveredRef.current = key
    paint()
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, coords.length]}
      onPointerMove={(e) => {
        e.stopPropagation()
        setHover(e.instanceId !== undefined ? (keys[e.instanceId] ?? null) : null)
      }}
      onPointerOut={() => setHover(null)}
      onClick={(e) => {
        e.stopPropagation()
        if (e.instanceId === undefined) return
        const c = coords[e.instanceId]
        if (c) onTileClick(c)
      }}
    >
      <meshStandardMaterial />
    </instancedMesh>
  )
}
```

`apps/client/src/scene/Pieces.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { GameState } from '@meridian/rules'
import { coordToWorld } from './layout'

const SCRATCH_MATRIX = new THREE.Matrix4()
const TEAM_COLORS = [new THREE.Color('#4f7cff'), new THREE.Color('#ff5f4f')]
const FALLBACK_COLOR = new THREE.Color('#999999')

interface PiecesProps {
  game: GameState
  selectedPieceId: string | null
  onPieceClick(id: string): void
}

export function Pieces({ game, selectedPieceId, onPieceClick }: PiecesProps) {
  const capacity = game.ruleset.setup.length
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const idsRef = useRef<string[]>([])

  const geometry = useMemo(() => new THREE.ConeGeometry(0.35, 0.8, 5), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // Rewrite transforms + colors when the authoritative state (or selection) changes —
  // never per frame.
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    idsRef.current = []
    game.pieces.forEach((p, i) => {
      const [x, , z] = coordToWorld(p.at)
      const s = p.id === selectedPieceId ? 1.15 : 1
      SCRATCH_MATRIX.makeScale(s, s, s).setPosition(x, 0.55, z)
      mesh.setMatrixAt(i, SCRATCH_MATRIX)
      mesh.setColorAt(i, TEAM_COLORS[p.owner] ?? FALLBACK_COLOR)
      idsRef.current.push(p.id)
    })
    mesh.count = game.pieces.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [game, selectedPieceId])

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, capacity]}
      onClick={(e) => {
        e.stopPropagation()
        if (e.instanceId === undefined) return
        const id = idsRef.current[e.instanceId]
        if (id) onPieceClick(id)
      }}
    >
      <meshStandardMaterial />
    </instancedMesh>
  )
}
```

`apps/client/src/scene/MatchScene.tsx`:

```tsx
import { coordKey, type Coord, type GameState } from '@meridian/rules'
import { Board } from './Board'
import { Pieces } from './Pieces'

interface MatchSceneProps {
  game: GameState
  selectedPieceId: string | null
  legalTargets: ReadonlySet<string>
  onTileClick(c: Coord): void
  onPieceClick(id: string): void
}

export function MatchScene(props: MatchSceneProps) {
  const selected = props.game.pieces.find((p) => p.id === props.selectedPieceId)
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[6, 10, 4]} intensity={0.9} />
      <Board
        radius={props.game.ruleset.board.radius}
        legalTargets={props.legalTargets}
        selectedCoordKey={selected ? coordKey(selected.at) : null}
        onTileClick={props.onTileClick}
      />
      <Pieces
        game={props.game}
        selectedPieceId={props.selectedPieceId}
        onPieceClick={props.onPieceClick}
      />
    </>
  )
}
```

- [ ] **Step 6: Verify the whole package still checks**

Run: `pnpm --filter client test && pnpm --filter client lint && pnpm --filter client build`
Expected: all green (components compile; smoke + unit tests pass).

- [ ] **Step 7: Commit**

```bash
git add apps/client
git commit -m "feat(client): instanced hex board and pieces rendered from GameState"
```

---

### Task 6: Interaction flow, lobby, and HUD

**Files:**
- Create: `apps/client/src/interaction.ts`, `apps/client/src/ui/Lobby.tsx`, `apps/client/src/ui/Hud.tsx`, `apps/client/src/ui/hud.css`
- Modify: `apps/client/src/App.tsx`, `apps/client/src/main.tsx`
- Test: `apps/client/test/interaction.test.ts`

**Interfaces:**
- Consumes: store (Task 3), `sendIntent`/`createMatch`/`joinMatch`/`reconnectMatch` (Task 4), `MatchScene` (Task 5), `coordKey` from `@meridian/rules`.
- Produces:
  - `interaction.ts`: `clickTile(c: Coord): void` (no selection → no-op; illegal target → clear selection; legal target → `sendIntent({type:'move', pieceId, to})` + clear), `clickPiece(id: string): void` (own piece → `selectPiece`; enemy piece → treat its hex as a tile click, enabling click-to-capture), `endTurn(): void` → `sendIntent({type:'endTurn'})`.
  - `Lobby`: Create-match button; join form (4-letter input, uppercased); error line; disabled while `connecting`. Test ids: `create-button`, `join-input`, `join-button`, `lobby-error`.
  - `Hud`: join-code display (`data-testid="join-code"`, shown while `waiting` and during play), status line (`data-testid="status"`: "waiting for opponent" / "your turn" / "opponent's turn" / "reconnecting…"), END TURN button (`data-testid="end-turn"`, disabled off-turn), transient error toast (`data-testid="rule-error"`, auto-clears after 3s via a `useEffect` timer calling `setError(null)`), match-ended banner (`data-testid="winner-banner"`, text "You win" / "You lose" plus "(forfeit)" when applicable).
  - `App`: attempts `reconnectMatch()` once on mount; renders `Lobby` when `idle`/`connecting`/`error` (error message shown), otherwise the `<Canvas>` (camera `{ position: [0, 9.5, 8.5], fov: 45 }`, `onCreated` lookAt origin) with `MatchScene` + `Hud` overlay. The old spinning-icosahedron stub is deleted.

- [ ] **Step 1: Write the failing test**

`apps/client/test/interaction.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialState, placeholderRuleset } from '@meridian/rules'

const sent: unknown[] = []
vi.mock('../src/net/connection', () => ({
  sendIntent: (intent: unknown) => {
    sent.push(intent)
  },
}))

import { useMeridianStore } from '../src/store'
import { clickPiece, clickTile, endTurn } from '../src/interaction'

beforeEach(() => {
  sent.length = 0
  useMeridianStore.getState().reset()
  useMeridianStore.getState().setSeat(0)
  useMeridianStore.getState().setGame(initialState(placeholderRuleset))
})

describe('click flow', () => {
  it('select own piece, then a legal tile → move intent sent, selection cleared', () => {
    clickPiece('p0-0')
    expect(useMeridianStore.getState().selectedPieceId).toBe('p0-0')
    clickTile({ q: -2, r: 0 })
    expect(sent).toEqual([{ type: 'move', pieceId: 'p0-0', to: { q: -2, r: 0 } }])
    expect(useMeridianStore.getState().selectedPieceId).toBeNull()
  })

  it('clicking an illegal tile clears the selection without sending', () => {
    clickPiece('p0-0')
    clickTile({ q: 0, r: 0 })
    expect(sent).toEqual([])
    expect(useMeridianStore.getState().selectedPieceId).toBeNull()
  })

  it('clicking a tile with no selection is a no-op', () => {
    clickTile({ q: -2, r: 0 })
    expect(sent).toEqual([])
  })

  it("clicking an enemy piece with a selection targets its hex (capture path)", () => {
    // rig: our piece adjacent to the enemy
    const base = initialState(placeholderRuleset)
    const rigged = {
      ...base,
      pieces: base.pieces.map((p) => (p.id === 'p0-0' ? { ...p, at: { q: 2, r: 0 } } : p)),
    }
    useMeridianStore.getState().setGame(rigged)
    clickPiece('p0-0')
    clickPiece('p1-0') // enemy on (3,0) — in legal targets
    expect(sent).toEqual([{ type: 'move', pieceId: 'p0-0', to: { q: 3, r: 0 } }])
  })

  it('endTurn sends the pass intent', () => {
    endTurn()
    expect(sent).toEqual([{ type: 'endTurn' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test`
Expected: FAIL — cannot resolve `../src/interaction`.

- [ ] **Step 3: Implement interaction**

`apps/client/src/interaction.ts`:

```ts
import { coordKey, type Coord } from '@meridian/rules'
import { sendIntent } from './net/connection'
import { useMeridianStore } from './store'

export function clickTile(c: Coord): void {
  const s = useMeridianStore.getState()
  const pieceId = s.selectedPieceId
  if (!pieceId) return
  if (!s.legalTargets.has(coordKey(c))) {
    s.clearSelection()
    return
  }
  sendIntent({ type: 'move', pieceId, to: c })
  s.clearSelection()
}

export function clickPiece(id: string): void {
  const s = useMeridianStore.getState()
  const piece = s.game?.pieces.find((p) => p.id === id)
  if (!piece) return
  if (piece.owner === s.seat) {
    s.selectPiece(id)
    return
  }
  clickTile(piece.at) // enemy piece: capture attempt on its hex
}

export function endTurn(): void {
  sendIntent({ type: 'endTurn' })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter client test`
Expected: PASS.

- [ ] **Step 5: Implement lobby, HUD, and App**

`apps/client/src/ui/hud.css`:

```css
.overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: #e8e8f0;
}
.overlay > * { pointer-events: auto; }
.panel {
  position: absolute;
  top: 12px;
  left: 12px;
  background: rgba(12, 14, 20, 0.8);
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 14px;
}
.panel .code { font-size: 22px; letter-spacing: 0.3em; font-weight: 700; }
.end-turn {
  position: absolute;
  bottom: 18px;
  right: 18px;
  padding: 10px 18px;
  font-size: 15px;
  border: 0;
  border-radius: 8px;
  background: #2c6e8f;
  color: #fff;
  cursor: pointer;
}
.end-turn:disabled { opacity: 0.4; cursor: default; }
.toast {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  background: #7a2f2f;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
}
.banner {
  position: absolute;
  top: 40%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(12, 14, 20, 0.9);
  padding: 20px 40px;
  border-radius: 12px;
  font-size: 28px;
  font-weight: 700;
}
.lobby {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: #0d1017;
  color: #e8e8f0;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.lobby input {
  text-transform: uppercase;
  letter-spacing: 0.3em;
  font-size: 18px;
  padding: 8px 12px;
  width: 8ch;
  text-align: center;
}
.lobby button { padding: 10px 22px; font-size: 15px; cursor: pointer; }
.lobby .error { color: #ff8080; font-size: 13px; }
```

`apps/client/src/ui/Lobby.tsx`:

```tsx
import { useState } from 'react'
import { createMatch, joinMatch } from '../net/connection'
import { useMeridianStore } from '../store'

export function Lobby() {
  const status = useMeridianStore((s) => s.status)
  const error = useMeridianStore((s) => s.error)
  const setError = useMeridianStore((s) => s.setError)
  const [code, setCode] = useState('')
  const busy = status === 'connecting'

  async function withCatch(fn: () => Promise<void>): Promise<void> {
    try {
      setError(null)
      await fn()
    } catch {
      setError('could not reach the match — check the code and try again')
      useMeridianStore.getState().setStatus('idle')
    }
  }

  return (
    <div className="lobby">
      <h1>Meridian</h1>
      <button data-testid="create-button" disabled={busy} onClick={() => void withCatch(createMatch)}>
        Create match
      </button>
      <div>
        <input
          data-testid="join-input"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="CODE"
        />
        <button
          data-testid="join-button"
          disabled={busy || code.length !== 4}
          onClick={() => void withCatch(() => joinMatch(code))}
        >
          Join
        </button>
      </div>
      {error && (
        <div className="error" data-testid="lobby-error">
          {error}
        </div>
      )}
    </div>
  )
}
```

`apps/client/src/ui/Hud.tsx`:

```tsx
import { useEffect } from 'react'
import { endTurn } from '../interaction'
import { useMeridianStore } from '../store'

export function Hud() {
  const { status, joinCode, seat, game, error, matchResult, setError } = useMeridianStore()

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 3000)
    return () => clearTimeout(t)
  }, [error, setError])

  const ourTurn = game !== null && seat !== null && game.winner === null && game.currentPlayer === seat
  const statusText =
    status === 'waiting'
      ? 'waiting for opponent'
      : status === 'reconnecting'
        ? 'reconnecting…'
        : status === 'ended'
          ? 'match over'
          : ourTurn
            ? 'your turn'
            : "opponent's turn"

  const winnerText =
    matchResult !== null || (game && game.winner !== null)
      ? (matchResult?.winner ?? game?.winner) === seat
        ? `You win${matchResult?.reason === 'forfeit' ? ' (forfeit)' : ''}`
        : `You lose${matchResult?.reason === 'forfeit' ? ' (forfeit)' : ''}`
      : null

  return (
    <div className="overlay">
      <div className="panel">
        {joinCode && (
          <div>
            code <span className="code" data-testid="join-code">{joinCode}</span>
          </div>
        )}
        <div data-testid="status">{statusText}</div>
      </div>
      <button className="end-turn" data-testid="end-turn" disabled={!ourTurn} onClick={endTurn}>
        END TURN
      </button>
      {error && (
        <div className="toast" data-testid="rule-error">
          {error}
        </div>
      )}
      {winnerText && (
        <div className="banner" data-testid="winner-banner">
          {winnerText}
        </div>
      )}
    </div>
  )
}
```

`apps/client/src/App.tsx` (replaces the stub entirely):

```tsx
import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { MatchScene } from './scene/MatchScene'
import { Lobby } from './ui/Lobby'
import { Hud } from './ui/Hud'
import { clickPiece, clickTile } from './interaction'
import { reconnectMatch } from './net/connection'
import { useMeridianStore } from './store'
import './ui/hud.css'

export function App() {
  const status = useMeridianStore((s) => s.status)
  const game = useMeridianStore((s) => s.game)
  const selectedPieceId = useMeridianStore((s) => s.selectedPieceId)
  const legalTargets = useMeridianStore((s) => s.legalTargets)

  useEffect(() => {
    void reconnectMatch()
  }, [])

  if (status === 'idle' || status === 'connecting' || status === 'error') return <Lobby />

  return (
    <>
      <Canvas
        camera={{ position: [0, 9.5, 8.5], fov: 45 }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <color attach="background" args={['#0d1017']} />
        {game && (
          <MatchScene
            game={game}
            selectedPieceId={selectedPieceId}
            legalTargets={legalTargets}
            onTileClick={clickTile}
            onPieceClick={clickPiece}
          />
        )}
      </Canvas>
      <Hud />
    </>
  )
}
```

`apps/client/src/main.tsx` is unchanged except it keeps rendering `<App />`.

Update `apps/client/test/smoke.test.tsx` if it asserts on the old stub: it only checks `App` is a renderable function — leave as-is if green.

- [ ] **Step 6: Verify the package + manual smoke**

Run: `pnpm --filter client test && pnpm --filter client lint && pnpm --filter client build`
Expected: all green.

Then with the server running (`pnpm --filter server dev`), run `pnpm --filter client dev`, open two browser windows manually: create in one, join by code in the other, make one move and one END TURN. Confirm highlighting and movement visually. Note observations in the report.

- [ ] **Step 7: Commit**

```bash
git add apps/client
git commit -m "feat(client): lobby, HUD, and click-to-move interaction wired to the server"
```

---

### Task 7: Board surface shader + SHADERS.md

**Files:**
- Create: `apps/client/src/scene/boardMaterial.ts`, `docs/SHADERS.md`
- Modify: `apps/client/src/scene/Board.tsx`
- Test: `apps/client/test/boardMaterial.test.ts`

**Interfaces:**
- Consumes: `TILE_STATE` (Task 5's choke point), three.
- Produces: `createBoardMaterial(): THREE.ShaderMaterial` with uniforms `uTime` (seconds) and `uQualityTier` (reserved, default 1); the material reads a per-instance float attribute **`aState`** (values = `TILE_STATE`). `Board` switches from `meshStandardMaterial`+`setColorAt` to this material + an `InstancedBufferAttribute` for `aState`, still driven through `tileStateFor`; a single `useFrame` updates `uTime` (one uniform write, zero allocations). `docs/SHADERS.md` documents the uniform/attribute contract for future piece/VFX shaders.

- [ ] **Step 1: Write the failing test**

`apps/client/test/boardMaterial.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createBoardMaterial } from '../src/scene/boardMaterial'

describe('createBoardMaterial', () => {
  it('exposes the documented uniform contract', () => {
    const mat = createBoardMaterial()
    expect(mat.uniforms.uTime?.value).toBe(0)
    expect(mat.uniforms.uQualityTier?.value).toBe(1)
  })

  it('declares the per-instance state attribute in the vertex shader', () => {
    const mat = createBoardMaterial()
    expect(mat.vertexShader).toContain('attribute float aState')
    expect(mat.fragmentShader).toContain('uTime')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter client test`
Expected: FAIL — cannot resolve `../src/scene/boardMaterial`.

- [ ] **Step 3: Implement**

`apps/client/src/scene/boardMaterial.ts`:

```ts
import * as THREE from 'three'

const vertexShader = /* glsl */ `
attribute float aState;
varying float vState;
varying vec3 vLocal;
varying vec3 vWorld;

void main() {
  vState = aState;
  vLocal = position;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uQualityTier; // reserved: future quality-tier switch point
varying float vState;
varying vec3 vLocal;
varying vec3 vWorld;

// cheap hash noise — deliberately neutral placeholder styling
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // base: subtle radial gradient darkening away from board center
  float dist = length(vWorld.xz) * 0.06;
  vec3 base = mix(vec3(0.13, 0.15, 0.19), vec3(0.07, 0.08, 0.11), clamp(dist, 0.0, 1.0));

  // animated shimmer
  float n = hash(floor(vWorld.xz * 3.0) + floor(uTime * 2.0));
  base += n * 0.02;

  // side faces darker than the top
  float top = smoothstep(0.02, 0.06, vLocal.y);
  base *= mix(0.55, 1.0, top);

  // state tinting: 0 none, 1 hover, 2 legal, 3 selected
  if (vState > 2.5) {
    base = mix(base, vec3(0.62, 0.5, 0.2), 0.75);
  } else if (vState > 1.5) {
    float pulse = 0.6 + 0.4 * sin(uTime * 3.0);
    base = mix(base, vec3(0.2, 0.55, 0.4), 0.55 * pulse + 0.2);
  } else if (vState > 0.5) {
    base = mix(base, vec3(0.35, 0.4, 0.5), 0.5);
  }

  gl_FragColor = vec4(base, 1.0);
}
`

export function createBoardMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uQualityTier: { value: 1 },
    },
  })
}
```

- [ ] **Step 4: Switch the Board to the shader**

In `apps/client/src/scene/Board.tsx`:

1. Add imports: `import { useFrame } from '@react-three/fiber'`, `import { createBoardMaterial } from './boardMaterial'`, and `TILE_STATE` from `./tileVisuals`.
2. Create the material and the state attribute once:

```tsx
const material = useMemo(() => createBoardMaterial(), [])
useEffect(() => () => material.dispose(), [material])
const stateAttr = useMemo(
  () => new THREE.InstancedBufferAttribute(new Float32Array(coords.length), 1),
  [coords],
)
useEffect(() => {
  geometry.setAttribute('aState', stateAttr)
}, [geometry, stateAttr])
```

3. Replace the body of `paint()`: instead of `setColorAt`, write numeric states:

```tsx
function paint(): void {
  keys.forEach((key, i) => {
    stateAttr.array[i] = TILE_STATE[tileStateFor(key, hoveredRef.current, selectedCoordKey, legalTargets)]
  })
  stateAttr.needsUpdate = true
}
```

(`paint` no longer needs the mesh ref; adjust guards accordingly.)

4. Drive time — one uniform write per frame, nothing else:

```tsx
useFrame((state) => {
  material.uniforms.uTime!.value = state.clock.elapsedTime
})
```

5. Pass the material via args: `args={[geometry, material, coords.length]}` and delete the `<meshStandardMaterial />` child.

- [ ] **Step 5: Write `docs/SHADERS.md`**

```markdown
# Meridian Shaders

Custom GLSL is a core pillar (BRIEF §1). This file documents the shared
plumbing contract so every shader (board, pieces, VFX) composes instead of
reinventing.

## Conventions

- Materials are created by factory functions in `apps/client/src/scene/`
  (`createBoardMaterial()`), returning `THREE.ShaderMaterial` with typed
  uniform objects.
- **Uniforms (shared names):**
  - `uTime` — seconds, written once per frame by the owning component's
    `useFrame` (single uniform write; no allocations).
  - `uQualityTier` — reserved quality switch (1 = full). No shader branches
    on it yet; it exists so adaptive quality can be added without touching
    material call sites.
- **Per-instance attributes:**
  - `aState` (float, board tiles) — visual state id from
    `tileVisuals.TILE_STATE`: 0 none, 1 hover, 2 legal, 3 selected. Written
    only through `Board`'s `paint()` choke point; never per frame.
- Instance transforms come from `instanceMatrix` — every vertex shader must
  multiply `modelMatrix * instanceMatrix`.

## Current shaders

### Board surface (`boardMaterial.ts`)

Neutral placeholder styling (final art direction arrives with the game
design cycle): radial gradient base, hashed shimmer animated by `uTime`,
top/side face separation from local Y, and state tinting (selected amber,
legal pulsing green, hover lightened). One draw call for the whole board.
```

- [ ] **Step 6: Run tests + visual check**

Run: `pnpm --filter client test && pnpm --filter client lint && pnpm --filter client build`
Expected: all green.

With server + client dev running, visually confirm: animated board surface, hover lightening, pulsing legal highlights after selecting a piece, amber selected tile. Note observations in the report.

- [ ] **Step 7: Commit**

```bash
git add apps/client docs/SHADERS.md
git commit -m "feat(client): custom board surface shader with per-instance state attribute"
```

---

### Task 8: Milestone-1 E2E, perf snapshot, docs

**Files:**
- Create: `apps/client/src/dev/debugHooks.tsx`, `apps/client/e2e/match.spec.ts`, `apps/client/playwright.config.ts`
- Modify: `apps/client/src/App.tsx` (mount debug hooks in dev), `apps/client/package.json` (playwright devDep + `test:e2e` script), `README.md` (client section), `docs/PLAN.md` (check off tasks 10–13)
- Create: `docs/PERF.md`

**Interfaces:**
- Consumes: everything above; `@playwright/test ^1.48`.
- Produces: a dev-only `window.__meridianDebug` (mounted from inside the Canvas via a component so it can use `useThree`) exposing `worldToScreen(coordKey: string): { x: number; y: number }` (projects `coordToWorld` through the live camera to CSS pixels) and `renderInfo(): { drawCalls: number; triangles: number }` (from `gl.info.render`); the two-browser E2E; `docs/PERF.md` with measured numbers. `test:e2e` is a separate script — NOT part of `turbo run test` (needs installed browsers and the game server).

- [ ] **Step 1: Add playwright**

In `apps/client/package.json` devDependencies add `"@playwright/test": "^1.48.0"`; scripts add `"test:e2e": "playwright test"`. Run `pnpm install`, then `pnpm --filter client exec playwright install chromium`.

Also scope vitest away from the playwright specs — in `apps/client/vitest.config.ts` set:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.{ts,tsx}'] },
})
```

(`vitest run` must never pick up `e2e/*.spec.ts` — those need real browsers.)

- [ ] **Step 2: Implement the debug hooks**

`apps/client/src/dev/debugHooks.tsx`:

```tsx
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { coordToWorld } from '../scene/layout'

const SCRATCH = new THREE.Vector3()

interface MeridianDebug {
  worldToScreen(coordKey: string): { x: number; y: number }
  renderInfo(): { drawCalls: number; triangles: number }
}

declare global {
  interface Window {
    __meridianDebug?: MeridianDebug
  }
}

/** Mounted inside the Canvas, dev builds only. Gives the E2E real screen
 *  coordinates so its clicks travel the genuine raycasting path. */
export function DebugHooks() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)

  useEffect(() => {
    window.__meridianDebug = {
      worldToScreen(key: string) {
        const [qs, rs] = key.split(',')
        const [x, y, z] = coordToWorld({ q: Number(qs), r: Number(rs) })
        SCRATCH.set(x, y, z).project(camera)
        return {
          x: ((SCRATCH.x + 1) / 2) * size.width,
          y: ((1 - SCRATCH.y) / 2) * size.height,
        }
      },
      renderInfo() {
        return { drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles }
      },
    }
    return () => {
      delete window.__meridianDebug
    }
  }, [camera, gl, size])

  return null
}
```

In `App.tsx`, inside the `<Canvas>` alongside `MatchScene`:

```tsx
{import.meta.env.DEV && <DebugHooks />}
```

- [ ] **Step 3: Playwright config**

`apps/client/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: [
    {
      command: 'pnpm --filter server start',
      cwd: '../..',
      port: 2567,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev',
      port: 5173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
```

- [ ] **Step 4: Write the E2E**

`apps/client/e2e/match.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

/** Click the canvas at the projected screen position of a board coord —
 *  the click travels the real R3F raycasting path. */
async function clickCoord(page: Page, key: string): Promise<void> {
  const pos = await page.evaluate((k) => window.__meridianDebug!.worldToScreen(k), key)
  await page.mouse.click(pos.x, pos.y)
}

async function statusText(page: Page): Promise<string> {
  return (await page.getByTestId('status').textContent()) ?? ''
}

test('two browsers complete a full match to a win', async ({ browser }) => {
  const host = await (await browser.newContext()).newPage()
  const guest = await (await browser.newContext()).newPage()

  // Lobby: create, read the code, join from the second browser.
  await host.goto('/')
  await host.getByTestId('create-button').click()
  await expect(host.getByTestId('join-code')).toBeVisible()
  const code = (await host.getByTestId('join-code').textContent())!.trim()
  expect(code).toMatch(/^[A-Z]{4}$/)

  await guest.goto('/')
  await guest.getByTestId('join-input').fill(code)
  await guest.getByTestId('join-button').click()

  await expect(host.getByTestId('status')).toHaveText('your turn')
  await expect(guest.getByTestId('status')).toHaveText("opponent's turn")

  // Host (seat 0) marches p0-0 from (-3,0) across the board, capturing all
  // three guest pieces; guest passes every turn. Same path the server's own
  // scripted-match test uses.
  const path = ['-2,0', '-1,0', '0,0', '1,0', '2,0', '3,0', '3,-1', '3,-2']
  let from = '-3,0'
  for (const target of path) {
    await expect(host.getByTestId('status')).toHaveText('your turn')
    await clickCoord(host, from) // select our piece
    await clickCoord(host, target) // move / capture
    from = target

    // stop passing once the match is over
    const hostBanner = host.getByTestId('winner-banner')
    if (await hostBanner.isVisible().catch(() => false)) break
    if (target === '3,-2') break
    await expect(guest.getByTestId('status')).toHaveText('your turn')
    await guest.getByTestId('end-turn').click()
  }

  await expect(host.getByTestId('winner-banner')).toHaveText(/You win/)
  await expect(guest.getByTestId('winner-banner')).toHaveText(/You lose/)
})

test('perf snapshot: single-digit draw calls', async ({ browser }) => {
  const host = await (await browser.newContext()).newPage()
  const guest = await (await browser.newContext()).newPage()
  await host.goto('/')
  await host.getByTestId('create-button').click()
  const code = (await host.getByTestId('join-code').textContent())!.trim()
  await guest.goto('/')
  await guest.getByTestId('join-input').fill(code)
  await guest.getByTestId('join-button').click()
  await expect(host.getByTestId('status')).toHaveText('your turn')

  const info = await host.evaluate(() => window.__meridianDebug!.renderInfo())
  console.log('PERF renderInfo:', JSON.stringify(info))
  expect(info.drawCalls).toBeLessThan(10)
})
```

(TypeScript note: the `window.__meridianDebug` global declaration lives in `debugHooks.tsx`; the e2e tsconfig scope already includes `src` — if `tsc` complains about the global in `e2e/`, add `"e2e"` to the tsconfig `include`.)

- [ ] **Step 5: Run the E2E**

Run: `pnpm --filter client test:e2e`
Expected: both tests pass. Capture the logged `PERF renderInfo` numbers and an approximate fps (from browser devtools or a brief manual check with the dev overlay) for the next step. If a timing flake appears in the match loop, prefer tightening the `await expect(...status...)` synchronization over adding sleeps.

- [ ] **Step 6: Write `docs/PERF.md` and update docs**

`docs/PERF.md` (fill the measured values from Step 5 — the numbers below are the budget, the actuals column is measured):

```markdown
# Meridian Performance Snapshots

Pillar 2 (BRIEF): 60fps on mid-range laptops and phones; instancing;
draw-call budget; no per-frame allocations.

## Milestone 1 — placeholder ruleset, radius-3 board (2026-08)

| Metric | Budget | Measured |
|---|---|---|
| Draw calls (match scene) | < 10 | (from E2E renderInfo) |
| Triangles | < 50k | (from E2E renderInfo) |
| FPS (desktop, dev build) | 60 | (observed) |

Method: `window.__meridianDebug.renderInfo()` (dev-only hook) read by
`apps/client/e2e/match.spec.ts`; fps observed via browser devtools
performance panel during a match.

Techniques in force: one InstancedMesh for tiles + one for pieces;
per-instance `aState`/color attributes instead of material swaps; matrices
rewritten only on state changes; single `uTime` uniform write per frame;
zero per-frame allocations (module-level scratch objects).
```

In `README.md`, replace the client line under Monorepo with:

```markdown
- `apps/client` — Vite + React Three Fiber client: lobby with join codes,
  instanced shader-styled hex board, click-to-move vs the authoritative
  server. Two-browser E2E: `pnpm --filter client test:e2e` (requires
  `playwright install chromium`).
```

In `docs/PLAN.md`, tick the four client checkboxes (tasks 10–13) — mark each `- [x]`.

- [ ] **Step 7: Full verification**

Run:

```bash
pnpm turbo run lint build --force
pnpm turbo run test --concurrency=1 --force
pnpm --filter client test:e2e
```

Expected: everything green (server's 14 tests untouched and passing; client unit tests + both E2E tests pass).

- [ ] **Step 8: Commit**

```bash
git add apps/client README.md docs/PERF.md docs/PLAN.md
git commit -m "feat(client): two-browser milestone-1 e2e, dev debug hooks, perf snapshot"
```
