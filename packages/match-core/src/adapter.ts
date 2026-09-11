import type { ZodType } from 'zod'

export interface Rng {
  /** Uniform in [0, 1). Same contract as @meridian/rules' Rng. */
  next(): number
}

export interface RuleError {
  code: string
  message: string
}
export function isRuleError(x: unknown): x is RuleError {
  return typeof x === 'object' && x !== null && 'code' in x && 'message' in x && !('turn' in x)
}

export type DriveKind = 'bot' | 'pilot'

export interface Placement {
  seat: number
  placement: number
  winner: boolean
  stats: Record<string, unknown>
}

/**
 * Everything a game supplies to MatchObject. S = full state (server only),
 * I = client intent (no player field), V = per-seat view, E = event.
 */
export interface GameAdapter<S, I, V, E> {
  slug: string
  players: { min: number; max: number }
  intentSchema: ZodType<I>
  create(opts: { playerCount: number; seed: number; [k: string]: unknown }, rng: Rng): S
  /** The engine's reducer; `player` is the seat the object derived from the socket. */
  apply(state: S, intent: I & { player: number }, rng: Rng): S | RuleError
  view(state: S, seat: number): V
  events(before: S, intent: I & { player: number }, after: S): E[]
  redactEvent(event: E, seat: number): E
  /** Next mandatory (pilot) or competent (bot) move for a seat with no human; null when nothing is pending. */
  drive(
    state: S,
    seat: number,
    kind: DriveKind,
    rng: Rng,
    memory: unknown,
  ): { intent: (I & { player: number }) | null; memory: unknown }
  driveDelayMs(kind: DriveKind): number
  /** Bot trade offers: is one open, and has every other seat answered? */
  offerWindow(state: S): { open: boolean; everyoneAnswered: boolean }
  offerWindowMs: number
  isEnded(state: S): boolean
  winner(state: S): number | null
  result(state: S): Placement[]
  /** Turn number, for per-turn bot memory. */
  turnNumber(state: S): number
  /** The seat the game is waiting on this turn. */
  currentSeat(state: S): number
}
