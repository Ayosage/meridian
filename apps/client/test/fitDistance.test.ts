import { describe, expect, it } from 'vitest'
import { fitDistance } from '../src/scene/catan/CatanScene'

// The radii CatanScene passes: |cameraPos| * sin(fov/2) for each board size.
const SMALL = 4.315
const BIG = 5.967
const FOV = 42

describe('fitDistance', () => {
  it('leaves a landscape window framed exactly as it always was', () => {
    // 16:9 and 4:3 are both wider than tall, so the vertical frustum limits
    // and the distance lands back on the old hardcoded camera positions.
    expect(fitDistance(SMALL, FOV, 16 / 9)).toBeCloseTo(Math.hypot(9, 8), 2)
    expect(fitDistance(BIG, FOV, 4 / 3)).toBeCloseTo(Math.hypot(12.5, 11), 2)
  })

  it('is the same distance for every window at least as wide as it is tall', () => {
    const square = fitDistance(SMALL, FOV, 1)
    expect(fitDistance(SMALL, FOV, 3)).toBeCloseTo(square, 6)
  })

  it('backs off as the window gets narrower, which is what uncropped the phone', () => {
    const desktop = fitDistance(SMALL, FOV, 16 / 9)
    const phone = fitDistance(SMALL, FOV, 390 / 844)
    expect(phone).toBeGreaterThan(desktop * 1.9)
    // far enough out that the whole board is inside the horizontal frustum
    const halfWidthAtBoard = phone * Math.tan(Math.atan(Math.tan((FOV * Math.PI) / 360) * (390 / 844)))
    expect(halfWidthAtBoard).toBeGreaterThanOrEqual(SMALL)
  })

  it('never puts the camera inside the board', () => {
    for (const aspect of [0.3, 0.5, 1, 2, 3.5]) {
      expect(fitDistance(SMALL, FOV, aspect)).toBeGreaterThan(SMALL)
    }
  })
})
