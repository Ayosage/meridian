import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { CatanBoard as CatanBoardData, CatanClientState } from '@meridian/rules'
import { coordToWorld } from '../layout'
import { CatanBoard } from './CatanBoard'
import { Highlights } from './Highlights'
import { PickLayer } from './PickLayer'
import { Pieces } from './Pieces'
import { createWaterMaterial } from './waterMaterial'
import { GoldenHourRig, SkyBackdrop } from './rig'

/**
 * Full 19-tile board render — the real client scene, driven by a
 * `CatanClientState` view (from the store, or a local dev preview).
 * Rig/water/post are promoted from the approved beauty slice (Task 8).
 */

const WATER_Y = 0.05
const WATER_SIZE = 28

/**
 * Takes `hexes` directly (not `view`) so its identity is decoupled from the
 * live snapshot: the store replaces `view` wholesale on every server push
 * (see catanStore.ingestSnapshot), and while the board layout itself never
 * changes mid-match (only `board.robber` does — see robber.ts), relying on
 * `view.board.hexes`' reference staying stable across every future state
 * transition would be fragile. CatanScene instead pins the hexes array once
 * (see boardHexesRef below) and passes that fixed reference here, so this
 * ShaderMaterial is built exactly once per match, never recompiled.
 */
function Water({ hexes }: { hexes: CatanBoardData['hexes'] }) {
  const mat = useMemo(() => {
    const centers = hexes.map((hex) => {
      const [x, , z] = coordToWorld(hex.coord)
      return new THREE.Vector2(x, z)
    })
    return createWaterMaterial(centers)
  }, [hexes])
  useFrame((_, dt) => {
    const t = mat.uniforms['uTime']
    if (t) t.value += dt
  })
  return (
    <mesh material={mat} position={[0, WATER_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[WATER_SIZE, WATER_SIZE]} />
    </mesh>
  )
}

/**
 * Dev-only perf probe: `window.__meridianDebug.catanRenderInfo()`, mirroring
 * the src/dev/debugHooks.tsx idiom (useThree -> useEffect -> window global).
 * Kept local rather than extending debugHooks.tsx's `MeridianDebug` type —
 * CatanScene mounts on routes (`/board`, and later the live match) that
 * debugHooks.tsx never does, so the two probes never collide at runtime.
 *
 * `gl.info` auto-resets on every internal `renderer.render()` call, and the
 * postprocessing EffectComposer makes several per frame (scene pass + each
 * effect pass) — reading it naively only sees the last (a 1-triangle
 * fullscreen blit). We disable autoReset and reset once ourselves at the
 * start of each frame (lowest priority = runs first) so calls/triangles
 * accumulate across the whole frame before we read them.
 */
function CatanDebugHooks() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.info.autoReset = false
    return () => {
      gl.info.autoReset = true
    }
  }, [gl])
  useFrame(() => {
    gl.info.reset()
  }, -1000)
  useEffect(() => {
    const w = window as unknown as { __meridianDebug?: Record<string, unknown> }
    w.__meridianDebug = {
      ...w.__meridianDebug,
      catanRenderInfo: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles }),
    }
    return () => {
      if (w.__meridianDebug) delete w.__meridianDebug['catanRenderInfo']
    }
  }, [gl])
  return null
}

export function CatanScene({ view }: { view: CatanClientState }) {
  // Pinned once on mount; see the Water doc comment above for why.
  const boardHexesRef = useRef(view.board.hexes)

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 9, 8], fov: 42, near: 0.3, far: 100 }}
      gl={{ antialias: true, toneMappingExposure: 1.15 }}
    >
      <SkyBackdrop />
      <GoldenHourRig />
      <CatanBoard board={view.board} />
      <Pieces view={view} />
      <PickLayer view={view} />
      <Highlights view={view} />
      <Water hexes={boardHexesRef.current} />
      <OrbitControls
        target={[0, 0, 0]}
        enablePan={false}
        minDistance={6}
        maxDistance={14}
        maxPolarAngle={Math.PI * 0.45}
      />
      <EffectComposer>
        <N8AO halfRes intensity={2.5} aoRadius={0.4} />
        <Bloom luminanceThreshold={1.1} intensity={0.35} mipmapBlur />
        <Vignette eskil={false} offset={0.25} darkness={0.55} />
      </EffectComposer>
      {import.meta.env.DEV && <CatanDebugHooks />}
    </Canvas>
  )
}
