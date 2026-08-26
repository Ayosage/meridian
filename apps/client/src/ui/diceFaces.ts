import * as THREE from 'three'

export type DieValue = 1 | 2 | 3 | 4 | 5 | 6
export const DIE_VALUES: readonly DieValue[] = [1, 2, 3, 4, 5, 6]

/**
 * Local-space outward normal of each pip face on the KayKit D6_A model
 * (public/assets/dice/d6.glb), read off axis-aligned renders of the mesh.
 * Standard die: opposite faces sum to 7.
 */
export const FACE_NORMALS: Record<DieValue, readonly [number, number, number]> = {
  1: [0, -1, 0],
  2: [1, 0, 0],
  3: [0, 0, 1],
  4: [0, 0, -1],
  5: [-1, 0, 0],
  6: [0, 1, 0],
}

const Z = new THREE.Vector3(0, 0, 1)

/** Rotation that turns `value`'s face toward the camera (+Z). */
export function faceQuaternion(value: DieValue): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...FACE_NORMALS[value]), Z)
}
