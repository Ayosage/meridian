# Discord Launch (Meridian Half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meridian's side of the Discord-launch contract: an authenticated `POST /matches` endpoint that creates a room and returns a join URL, a client that joins straight from `?join=CODE`, and expiry for launched rooms nobody joins.

**Architecture:** The HTTP route rides on `initializeExpress` in `@colyseus/tools`' config (confirmed available in the installed 0.16.20). Route logic lives in a pure, dependency-injected handler module so it unit-tests without HTTP plumbing; the express wiring is one thin block. Room creation goes through Colyseus `matchMaker.createRoom('catan', options)` — the same options a lobby client sends, plus `launched: true` which arms an unstarted-room expiry timer in CatanRoom. The client reads `?join=` at boot with the same `numberParam`-style idiom net/catan.ts already uses for `?seed=`.

**Tech Stack:** Colyseus 0.16 (@colyseus/tools, matchMaker), express (bundled with @colyseus/tools), Vitest, @colyseus/testing for room tests.

**Spec:** `docs/DISCORD-LAUNCH.md` (contract v0). The steward half is out of scope here — it is a task in `webdev/steward/docs/PLAN.md` and blocks only on this contract, not on this code.

## Global Constraints

- TDD per repo convention; suites `pnpm -C apps/server test`, `pnpm -C apps/client test`; typecheck per package.
- Contract fields are fixed by docs/DISCORD-LAUNCH.md: request `{ players, bots?, seatNames? }`; response `{ code, joinUrl, expiresAt }`; errors 401/422/503; join URL `<CLIENT_ORIGIN>/?join=<CODE>`.
- Secrets via env only: `LAUNCH_TOKEN`, `CLIENT_ORIGIN`. Never commit values; document in an `.env.example`.
- v0 caps `players` at what CatanRoom accepts (3|4 today; the 8-player plan lifts it — these two plans are independent and either can land first; this plan validates against CatanRoom's own range by delegating, not duplicating, the check).
- No emoji in any copy.

## File Structure

- Create: `apps/server/src/launch.ts` — pure handler: validation, auth, response shaping. One responsibility: turn a request body + deps into a status/body pair.
- Modify: `apps/server/src/app.config.ts` — `initializeExpress` wiring (~15 lines).
- Modify: `apps/server/src/rooms/CatanRoom.ts` — `launched`/`expireMs` options, unstarted-room expiry.
- Modify: `apps/client/src/net/catan.ts` — export `launchJoinCode()`; App boot wiring in `apps/client/src/App.tsx`.
- Create: `apps/server/.env.example`.

---

### Task 1: Pure launch handler

**Files:**
- Create: `apps/server/src/launch.ts`
- Test: `apps/server/test/launch.test.ts`

**Interfaces:**
- Produces:

```typescript
export interface LaunchDeps {
  createRoom: (options: Record<string, unknown>) => Promise<{ roomId: string }>
  clientOrigin: string
  launchToken: string
  now: () => number
}
export interface LaunchResult { status: number; body: Record<string, unknown> }
export const LAUNCH_EXPIRE_MS = 30 * 60 * 1000
export async function handleCreateMatch(
  authHeader: string | undefined,
  body: unknown,
  deps: LaunchDeps,
): Promise<LaunchResult>
```

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it, vi } from 'vitest'
import { handleCreateMatch, LAUNCH_EXPIRE_MS, type LaunchDeps } from '../src/launch'

function deps(overrides: Partial<LaunchDeps> = {}): LaunchDeps {
  return {
    createRoom: vi.fn(async () => ({ roomId: 'ABCD' })),
    clientOrigin: 'https://play.example',
    launchToken: 'sekrit',
    now: () => 1_000_000,
    ...overrides,
  }
}

describe('handleCreateMatch', () => {
  it('creates a room and shapes the contract response', async () => {
    const d = deps()
    const r = await handleCreateMatch('Bearer sekrit', { players: 4, bots: 1 }, d)
    expect(r.status).toBe(201)
    expect(r.body).toEqual({
      code: 'ABCD',
      joinUrl: 'https://play.example/?join=ABCD',
      expiresAt: new Date(1_000_000 + LAUNCH_EXPIRE_MS).toISOString(),
    })
    expect(d.createRoom).toHaveBeenCalledWith({ players: 4, bots: 1, launched: true })
  })

  it('401 on a missing or wrong bearer token, without touching the matchmaker', async () => {
    const d = deps()
    expect((await handleCreateMatch(undefined, { players: 4 }, d)).status).toBe(401)
    expect((await handleCreateMatch('Bearer wrong', { players: 4 }, d)).status).toBe(401)
    expect(d.createRoom).not.toHaveBeenCalled()
  })

  it('422 when the room constructor rejects the options (bad counts)', async () => {
    const d = deps({ createRoom: vi.fn(async () => { throw new Error('players must be 3 or 4') }) })
    const r = await handleCreateMatch('Bearer sekrit', { players: 11 }, d)
    expect(r.status).toBe(422)
    expect(r.body.error).toMatch(/players/)
  })

  it('passes seatNames through only when they are an array of strings', async () => {
    const d = deps()
    await handleCreateMatch('Bearer sekrit', { players: 4, seatNames: ['Alice', 'Bob'] }, d)
    expect(d.createRoom).toHaveBeenCalledWith({ players: 4, bots: 0, launched: true, seatNames: ['Alice', 'Bob'] })
    const r = await handleCreateMatch('Bearer sekrit', { players: 4, seatNames: 'Alice' }, d)
    expect(r.status).toBe(422)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C apps/server test launch`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `launch.ts`**

```typescript
export const LAUNCH_EXPIRE_MS = 30 * 60 * 1000

export async function handleCreateMatch(
  authHeader: string | undefined,
  body: unknown,
  deps: LaunchDeps,
): Promise<LaunchResult> {
  if (authHeader !== `Bearer ${deps.launchToken}`) return { status: 401, body: { error: 'bad token' } }
  const b = (body ?? {}) as Record<string, unknown>
  const players = b.players
  if (typeof players !== 'number') return { status: 422, body: { error: 'players is required' } }
  const bots = b.bots ?? 0
  if (typeof bots !== 'number') return { status: 422, body: { error: 'bots must be a number' } }
  const seatNames = b.seatNames
  if (seatNames !== undefined && !(Array.isArray(seatNames) && seatNames.every((n) => typeof n === 'string')))
    return { status: 422, body: { error: 'seatNames must be an array of strings' } }
  try {
    const { roomId } = await deps.createRoom({
      players,
      bots,
      launched: true,
      ...(seatNames !== undefined ? { seatNames } : {}),
    })
    return {
      status: 201,
      body: {
        code: roomId,
        joinUrl: `${deps.clientOrigin}/?join=${roomId}`,
        expiresAt: new Date(deps.now() + LAUNCH_EXPIRE_MS).toISOString(),
      },
    }
  } catch (e) {
    return { status: 422, body: { error: e instanceof Error ? e.message : 'room creation failed' } }
  }
}
```

(Interfaces from the block above go at the top of the file.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm -C apps/server test launch` — PASS; full server suite still green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/launch.ts apps/server/test/launch.test.ts
git commit -m "feat(server): pure create-match launch handler (contract v0)"
```

---

### Task 2: Express wiring + env

**Files:**
- Modify: `apps/server/src/app.config.ts`
- Create: `apps/server/.env.example`
- Test: `apps/server/test/launch-http.test.ts`

**Interfaces:**
- Consumes: `handleCreateMatch`, `LaunchDeps` (Task 1); `matchMaker` from `colyseus`.

- [ ] **Step 1: Write the failing integration test**

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import appConfig from '../src/app.config'

let server: ColyseusTestServer
beforeAll(async () => {
  process.env.LAUNCH_TOKEN = 'test-token'
  process.env.CLIENT_ORIGIN = 'http://localhost:5173'
  server = await boot(appConfig)
})
afterAll(async () =>
  await server.shutdown())

describe('POST /matches over HTTP', () => {
  it('creates a joinable room', async () => {
    const res = await fetch('http://127.0.0.1:2568/matches', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ players: 4, bots: 3 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { code: string; joinUrl: string }
    expect(body.joinUrl).toBe(`http://localhost:5173/?join=${body.code}`)
    const room = await server.sdk.joinById(body.code)
    await room.leave()
  })

  it('401 without the token', async () => {
    const res = await fetch('http://127.0.0.1:2568/matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ players: 4 }),
    })
    expect(res.status).toBe(401)
  })
})
```

Note: `@colyseus/testing` boots on port 2568 by default — verify the port in the first run's failure output and pin whatever it actually uses (if it picks a random port, read it from `server.http?.port ?? server.sdk` — check the `ColyseusTestServer` type for the exposed address and adjust the URL accordingly; the assertion structure stays the same).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C apps/server test launch-http`
Expected: FAIL — 404 (route not wired).

- [ ] **Step 3: Wire the route in app.config.ts**

```typescript
import config from '@colyseus/tools'
import { matchMaker } from 'colyseus'
import express from 'express'
import { handleCreateMatch } from './launch'
import { MatchRoom } from './rooms/MatchRoom'
import { CatanRoom } from './rooms/CatanRoom'

export default config({
  initializeGameServer: (gameServer) => {
    gameServer.define('match', MatchRoom)
    gameServer.define('catan', CatanRoom)
  },
  initializeExpress: (app) => {
    app.post('/matches', express.json(), async (req, res) => {
      const result = await handleCreateMatch(req.headers.authorization, req.body, {
        createRoom: (options) => matchMaker.createRoom('catan', options),
        clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
        launchToken: process.env.LAUNCH_TOKEN ?? '',
        now: Date.now,
      })
      res.status(result.status).json(result.body)
    })
  },
})
```

Guard: when `LAUNCH_TOKEN` is unset/empty, the handler must refuse everything — add to launch.ts's auth check: `if (!deps.launchToken || authHeader !== ...) return 401` and a unit test for it in `launch.test.ts` (empty token + matching empty header → still 401).

`.env.example`:

```
# Discord-launch endpoint (docs/DISCORD-LAUNCH.md)
LAUNCH_TOKEN=change-me
CLIENT_ORIGIN=http://localhost:5173
PORT=2567
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm -C apps/server test` — all green (including the new empty-token unit test).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/app.config.ts apps/server/src/launch.ts apps/server/test .env.example apps/server/.env.example
git commit -m "feat(server): POST /matches HTTP endpoint behind LAUNCH_TOKEN"
```

---

### Task 3: Launched-room expiry

**Files:**
- Modify: `apps/server/src/rooms/CatanRoom.ts`
- Test: `apps/server/test/launch-expiry.test.ts`

**Interfaces:**
- Consumes: room options now include `launched?: boolean`, and (test hook, same idiom as `pilotDelayMs`) `launchExpireMs?: number`.
- Produces: a `launched: true` room disposes itself if the match has not started when the expiry fires; a started match never expires.

- [ ] **Step 1: Write the failing test**

```typescript
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import appConfig from '../src/app.config'

let server: ColyseusTestServer
beforeAll(async () => { server = await boot(appConfig) })
afterAll(async () => { await server.shutdown() })
afterEach(async () => { await server.cleanup() })

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('launched-room expiry', () => {
  it('an unjoined launched room disposes after the expiry window', async () => {
    const { matchMaker } = await import('colyseus')
    const { roomId } = await matchMaker.createRoom('catan', { players: 4, bots: 3, launched: true, launchExpireMs: 100 })
    await settle(250)
    await expect(server.sdk.joinById(roomId)).rejects.toThrow()
  })

  it('a launched room that started plays on past the window', async () => {
    const { matchMaker } = await import('colyseus')
    const { roomId } = await matchMaker.createRoom('catan', {
      players: 4, bots: 3, launched: true, launchExpireMs: 100, seed: 1, pilotDelayMs: 0,
    })
    const client = await server.sdk.joinById(roomId)
    await settle(250)
    // still alive: the room accepts a message without throwing
    client.send('startEarly')
    await settle(50)
    await client.leave()
  })
})
```

Adjust the "started" trigger to the room's actual start mechanics: a `players:4 bots:3` room starts on the single human join (see companion-room.test.ts line 89's phrasing) — if so, the join itself is the start and the `startEarly` send can be dropped.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C apps/server test launch-expiry`
Expected: first test FAILS — joinById succeeds because nothing disposes the room.

- [ ] **Step 3: Implement in CatanRoom `onCreate`**

```typescript
// after existing option validation:
if (options.launched) {
  const expireMs = typeof options.launchExpireMs === 'number' ? options.launchExpireMs : 30 * 60 * 1000
  this.clock.setTimeout(() => {
    // 'playing'/'ended' phases mean the lobby became a match — never expire those
    if (this.state.phase === 'waiting') void this.disconnect()
  }, expireMs)
}
```

Check the actual lobby-phase field name at the top of CatanRoom (`this.state.phase` values are used at `schedulePilot`: `'playing'`); use whatever value the waiting lobby holds (grep `state.phase =` in the file) — the guard is "not started yet".

- [ ] **Step 4: Run to verify pass**

Run: `pnpm -C apps/server test` — all green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/rooms/CatanRoom.ts apps/server/test/launch-expiry.test.ts
git commit -m "feat(server): launched rooms expire if the match never starts"
```

---

### Task 4: Client ?join=CODE boot path

**Files:**
- Modify: `apps/client/src/net/catan.ts`
- Modify: `apps/client/src/App.tsx`
- Test: `apps/client/test/launchJoin.test.ts`

**Interfaces:**
- Produces: `launchJoinCode(search: string): string | null` exported from net/catan.ts — extracts and normalizes the `join` query param (uppercase, trimmed, 1–12 chars of A–Z0–9), else null.
- Consumes: existing `joinCatanMatch(code)` (net/catan.ts:65) and the store's `status` state.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { launchJoinCode } from '../src/net/catan'

describe('launchJoinCode', () => {
  it('extracts and normalizes the join code', () => {
    expect(launchJoinCode('?join=abcd')).toBe('ABCD')
    expect(launchJoinCode('?seed=3&join=  xyzw ')).toBe('XYZW')
  })
  it('rejects absent or malformed codes', () => {
    expect(launchJoinCode('')).toBeNull()
    expect(launchJoinCode('?join=')).toBeNull()
    expect(launchJoinCode('?join=has spaces here')).toBeNull()
    expect(launchJoinCode('?join=WAY-TOO-LONG-FOR-A-ROOM-ID')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C apps/client test launchJoin`
Expected: FAIL — `launchJoinCode` not exported.

- [ ] **Step 3: Implement**

net/catan.ts:

```typescript
/** ?join=CODE from a launch link (docs/DISCORD-LAUNCH.md) — normalized room code, or null. */
export function launchJoinCode(search: string): string | null {
  const raw = new URLSearchParams(search).get('join')?.trim().toUpperCase() ?? ''
  return /^[A-Z0-9]{1,12}$/.test(raw) ? raw : null
}
```

App.tsx — extend the existing boot effect:

```typescript
useEffect(() => {
  const code = launchJoinCode(window.location.search)
  if (code) {
    void joinCatanMatch(code)
    // strip the param so a reload after the match doesn't rejoin a dead room
    window.history.replaceState(null, '', window.location.pathname)
  } else {
    void reconnectCatan()
  }
}, [])
```

A failed join must land the user in the Lobby with the store's existing error surface — verify `joinCatanMatch`'s failure path sets `status: 'error'` (grep its catch in net/catan.ts); if it throws unhandled instead, wrap: `joinCatanMatch(code).catch(() => useCatanStore.getState().setStatus('error'))` matching the store's actual error API.

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `pnpm -C apps/client test && pnpm -C apps/client exec tsc --noEmit` — green.

- [ ] **Step 5: Manual verification** — spare-port server+client; `curl -X POST -H "Authorization: Bearer $LAUNCH_TOKEN" -H "content-type: application/json" -d '{"players":4,"bots":3}' http://localhost:2569/matches`; open the returned joinUrl (swap origin for the spare client port); confirm you land seated in the waiting room and the match starts.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src apps/client/test/launchJoin.test.ts
git commit -m "feat(client): join a launched match straight from ?join=CODE"
```

---

### Task 5: seatNames pass-through (cosmetic v0)

**Files:**
- Modify: `apps/server/src/rooms/CatanRoom.ts` — store `options.seatNames` (string array, already validated by the handler) and expose them on the lobby schema: add `seatNames = new ArraySchema<string>()` to the room's lobby state class (find the schema class the room instantiates — grep `targetPlayers` in apps/server/src to locate it) filled in `onCreate`.
- Modify: `apps/client/src/ui/WaitingRoom.tsx` — where seats render, label seat i with `seatNames[i]` when present, else the current default.
- Test: `apps/server/test/launch.test.ts` already covers handler validation; extend `apps/server/test/launch-http.test.ts` roundtrip: create with `seatNames: ['Alice']`, join, assert `room.state.seatNames[0] === 'Alice'`.

- [ ] **Step 1: Extend the failing http test** (assert on `room.state.seatNames`). Run: FAIL — field absent.
- [ ] **Step 2: Implement schema field + WaitingRoom label.**
- [ ] **Step 3: Suites + typecheck green.**
- [ ] **Step 4: Commit**

```bash
git add apps/server/src apps/client/src/ui/WaitingRoom.tsx apps/server/test
git commit -m "feat: seatNames pass-through from launch to the waiting room"
```

---

### Task 6: Deployment scaffolding (ops)

**Files:**
- Create: `apps/server/fly.toml` (Fly app, internal port from `PORT`, WS-friendly: `[[services]]` TCP+TLS on 443→2567, health check on `/`; secrets `LAUNCH_TOKEN`, `CLIENT_ORIGIN` set via `fly secrets set`, never in the file)
- Create: `apps/server/Dockerfile` (node:20-slim, pnpm workspace install with `--filter @meridian/server...`, `CMD ["pnpm","-C","apps/server","start"]`)
- Modify: `docs/DISCORD-LAUNCH.md` — flip the status line to "endpoint implemented; deployment pending/live", record the deployed origins once known.
- Client hosting: static `pnpm -C apps/client build` output; any static host works — decide with the user at execution time (the repo has no Vercel/Fly preference recorded for meridian; steward's ecosystem is Fly). `VITE_SERVER_URL` must point at the deployed WS origin at build time.

- [ ] **Step 1: Write both files** (no tests — ops).
- [ ] **Step 2: Verify locally** — `docker build -f apps/server/Dockerfile .` completes; container starts and `POST /matches` answers 401 without a token.
- [ ] **Step 3: Commit**

```bash
git add apps/server/fly.toml apps/server/Dockerfile docs/DISCORD-LAUNCH.md
git commit -m "ops: server container + fly config for the launch endpoint"
```

Actual `fly launch`/`fly deploy` and DNS are interactive with the user — not plan steps.

---

## Self-review notes

- Contract coverage vs docs/DISCORD-LAUNCH.md: endpoint fields/auth/errors (Tasks 1–2), joinUrl format + client path (Tasks 2, 4), expiry + expiresAt (Tasks 1, 3), seatNames (Task 5), deployment (Task 6). Steward column intentionally out of scope.
- Types consistent: `LaunchDeps`/`LaunchResult`/`handleCreateMatch`/`LAUNCH_EXPIRE_MS` (Task 1) are what Task 2 wires; `launchJoinCode` (Task 4) is self-contained.
- Two known verify-at-execution points are called out inline rather than guessed: the @colyseus/testing HTTP port (Task 2) and the lobby-phase field value (Task 3).
- 503-at-capacity from the contract is intentionally not implemented: matchMaker has no hard cap today; the handler's catch-all 422 covers refusals. If a cap arrives, it slots into the handler with one status branch. Noted here so the gap is a decision, not an oversight.
