import type { CreateResult } from '@meridian/match-core'

/**
 * Pure handler for Steward's create-match endpoint (docs/GAME-ADAPTER.md v1,
 * plus the v0 `seatNames` shape). No Workers imports; index.ts wires it to the
 * MATCH namespace, tests inject deps.
 */
export interface LaunchDeps {
  createRoom: (
    code: string,
    options: {
      players: number
      bots: number
      launched: true
      seatNames?: string[]
      callback?: { url: string; token: string }
    },
  ) => Promise<CreateResult>
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

export async function handleCreateMatch(
  authHeader: string | undefined,
  body: unknown,
  deps: LaunchDeps,
): Promise<LaunchResult> {
  // an unset/empty LAUNCH_TOKEN must refuse everything, not accept "Bearer "
  if (!deps.launchToken || authHeader !== `Bearer ${deps.launchToken}`)
    return { status: 401, body: { error: 'bad token' } }
  const b = (body ?? {}) as Record<string, unknown>
  const players = b.players
  if (typeof players !== 'number') return { status: 422, body: { error: 'players is required' } }
  const bots = b.bots ?? 0
  if (typeof bots !== 'number') return { status: 422, body: { error: 'bots must be a number' } }
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
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = deps.newCode()
    const result = await deps.createRoom(code, {
      players,
      bots,
      launched: true,
      ...(seatNames ? { seatNames: seatNames as string[] } : {}),
      ...(callback ? { callback } : {}),
    })
    if (result.status === 'conflict') continue
    if (result.status === 'invalid') return { status: 422, body: { error: result.message } }
    return {
      status: 201,
      body: {
        code,
        joinUrl: `${deps.clientOrigin}/?join=${code}`,
        expiresAt: new Date(deps.now() + LAUNCH_EXPIRE_MS).toISOString(),
      },
    }
  }
  return { status: 503, body: { error: 'could not allocate a room code' } }
}
