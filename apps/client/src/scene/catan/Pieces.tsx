import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { CatanBoard, CatanClientState, EdgeId, VertexId } from '@meridian/rules'
import { edgeWorld, portWorld, vertexWorld } from './catanLayout'
import { RESOURCE_COLORS, seatColor } from './palette'
import { PortSigns } from './PortSign'

const ASSETS = '/assets/slice'
/** How far a port is pushed out from its two-vertex midpoint, away from the board center. */
const PORT_PUSH = 0.35

function useSliceGltf(name: string): THREE.Group {
  const { scene } = useGLTF(`${ASSETS}/${name}.glb`)
  return scene
}

/**
 * Deep-clones a loaded GLB subtree and tints the owner-color mesh.
 * `matchName` selects an exact mesh name (e.g. port's `sail`, which carries
 * no `_tint` suffix); omitted, it falls back to the `_tint` node-name
 * convention (settlement/city/road). Materials are shared between GLB
 * clones by default — always clone before mutating (tint contract, Task 8).
 */
function cloneTinted(source: THREE.Object3D, color: string | null, matchName?: string): THREE.Object3D {
  const clone = source.clone(true)
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    const isTintTarget = matchName ? mesh.name === matchName : mesh.name.endsWith('_tint')
    if (isTintTarget && color) {
      const material = (mesh.material as THREE.MeshStandardMaterial).clone()
      material.color.set(color)
      mesh.material = material
    }
  })
  return clone
}

function TintedPiece({
  source,
  color,
  matchName,
  position,
  rotation,
  scale,
}: {
  source: THREE.Object3D
  color: string | null
  matchName?: string
  position: readonly [number, number, number]
  rotation?: readonly [number, number, number]
  scale?: number | readonly [number, number, number]
}) {
  const clone = useMemo(() => cloneTinted(source, color, matchName), [source, color, matchName])
  return <primitive object={clone} position={position} rotation={rotation} scale={scale} />
}

function Buildings({ buildings }: { buildings: CatanClientState['buildings'] }) {
  const settlementSrc = useSliceGltf('settlement')
  const citySrc = useSliceGltf('city')
  const vw = vertexWorld()
  return (
    <>
      {Object.entries(buildings).map(([id, building]) => {
        const pos = vw.get(id as VertexId)
        if (!pos) return null
        const source = building.kind === 'city' ? citySrc : settlementSrc
        return (
          <TintedPiece
            key={id}
            source={source}
            color={seatColor(building.owner)}
            position={pos}
            rotation={[0, 0.5, 0]}
            scale={1.45}
          />
        )
      })}
    </>
  )
}

function Roads({ roads }: { roads: CatanClientState['roads'] }) {
  const roadSrc = useSliceGltf('road')
  const ew = edgeWorld()
  return (
    <>
      {Object.entries(roads).map(([id, owner]) => {
        const edge = ew.get(id as EdgeId)
        if (!edge) return null
        return (
          <TintedPiece
            key={id}
            source={roadSrc}
            color={seatColor(owner)}
            position={edge.pos}
            rotation={[0, edge.angle, 0]}
            scale={[1, 1.45, 1.45]}
          />
        )
      })}
    </>
  )
}

function Ports({ board }: { board: CatanBoard }) {
  const portSrc = useSliceGltf('port')
  const vw = vertexWorld()
  const placements = useMemo(() => portWorld(board, vw, PORT_PUSH), [board, vw])
  return (
    <>
      {placements.map((p) => {
        // face the board center: rotate so the model's local -Z axis (its
        // export-convention "front") points back toward the origin
        const rotation: [number, number, number] = [0, Math.atan2(p.outX, p.outZ), 0]
        const color = p.kind === 'generic' ? null : RESOURCE_COLORS[p.kind]
        return (
          <TintedPiece
            key={p.key}
            source={portSrc}
            color={color}
            matchName="sail"
            position={p.position}
            rotation={rotation}
          />
        )
      })}
      <PortSigns placements={placements} />
    </>
  )
}

export function Pieces({ view }: { view: CatanClientState }) {
  return (
    <>
      <Buildings buildings={view.buildings} />
      <Roads roads={view.roads} />
      <Ports board={view.board} />
    </>
  )
}

useGLTF.preload(`${ASSETS}/settlement.glb`)
useGLTF.preload(`${ASSETS}/city.glb`)
useGLTF.preload(`${ASSETS}/road.glb`)
useGLTF.preload(`${ASSETS}/port.glb`)
