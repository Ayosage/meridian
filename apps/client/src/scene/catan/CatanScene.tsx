import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { coordKey, type CatanBoard as CatanBoardData, type CatanClientState } from '@meridian/rules'
import { coordToWorld } from '../layout'
import { CatanBoard } from './CatanBoard'
import { edgeWorld, TILE_TOP, vertexWorld, WATER_Y } from './catanLayout'
import { legalEdgesForMode, legalVerticesForMode, useCatanStore } from './catanStore'
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


/**
 * Takes `hexes` directly (not `view`) so its identity is decoupled from the
 * live snapshot: the store replaces `view` wholesale on every server push
 * (see catanStore.ingestSnapshot), and while the board layout itself never
 * changes mid-match (only `board.robber` does — see robber.ts), relying on
 * `view.board.hexes`' reference staying stable across every future state
 * transition would be fragile. CatanScene passes the pinned board's hexes
 * (see useStableBoard below) here, so this ShaderMaterial is built exactly
 * once per match, never recompiled.
 */
function Water({ hexes, size }: { hexes: CatanBoardData['hexes']; size: number }) {
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
      <planeGeometry args={[size, size]} />
    </mesh>
  )
}

/** Scratch vector for `project()` below — reused across calls, never per-frame (dev-only, called on demand). */
const PROJECT_SCRATCH = new THREE.Vector3()

interface ScreenTarget {
  kind: 'vertex' | 'edge' | 'hex'
  id: string
  x: number
  y: number
}

/**
 * Dev-only perf + E2E probe: `window.__meridianDebug.catanRenderInfo()` and
 * `.legalTargetsOnScreen()`, mirroring the src/dev/debugHooks.tsx idiom
 * (useThree -> useEffect -> window global). Kept local rather than extending
 * debugHooks.tsx's `MeridianDebug` type — CatanScene mounts on routes
 * (`/board`, and the live match) that debugHooks.tsx never does, so the two
 * probes never collide at runtime.
 *
 * `gl.info` auto-resets on every internal `renderer.render()` call, and the
 * postprocessing EffectComposer makes several per frame (scene pass + each
 * effect pass) — reading it naively only sees the last (a 1-triangle
 * fullscreen blit). We disable autoReset and reset once ourselves at the
 * start of each frame (lowest priority = runs first) so calls/triangles
 * accumulate across the whole frame before we read them.
 *
 * `legalTargetsOnScreen()` projects every vertex/edge legal for the current
 * mode (robber mode: every non-robbed hex) to CSS pixel coordinates via the
 * live camera + canvas size, the same world->screen math as
 * dev/debugHooks.tsx's `worldToScreen` — so an E2E driver can
 * `page.mouse.click(x, y)` straight onto the real raycasting path without
 * reimplementing legality (reuses catanStore's legalVerticesForMode/
 * legalEdgesForMode) or hardcoding board geometry.
 */
function CatanDebugHooks() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

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
    function project(pos: readonly [number, number, number]): { x: number; y: number } {
      PROJECT_SCRATCH.set(pos[0], pos[1], pos[2]).project(camera)
      return {
        x: ((PROJECT_SCRATCH.x + 1) / 2) * size.width,
        y: ((1 - PROJECT_SCRATCH.y) / 2) * size.height,
      }
    }

    function legalTargetsOnScreen(): { mode: string; targets: ScreenTarget[] } {
      const { view, seat, mode } = useCatanStore.getState()
      if (view === null || seat === null) return { mode: mode.kind, targets: [] }
      const targets: ScreenTarget[] = []
      for (const id of legalVerticesForMode(view, seat, mode)) {
        const pos = vertexWorld(view.board.hexes).get(id)
        if (pos) targets.push({ kind: 'vertex', id, ...project(pos) })
      }
      for (const id of legalEdgesForMode(view, seat, mode)) {
        const e = edgeWorld(view.board.hexes).get(id)
        if (e) targets.push({ kind: 'edge', id, ...project(e.pos) })
      }
      if (mode.kind === 'robber') {
        for (const hex of view.board.hexes) {
          const key = coordKey(hex.coord)
          if (key === view.board.robber) continue
          const [x, , z] = coordToWorld(hex.coord)
          targets.push({ kind: 'hex', id: key, ...project([x, TILE_TOP, z]) })
        }
      }
      return { mode: mode.kind, targets }
    }

    const w = window as unknown as { __meridianDebug?: Record<string, unknown> }
    w.__meridianDebug = {
      ...w.__meridianDebug,
      catanRenderInfo: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles }),
      legalTargetsOnScreen,
      // This seat's redacted snapshot + seat number, for the companion-bot
      // driver's heuristics (pip-weighted placement, robber targeting, trade
      // evaluation). Same information the HUD renders — nothing the seat
      // couldn't already see.
      catanView: () => {
        const { view, seat } = useCatanStore.getState()
        return { view, seat }
      },
    }
    return () => {
      if (w.__meridianDebug) {
        delete w.__meridianDebug['catanRenderInfo']
        delete w.__meridianDebug['legalTargetsOnScreen']
        delete w.__meridianDebug['catanView']
      }
    }
  }, [gl, camera, size])

  return null
}

/**
 * `?tier=low` drops N8AO (the entire high/low fps gap per docs/PERF.md's
 * beauty-slice measurement) — same param + fallback as dev/slice/SliceScene.tsx.
 */
function qualityTier(): 'high' | 'low' {
  if (typeof window === 'undefined') return 'high'
  return new URLSearchParams(window.location.search).get('tier') === 'low' ? 'low' : 'high'
}

/**
 * `board.hexes`/`board.ports` never change mid-match — only `board.robber`
 * does (see robber.ts) — but the server pushes a brand-new `view` object on
 * every snapshot (catanStore.ingestSnapshot just assigns `payload.view`
 * wholesale), so `view.board` itself gets a fresh identity on every single
 * snapshot even when its content is unchanged. Everything downstream that
 * memoizes on `board`'s identity — CatanBoard's ScatterInstances (rewrites
 * every scatter InstancedMesh's matrices), Pieces' Ports (rebuilds the boat
 * list) and PortSigns (rebuilds the merged content mesh via SVGLoader/
 * TextGeometry/mergeGeometries — the most expensive of the three) — was
 * redoing that real work on every server push during a live match, not just
 * when the layout actually changed. Measured via a temporary console-log
 * probe on a 20s live solo-vs-3-bots match (see docs/PERF.md): 28 snapshots
 * landed, and every one re-ran all three.
 *
 * Fix: pin the initial (static) board once, and only mint a new `board`
 * identity when `robber` itself changes — the one field that's actually
 * live. This keeps `board.hexes`/`board.ports` reference-stable across
 * snapshots, so memoized consumers stop recomputing except on an actual
 * robber move (a handful of times per match, not once per snapshot).
 */
function useStableBoard(view: CatanClientState): CatanBoardData {
  const pinnedRef = useRef(view.board)
  return useMemo(
    () => ({ ...pinnedRef.current, robber: view.board.robber }),
    [view.board.robber],
  )
}

export function CatanScene({ view }: { view: CatanClientState }) {
  const board = useStableBoard(view)
  // view.buildings/view.roads are still live per-snapshot (see Pieces' own
  // consumers); only board's identity is pinned above.
  const stableView = useMemo(() => ({ ...view, board }), [view, board])
  const tier = useRef(qualityTier()).current
  // Size-aware presentation: the 37-hex board needs a higher rig, a longer
  // orbit leash, and a wider ocean. Canvas `camera` is initial-only, which is
  // fine — a room remount recreates the Canvas.
  const big = board.hexes.length > 19
  const cameraPos: [number, number, number] = big ? [0, 12.5, 11] : [0, 9, 8]
  const maxDist = big ? 19 : 14
  const waterSize = big ? 38 : 28
  // (shadow frustum is sized alongside: the radius-3 board spans ~±6 units, past the ±5.5 default)

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: cameraPos, fov: 42, near: 0.3, far: 100 }}
      gl={{ antialias: true, toneMappingExposure: 1.15 }}
    >
      <SkyBackdrop />
      <GoldenHourRig shadowExtent={big ? 8 : 5.5} />
      <CatanBoard board={board} />
      <Pieces view={stableView} />
      <PickLayer hexes={board.hexes} />
      <Highlights view={stableView} />
      <Water hexes={board.hexes} size={waterSize} />
      <OrbitControls
        target={[0, 0, 0]}
        enablePan={false}
        minDistance={6}
        maxDistance={maxDist}
        maxPolarAngle={Math.PI * 0.45}
      />
      <EffectComposer>
        {tier === 'high' ? <N8AO halfRes intensity={2.5} aoRadius={0.4} /> : <></>}
        <Bloom luminanceThreshold={1.1} intensity={0.35} mipmapBlur />
        <Vignette eskil={false} offset={0.25} darkness={0.55} />
      </EffectComposer>
      {import.meta.env.DEV && <CatanDebugHooks />}
    </Canvas>
  )
}
