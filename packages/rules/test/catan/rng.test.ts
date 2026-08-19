import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { createRng, pick, rollD6, shuffle } from '../../src/catan'

describe('seeded rng', () => {
  it('same seed produces the same sequence', () => {
    const a = createRng(42)
    const b = createRng(42)
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next())
  })

  it('different seeds diverge', () => {
    const a = createRng(1)
    const b = createRng(2)
    const as = Array.from({ length: 10 }, () => a.next())
    const bs = Array.from({ length: 10 }, () => b.next())
    expect(as).not.toEqual(bs)
  })

  it('next() stays in [0,1) (property)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rng = createRng(seed)
        for (let i = 0; i < 50; i++) {
          const v = rng.next()
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThan(1)
        }
      }),
    )
  })

  it('rollD6 covers 1..6 and nothing else', () => {
    const rng = createRng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) seen.add(rollD6(rng))
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('shuffle returns a permutation and does not mutate (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 30 }), fc.integer(), (arr, seed) => {
        const original = [...arr]
        const out = shuffle(createRng(seed), arr)
        expect(arr).toEqual(original)
        expect([...out].sort((x, y) => x - y)).toEqual([...arr].sort((x, y) => x - y))
      }),
    )
  })

  it('pick returns an element of the array', () => {
    const rng = createRng(3)
    for (let i = 0; i < 50; i++) expect(['a', 'b', 'c']).toContain(pick(rng, ['a', 'b', 'c']))
  })
})
