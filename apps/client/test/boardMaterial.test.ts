import { describe, expect, it } from 'vitest'
import { createBoardMaterial } from '../src/scene/boardMaterial'

describe('createBoardMaterial', () => {
  it('exposes the documented uniform contract', () => {
    const mat = createBoardMaterial()
    expect(mat.uniforms.uTime?.value).toBe(0)
    expect(mat.uniforms.uQualityTier?.value).toBe(1)
  })

  it('declares the per-instance state attribute in the vertex shader', () => {
    const mat = createBoardMaterial()
    expect(mat.vertexShader).toContain('attribute float aState')
    expect(mat.fragmentShader).toContain('uTime')
  })
})
