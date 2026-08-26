import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DIE_VALUES, FACE_NORMALS, faceQuaternion } from '../src/ui/diceFaces'

describe('diceFaces', () => {
  it('encodes a standard die: opposite faces sum to 7 and point opposite ways', () => {
    for (const [a, b] of [
      [1, 6],
      [2, 5],
      [3, 4],
    ] as const) {
      const na = new THREE.Vector3(...FACE_NORMALS[a])
      const nb = new THREE.Vector3(...FACE_NORMALS[b])
      expect(na.dot(nb)).toBeCloseTo(-1)
      expect(na.length()).toBeCloseTo(1)
    }
  })

  it('faceQuaternion turns each face normal toward the camera (+Z)', () => {
    for (const value of DIE_VALUES) {
      const rotated = new THREE.Vector3(...FACE_NORMALS[value]).applyQuaternion(
        faceQuaternion(value),
      )
      expect(rotated.x).toBeCloseTo(0)
      expect(rotated.y).toBeCloseTo(0)
      expect(rotated.z).toBeCloseTo(1)
    }
  })
})
