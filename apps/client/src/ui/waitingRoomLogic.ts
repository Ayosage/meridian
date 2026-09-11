/**
 * Pure model for the waiting room (no React, no store): what the host can do,
 * what the room is waiting for, and the invite link. Unit-tested directly.
 */

/** The `?join=CODE` deep link App.tsx already understands. */
export function inviteLink(origin: string, code: string): string {
  return `${origin}/?join=${code}`
}

/** Humans the room needs before it starts by itself. */
export function humanTarget(targetPlayers: number | null, botCount: number): number {
  return Math.max(0, (targetPlayers ?? 0) - botCount)
}

export type EarlyStart =
  /** Not the host: nothing to show. */
  | { kind: 'hidden' }
  /** Bots fill the room, so it starts the moment the last human arrives. */
  | { kind: 'auto' }
  /** Server rule: exactly target-1 humans seated and no bots. */
  | { kind: 'ready' }
  /** Host, but the rule is not met yet; say how many more are needed. */
  | { kind: 'needs'; players: number }

/** Mirrors CatanRoom.handleStart: only the host, only at target-1 seated, only without bots. */
export function earlyStart(input: {
  isHost: boolean
  seated: number
  targetPlayers: number | null
  botCount: number
}): EarlyStart {
  const { isHost, seated, targetPlayers, botCount } = input
  if (!isHost || targetPlayers === null) return { kind: 'hidden' }
  if (botCount > 0) return { kind: 'auto' }
  const needed = targetPlayers - 1
  if (seated >= 3 && seated === needed) return { kind: 'ready' }
  return { kind: 'needs', players: needed }
}

/**
 * Rule errors arrive as terse lower-case sentences ("not a legal road edge").
 * Players read them as a toast, so start them with a capital.
 */
export function friendlyRuleMessage(message: string): string {
  const m = message.trim()
  return m.charAt(0).toUpperCase() + m.slice(1)
}
