/** Injected randomness (spec §3): dice, shuffles, and robber steals are reproducible. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
}

/** mulberry32 — tiny, deterministic, good enough for game randomness. */
export function createRng(seed: number): Rng {
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

export function rollD6(rng: Rng): number {
  return 1 + Math.floor(rng.next() * 6)
}

/** Non-mutating Fisher–Yates. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)]!
}
