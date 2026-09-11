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

export type StartPlan =
  /** Not the host, or the table is not known yet: nothing to show. */
  | { kind: 'hidden' }
  /** The host may start now; `fill` empty seats would be taken by bots. */
  | { kind: 'ready'; fill: number }

/** Mirrors the match object: the host starts whenever they like and bots take every empty seat. */
export function startPlan(input: {
  isHost: boolean
  seated: number
  targetPlayers: number | null
  botCount: number
}): StartPlan {
  const { isHost, seated, targetPlayers } = input
  if (!isHost || targetPlayers === null) return { kind: 'hidden' }
  return { kind: 'ready', fill: Math.max(0, targetPlayers - seated) }
}

/** Most bots a table can hold: one seat stays for the host and one for each person already here. */
export function maxBots(targetPlayers: number, seated: number): number {
  return Math.max(0, targetPlayers - Math.max(1, seated))
}

/** "4 players, 1 bot": the table as a joiner reads it. */
export function tableSummary(targetPlayers: number, botCount: number): string {
  const bots = botCount === 0 ? 'no bots' : botCount === 1 ? '1 bot' : `${botCount} bots`
  return `${targetPlayers} players, ${bots}`
}

/**
 * Rule errors arrive as terse lower-case sentences ("not a legal road edge").
 * Players read them as a toast, so start them with a capital.
 */
export function friendlyRuleMessage(message: string): string {
  const m = message.trim()
  return m.charAt(0).toUpperCase() + m.slice(1)
}
