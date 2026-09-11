import { describe, expect, it } from 'vitest'
import { intentRng } from '../src/rng'

describe('intentRng', () => {
  it('is deterministic per (seed, seq) and differs across seq', () => {
    const a = intentRng(42, 7)
    const b = intentRng(42, 7)
    const c = intentRng(42, 8)
    const A = [a.next(), a.next()]
    const B = [b.next(), b.next()]
    const C = [c.next(), c.next()]
    expect(A).toEqual(B)
    expect(A).not.toEqual(C)
    for (const x of A) expect(x >= 0 && x < 1).toBe(true)
  })
})
