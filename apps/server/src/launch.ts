/**
 * Pure handler for the Discord-launch create-match endpoint
 * (docs/DISCORD-LAUNCH.md, contract v0). No HTTP or Colyseus imports —
 * app.config.ts wires it to express and the matchMaker; tests inject deps.
 */
export interface LaunchDeps {
  createRoom: (options: Record<string, unknown>) => Promise<{ roomId: string }>
  clientOrigin: string
  launchToken: string
  now: () => number
}

export interface LaunchResult {
  status: number
  body: Record<string, unknown>
}

export const LAUNCH_EXPIRE_MS = 30 * 60 * 1000

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
