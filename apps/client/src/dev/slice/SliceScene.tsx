import { useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Clone, OrbitControls, useGLTF } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { coordToWorld } from '../../scene/layout'
import { createWaterMaterial } from '../../scene/catan/waterMaterial'
import { GoldenHourRig, SkyBackdrop } from '../../scene/catan/rig'

/**
 * Beauty-slice review scene (dev-only, /slice route).
 * Renders the exported GLB asset set with the real lighting rig + post stack
 * so art direction is reviewed as rendered pixels, never flat mockups.
 * Spec: docs/superpowers/specs/2026-08-19-beauty-slice-art-direction-design.md
 */

const ASSETS = '/assets/slice'
const TILE_TOP = 0.22
const WATER_Y = 0.05

// three mutually-adjacent tiles; settlement sits on their shared vertex
const TILES = [
  { coord: { q: 0, r: 0 }, dressing: 'terrain_mountains', token: [-0.45, 0.242, 0.35] },
  { coord: { q: 1, r: 0 }, dressing: 'terrain_forest', token: [0.6, 0.245, -0.1] },
  { coord: { q: 0, r: 1 }, dressing: 'terrain_fields', token: [-0.38, 0.292, -0.3] },
] as const

function sharedVertex(): [number, number, number] {
  const pts = TILES.map((t) => coordToWorld(t.coord))
  const x = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const z = pts.reduce((s, p) => s + p[2], 0) / pts.length
  return [x, TILE_TOP, z]
}

function useSliceGltf(name: string): THREE.Group {
  const { scene } = useGLTF(`${ASSETS}/${name}.glb`)
  return scene
}

function Tile({
  coord,
  dressing,
  token,
}: {
  coord: { q: number; r: number }
  dressing: string
  token: readonly [number, number, number]
}) {
  const puck = useSliceGltf('tile_base')
  const dress = useSliceGltf(dressing)
  const tok = useSliceGltf('token')
  const pos = coordToWorld(coord)
  return (
    <group position={pos}>
      <Clone object={puck} castShadow receiveShadow />
      <Clone object={dress} castShadow receiveShadow />
      <Clone object={tok} position={[token[0], token[1], token[2]]} castShadow receiveShadow />
    </group>
  )
}

function Pieces() {
  const settlement = useSliceGltf('settlement')
  const road = useSliceGltf('road')
  const vertex = sharedVertex()
  const a = coordToWorld(TILES[0].coord)
  const b = coordToWorld(TILES[1].coord)
  // road on the shared edge between tiles 0 and 1: edge runs perpendicular
  // to the center-to-center line, through its midpoint
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, TILE_TOP, (a[2] + b[2]) / 2]
  const angle = Math.atan2(b[2] - a[2], b[0] - a[0]) + Math.PI / 2
  return (
    <>
      <Clone
        object={settlement}
        position={vertex}
        rotation={[0, 0.5, 0]}
        scale={1.45}
        castShadow
        receiveShadow
      />
      <Clone
        object={road}
        position={mid}
        rotation={[0, angle, 0]}
        scale={[1, 1.45, 1.45]}
        castShadow
        receiveShadow
      />
    </>
  )
}

function Water() {
  const mat = useMemo(() => {
    const centers = TILES.map((t) => {
      const [x, , z] = coordToWorld(t.coord)
      return new THREE.Vector2(x, z)
    })
    return createWaterMaterial(centers)
  }, [])
  useFrame((_, dt) => {
    const t = mat.uniforms['uTime']
    if (t) t.value += dt
  })
  return (
    <mesh material={mat} position={[0.85, WATER_Y, 0.5]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[24, 24]} />
    </mesh>
  )
}

const CAMERA_PRESETS: Record<string, [number, number, number]> = {
  wide: [3.2, 2.6, 4.4],
  close: [1.9, 1.15, 2.4], // gameplay zoom: settlement/road/token legibility check
  low: [2.6, 0.7, 3.4], // hero shot along the water
}

export function SliceReview() {
  const params = new URLSearchParams(window.location.search)
  const tier = params.get('tier') ?? 'high'
  const cam = CAMERA_PRESETS[params.get('cam') ?? 'wide'] ?? CAMERA_PRESETS['wide']
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: cam, fov: 40, near: 0.3, far: 100 }}
      gl={{ antialias: true, toneMappingExposure: 1.15 }}
    >
      <SkyBackdrop />
      <GoldenHourRig />
      {TILES.map((t) => (
        <Tile key={`${t.coord.q},${t.coord.r}`} coord={t.coord} dressing={t.dressing} token={t.token} />
      ))}
      <Pieces />
      <Water />
      <OrbitControls target={[0.85, 0.2, 0.5]} maxPolarAngle={Math.PI * 0.49} />
      <EffectComposer>
        {tier === 'high' ? <N8AO halfRes intensity={2.5} aoRadius={0.4} /> : <></>}
        <Bloom luminanceThreshold={1.1} intensity={0.35} mipmapBlur />
        <Vignette eskil={false} offset={0.25} darkness={0.55} />
      </EffectComposer>
    </Canvas>
  )
}

useGLTF.preload(`${ASSETS}/tile_base.glb`)
useGLTF.preload(`${ASSETS}/terrain_mountains.glb`)
useGLTF.preload(`${ASSETS}/terrain_forest.glb`)
useGLTF.preload(`${ASSETS}/terrain_fields.glb`)
useGLTF.preload(`${ASSETS}/settlement.glb`)
useGLTF.preload(`${ASSETS}/road.glb`)
useGLTF.preload(`${ASSETS}/token.glb`)
