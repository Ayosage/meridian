import type { CreateResult } from '@meridian/match-core'

/**
 * Pure handlers for room creation. Steward's launch (docs/GAME-ADAPTER.md v1,
 * plus the v0 `seatNames` shape) is bearer-authenticated; the browser's own
 * Create button uses the open variant. No Workers imports; index.ts wires
 * both to the MATCH namespace, tests inject deps.
 */
export interface RoomOptions {
  players: number
  bots: number
  launched: boolean
  seatNames?: string[]
  callback?: { url: string; token: string }
  /** Test knobs (seed, targetVp, delays); the object ignores them unless TEST_KNOBS=1. */
  knobs?: Record<string, unknown>
}

export interface LaunchDeps {
  createRoom: (code: string, options: RoomOptions) => Promise<CreateResult>
  newCode: () => string
  clientOrigin: string
  launchToken: string
  now: () => number
}

export interface LaunchResult {
  status: number
  body: Record<string, unknown>
}

export const LAUNCH_EXPIRE_MS = 30 * 60 * 1000
const CODE_ATTEMPTS = 20

/** Pick a free code and create the room; 422 for invalid options, 503 when no code is free. */
async function allocate(deps: LaunchDeps, options: RoomOptions): Promise<LaunchResult> {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = deps.newCode()
    const result = await deps.createRoom(code, options)
    if (result.status === 'conflict') continue
    if (result.status === 'invalid') return { status: 422, body: { error: result.message } }
    return {
      status: 201,
      body: {
        code,
        joinUrl: `${deps.clientOrigin}/?join=${code}`,
        ...(options.launched ? { expiresAt: new Date(deps.now() + LAUNCH_EXPIRE_MS).toISOString() } : {}),
      },
    }
  }
  return { status: 503, body: { error: 'could not allocate a room code' } }
}

function counts(b: Record<string, unknown>): { players: number; bots: number } | LaunchResult {
  const players = b.players
  if (typeof players !== 'number') return { status: 422, body: { error: 'players is required' } }
  const bots = b.bots ?? 0
  if (typeof bots !== 'number') return { status: 422, body: { error: 'bots must be a number' } }
  return { players, bots }
}

/** Steward → game: `POST /matches` with the shared bearer token. */
export async function handleCreateMatch(
  authHeader: string | undefined,
  body: unknown,
  deps: LaunchDeps,
): Promise<LaunchResult> {
  // an unset/empty LAUNCH_TOKEN must refuse everything, not accept "Bearer "
  if (!deps.launchToken || authHeader !== `Bearer ${deps.launchToken}`)
    return { status: 401, body: { error: 'bad token' } }
  const b = (body ?? {}) as Record<string, unknown>
  const c = counts(b)
  if ('status' in c) return c
  // v0 sent seatNames; v1 sends seats: [{ seatToken?, displayName? }]. Names are cosmetic pre-labels either way.
  const seatNames =
    b.seatNames ??
    (Array.isArray(b.seats)
      ? (b.seats as { displayName?: unknown }[]).map((s) => (typeof s?.displayName === 'string' ? s.displayName : ''))
      : undefined)
  if (seatNames !== undefined && !(Array.isArray(seatNames) && seatNames.every((n) => typeof n === 'string')))
    return { status: 422, body: { error: 'seatNames must be an array of strings' } }
  let callback: { url: string; token: string } | undefined
  if (b.callback !== undefined) {
    const cb = b.callback as { url?: unknown; token?: unknown } | null
    if (!cb || typeof cb.url !== 'string' || typeof cb.token !== 'string')
      return { status: 422, body: { error: 'callback must be { url, token }' } }
    callback = { url: cb.url, token: cb.token }
  }
  return allocate(deps, {
    ...c,
    launched: true,
    ...(seatNames ? { seatNames: seatNames as string[] } : {}),
    ...(callback ? { callback } : {}),
  })
}

/** Browser → game: `POST /matches/open`, no token. An ad-hoc room that is not launched (no invite expiry). */
export async function handleOpenMatch(body: unknown, deps: LaunchDeps): Promise<LaunchResult> {
  const b = (body ?? {}) as Record<string, unknown>
  const c = counts(b)
  if ('status' in c) return c
  const knobs = typeof b.knobs === 'object' && b.knobs !== null ? (b.knobs as Record<string, unknown>) : undefined
  return allocate(deps, { ...c, launched: false, ...(knobs ? { knobs } : {}) })
}
