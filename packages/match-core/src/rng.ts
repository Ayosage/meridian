import type { Rng } from './adapter'

/** mulberry32, same generator family as @meridian/rules' createRng. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

/**
 * The rng for the intent that will become `seq`. Derived, never persisted:
 * replaying (seed, seq) yields the same rolls, and a retried alarm cannot
 * advance the stream twice.
 */
export function intentRng(seed: number, seq: number): Rng {
  return mulberry32((seed ^ Math.imul(seq + 1, 0x9e3779b9)) >>> 0)
}
