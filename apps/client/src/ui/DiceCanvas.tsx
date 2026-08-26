import { useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { faceQuaternion, type DieValue } from './diceFaces'

const ASSETS = '/assets/dice'
const TUMBLE_MS = 650
/** Spin phase of the tumble (rest of the timeline settles onto the face). */
const SPIN_PORTION = 0.55
/** Constant view-space tilt so a face-on die still shows edges and reads as 3D. */
const TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.32, -0.28, 0))
/** Idle pose before the first roll: corner toward camera, no face emphasized. */
const IDLE = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(1, 1, 1).normalize(),
  new THREE.Vector3(0, 0, 1),
)
const FULL_SPIN = Math.PI * 2

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function Die({ value, x }: { value: DieValue | null; x: number }) {
  const { nodes } = useGLTF(`${ASSETS}/d6.glb`) as unknown as {
    nodes: { D6_A: THREE.Mesh }
  }
  const invalidate = useThree((s) => s.invalidate)
  const group = useRef<THREE.Group>(null)
  const anim = useRef<{
    value: DieValue | null
    startedAt: number | null
    axis: THREE.Vector3
    from: THREE.Quaternion
  }>({ value: null, startedAt: null, axis: new THREE.Vector3(1, 0, 0), from: IDLE.clone() })

  if (anim.current.value !== value) {
    // New roll: remember where we are, pick a fresh spin axis, restart clock.
    // (Null — the pre-roll reset — snaps straight to the idle pose instead.)
    anim.current.value = value
    anim.current.startedAt = value === null ? null : performance.now()
    anim.current.from = group.current?.quaternion.clone() ?? IDLE.clone()
    anim.current.axis
      .set(Math.sin(x * 12.9898 + (value ?? 0) * 78.233), 1, Math.cos((value ?? 0) * 37.719))
      .normalize()
  }

  // Demand frameloop: a value change touches no R3F-managed prop, so nothing
  // would invalidate on its own — kick the loop; useFrame keeps it alive.
  useEffect(() => invalidate(), [value, invalidate])

  useFrame(() => {
    const g = group.current
    if (!g) return
    const target = value === null ? IDLE : faceQuaternion(value)
    const { startedAt, axis, from } = anim.current
    const t = startedAt === null ? 1 : Math.min((performance.now() - startedAt) / TUMBLE_MS, 1)
    if (t >= 1) {
      g.quaternion.copy(target)
      return
    }
    if (t < SPIN_PORTION) {
      // Fast decaying spin away from the previous pose.
      const angle = easeOutCubic(t / SPIN_PORTION) * FULL_SPIN
      g.quaternion.copy(from).multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle))
    } else {
      // Settle from the end of the spin onto the rolled face.
      const settle = easeOutCubic((t - SPIN_PORTION) / (1 - SPIN_PORTION))
      const spun = from.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, FULL_SPIN))
      g.quaternion.copy(spun.slerp(target, settle))
    }
    invalidate()
  })

  return (
    <group position={[x, 0, 0]} quaternion={TILT}>
      <group ref={group}>
        <mesh geometry={nodes.D6_A.geometry} material={nodes.D6_A.material} />
      </group>
    </group>
  )
}

/**
 * Two 3D dice (KayKit D6) in a small on-demand canvas — renders only while a
 * roll tumble is in flight (props changes auto-invalidate; useFrame keeps the
 * loop alive until the tumble lands), then the loop goes idle until next roll.
 */
export function DiceCanvas({ dice }: { dice: readonly [number, number] | null }) {
  return (
    <Canvas
      className="dice-canvas"
      style={{ width: 76, height: 38 }}
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [0, 0, 2.1], fov: 40 }}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[2, 3, 4]} intensity={1.6} />
      <Die value={(dice?.[0] ?? null) as DieValue | null} x={-0.52} />
      <Die value={(dice?.[1] ?? null) as DieValue | null} x={0.52} />
    </Canvas>
  )
}

useGLTF.preload(`${ASSETS}/d6.glb`)
