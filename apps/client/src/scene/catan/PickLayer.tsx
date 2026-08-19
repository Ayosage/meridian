import { useEffect } from 'react'
import { coordKey, type CatanClientState } from '@meridian/rules'
import { coordToWorld } from '../layout'
import { edgeWorld, TILE_TOP, vertexWorld } from './catanLayout'
import { useCatanStore } from './catanStore'
import { sendCatanIntent } from '../../net/catan'

const VERTEX_RADIUS = 0.16
const EDGE_SIZE: [number, number, number] = [0.55, 0.1, 0.14]
/** Circle radius for a per-tile pick plane; smaller than the sqrt(3) tile spacing so neighbors don't overlap. */
const HEX_PICK_RADIUS = 0.85

/**
 * Fully transparent but still raycastable: `visible={false}` would make R3F
 * skip the mesh during raycasting entirely, so invisibility comes from
 * opacity instead (see task brief).
 */
function InvisibleMaterial() {
  return <meshBasicMaterial transparent opacity={0} depthWrite={false} />
}

/**
 * Invisible pick geometry for every vertex, edge, and hex on the board, plus
 * the Esc-to-cancel key handler. Dispatch logic itself lives in the store
 * (clickVertex/clickEdge/clickHex) — this component only wires raycast
 * events to it, passing the real `sendCatanIntent` as the send function.
 */
export function PickLayer({ view }: { view: CatanClientState }) {
  const clickVertex = useCatanStore((s) => s.clickVertex)
  const clickEdge = useCatanStore((s) => s.clickEdge)
  const clickHex = useCatanStore((s) => s.clickHex)
  const cancelMode = useCatanStore((s) => s.cancelMode)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') cancelMode()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelMode])

  const vw = vertexWorld()
  const ew = edgeWorld()

  return (
    <group>
      {[...vw.entries()].map(([id, pos]) => (
        <mesh
          key={id}
          position={pos}
          onClick={(e) => {
            e.stopPropagation()
            clickVertex(id, sendCatanIntent)
          }}
        >
          <sphereGeometry args={[VERTEX_RADIUS, 12, 12]} />
          <InvisibleMaterial />
        </mesh>
      ))}
      {[...ew.entries()].map(([id, { pos, angle }]) => (
        <mesh
          key={id}
          position={pos}
          rotation={[0, angle, 0]}
          onClick={(e) => {
            e.stopPropagation()
            clickEdge(id, sendCatanIntent)
          }}
        >
          <boxGeometry args={EDGE_SIZE} />
          <InvisibleMaterial />
        </mesh>
      ))}
      {view.board.hexes.map((hex) => {
        const [x, , z] = coordToWorld(hex.coord)
        return (
          <mesh
            key={coordKey(hex.coord)}
            position={[x, TILE_TOP, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            onClick={(e) => {
              e.stopPropagation()
              clickHex(hex.coord, sendCatanIntent)
            }}
          >
            <circleGeometry args={[HEX_PICK_RADIUS, 6]} />
            <InvisibleMaterial />
          </mesh>
        )
      })}
    </group>
  )
}
