import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { coordToWorld } from '../scene/layout'

const SCRATCH = new THREE.Vector3()

interface MeridianDebug {
  worldToScreen(coordKey: string, y?: number): { x: number; y: number }
  renderInfo(): { drawCalls: number; triangles: number }
  /** CatanScene-only (scene/catan/CatanScene.tsx's CatanDebugHooks) — perf probe for the Catan board. */
  catanRenderInfo?(): { calls: number; triangles: number }
  /**
   * CatanScene-only — screen-space projection of every legal vertex/edge for
   * the current mode (robber mode: every non-robbed hex), so an E2E driver
   * can click the real canvas raycasting path without reimplementing
   * legality. See CatanDebugHooks's doc comment for the full rationale.
   */
  legalTargetsOnScreen?(): {
    mode: string
    targets: { kind: 'vertex' | 'edge' | 'hex'; id: string; x: number; y: number }[]
  }
  /**
   * CatanScene-only — this seat's redacted snapshot + seat number, so
   * external drivers (the E2E specs) can weigh targets (pips, robber
   * victims, trades) without reimplementing the client's networking. Only
   * what the seat may see (CatanClientState) — secrets never reach the hook.
   */
  catanView?(): { view: unknown; seat: number | null }
}

declare global {
  interface Window {
    __meridianDebug?: MeridianDebug
  }
}

/** Mounted inside the Canvas, dev builds only. Gives the E2E real screen
 *  coordinates so its clicks travel the genuine raycasting path. */
export function DebugHooks() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)

  useEffect(() => {
    window.__meridianDebug = {
      worldToScreen(key: string, y = 0) {
        const [qs, rs] = key.split(',')
        const [x, , z] = coordToWorld({ q: Number(qs), r: Number(rs) })
        SCRATCH.set(x, y, z).project(camera)
        return {
          x: ((SCRATCH.x + 1) / 2) * size.width,
          y: ((1 - SCRATCH.y) / 2) * size.height,
        }
      },
      renderInfo() {
        return { drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles }
      },
    }
    return () => {
      delete window.__meridianDebug
    }
  }, [camera, gl, size])

  return null
}
