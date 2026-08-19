import { describe, expect, it } from 'vitest'
import { TILE_COLORS, TILE_STATE, tileStateFor } from '../src/scene/tileVisuals'

describe('tileStateFor', () => {
  const legal = new Set(['-2,0', '-2,-1'])

  it('selected beats legal beats hover beats none', () => {
    expect(tileStateFor('-3,0', null, '-3,0', legal)).toBe('selected')
    expect(tileStateFor('-2,0', '-2,0', null, legal)).toBe('legal')
    expect(tileStateFor('1,1', '1,1', null, legal)).toBe('hover')
    expect(tileStateFor('1,1', null, null, legal)).toBe('none')
  })

  it('exposes a color and a numeric state id for every state', () => {
    for (const name of Object.keys(TILE_STATE) as (keyof typeof TILE_STATE)[]) {
      expect(TILE_COLORS[name]).toHaveLength(3)
      expect(typeof TILE_STATE[name]).toBe('number')
    }
  })
})
