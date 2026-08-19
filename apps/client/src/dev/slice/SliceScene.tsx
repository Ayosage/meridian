import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Clone, OrbitControls, useGLTF } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { coordToWorld } from '../../scene/layout'
import { createWaterMaterial } from './waterMaterial'
import { palette } from './palette'

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

/**
 * Stylized golden-hour backdrop: warm horizon wash all around (like a studio
 * seamless behind a photographed miniature), cool slate zenith, and an extra
 * peach glow on the sun side. Deliberately not physical — the physical sky
 * puts all warmth behind the default cameras.
 */
function SkyBackdrop() {
  const mat = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color('#4a5d80') },
        uHorizon: { value: new THREE.Color('#e8b98a') },
        uGlow: { value: new THREE.Color('#ffcf9a') },
        uSunDir: { value: new THREE.Vector3(6.5, 2.9, 4.5).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGlow;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
          float sunAmt = pow(max(dot(d, normalize(uSunDir)), 0.0), 6.0);
          col = mix(col, uGlow, sunAmt * (1.0 - h) * 0.9);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
  }, [])
  return (
    <mesh material={mat} renderOrder={-1}>
      <sphereGeometry args={[60, 32, 16]} />
    </mesh>
  )
}

function GoldenHourRig() {
  const sun = useRef<THREE.DirectionalLight>(null)
  return (
    <>
      {/* warm low sun, ~22 deg elevation, raking in from front-right */}
      <directionalLight
        ref={sun}
        color={palette.light.sun}
        intensity={5.5}
        position={[6.5, 2.9, 4.5]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={4}
        shadow-bias={-0.0004}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-far={25}
      />
      {/* cool sky fill in the shadows */}
      <hemisphereLight args={[palette.light.skyFill, palette.light.groundFill, 0.45]} />
      {/* faint warm bounce so shadow sides don't go dead */}
      <directionalLight color="#ff9a5e" intensity={0.5} position={[-4, 1.5, -3]} />
    </>
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
