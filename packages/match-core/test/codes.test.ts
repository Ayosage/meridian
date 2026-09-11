import { describe, expect, it } from 'vitest'
import { randomCode } from '../src/codes'

describe('randomCode', () => {
  it('is four uppercase letters, driven by the supplied random source', () => {
    expect(randomCode(() => 0)).toBe('AAAA')
    expect(randomCode(() => 0.999)).toBe('ZZZZ')
    expect(randomCode(Math.random)).toMatch(/^[A-Z]{4}$/)
  })
})
