import { memo, useEffect } from 'react'
import * as THREE from 'three'
import { coordKey, type CatanBoard } from '@meridian/rules'
import { coordToWorld } from '../layout'
import { edgeWorld, TILE_TOP, vertexWorld } from './catanLayout'
import { useCatanStore } from './catanStore'
import { sendCatanIntent } from '../../net/catan'

const VERTEX_RADIUS = 0.16
const EDGE_SIZE: [number, number, number] = [0.55, 0.1, 0.14]
/** Circle radius for a per-tile pick plane; smaller than the sqrt(3) tile spacing so neighbors don't overlap. */
const HEX_PICK_RADIUS = 0.85

// Shared across every pick mesh — the layer is ~260 meshes on a radius-3
// board, and one geometry per shape (not one per mesh) is all raycasting needs.
const VERTEX_GEOMETRY = new THREE.SphereGeometry(VERTEX_RADIUS, 12, 12)
const EDGE_GEOMETRY = new THREE.BoxGeometry(...EDGE_SIZE)
const HEX_GEOMETRY = new THREE.CircleGeometry(HEX_PICK_RADIUS, 6)
/**
 * Fully transparent but still raycastable: `visible={false}` would make R3F
 * skip the mesh during raycasting entirely, so invisibility comes from
 * opacity instead (see task brief).
 */
const INVISIBLE_MATERIAL = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })

/**
 * Invisible pick geometry for every vertex, edge, and hex on the board, plus
 * the Esc-to-cancel key handler. Dispatch logic itself lives in the store
 * (clickVertex/clickEdge/clickHex) — this component only wires raycast
 * events to it, passing the real `sendCatanIntent` as the send function.
 *
 * Takes `hexes` (not the live view) and is memoized: the layout is fixed for
 * a match, so the pick meshes mount once instead of re-rendering ~260
 * elements on every server snapshot.
 */
export const PickLayer = memo(function PickLayer({ hexes }: { hexes: CatanBoard['hexes'] }) {
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

  const vw = vertexWorld(hexes)
  const ew = edgeWorld(hexes)

  return (
    <group>
      {[...vw.entries()].map(([id, pos]) => (
        <mesh
          key={id}
          geometry={VERTEX_GEOMETRY}
          material={INVISIBLE_MATERIAL}
          position={pos}
          onClick={(e) => {
            e.stopPropagation()
            clickVertex(id, sendCatanIntent)
          }}
        />
      ))}
      {[...ew.entries()].map(([id, { pos, angle }]) => (
        <mesh
          key={id}
          geometry={EDGE_GEOMETRY}
          material={INVISIBLE_MATERIAL}
          position={pos}
          rotation={[0, angle, 0]}
          onClick={(e) => {
            e.stopPropagation()
            clickEdge(id, sendCatanIntent)
          }}
        />
      ))}
      {hexes.map((hex) => {
        const [x, , z] = coordToWorld(hex.coord)
        return (
          <mesh
            key={coordKey(hex.coord)}
            geometry={HEX_GEOMETRY}
            material={INVISIBLE_MATERIAL}
            position={[x, TILE_TOP, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            onClick={(e) => {
              e.stopPropagation()
              clickHex(hex.coord, sendCatanIntent)
            }}
          />
        )
      })}
    </group>
  )
})
