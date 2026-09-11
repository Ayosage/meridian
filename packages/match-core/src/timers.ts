export const TIMER_KEYS = ['pilot', 'offer', 'abandon', 'expiry', 'webhook'] as const
export type TimerKey = (typeof TIMER_KEYS)[number]
/** Epoch ms per timer, null when unarmed. Persisted; the single DO alarm is set to the earliest. */
export type Deadlines = Record<TimerKey, number | null>

export const NO_DEADLINES: Deadlines = { pilot: null, offer: null, abandon: null, expiry: null, webhook: null }

export function earliest(d: Deadlines): number | null {
  let best: number | null = null
  for (const k of TIMER_KEYS) {
    const v = d[k]
    if (v !== null && (best === null || v < best)) best = v
  }
  return best
}

/** Keys whose deadline is at or before `now`, soonest first. */
export function dueKeys(d: Deadlines, now: number): TimerKey[] {
  return TIMER_KEYS.filter((k) => d[k] !== null && d[k]! <= now).sort((a, b) => d[a]! - d[b]!)
}
