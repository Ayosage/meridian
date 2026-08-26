import { describe, expect, it } from 'vitest'
import { SEAT_COLORS, seatColor } from '../src/scene/catan/palette'

describe('seat colors', () => {
  it('eight distinct seat colors, no fallback grey inside 0..7', () => {
    expect(SEAT_COLORS).toHaveLength(8)
    expect(new Set(SEAT_COLORS).size).toBe(8)
    for (let s = 0; s < 8; s++) expect(seatColor(s)).not.toBe('#999999')
  })
})
