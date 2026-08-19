import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { CatanBoard, CatanClientState, EdgeId, VertexId } from '@meridian/rules'
import { edgeWorld, TILE_TOP, vertexWorld } from './catanLayout'
import { palette, RESOURCE_COLORS } from './palette'

const ASSETS = '/assets/slice'
/** How far a port is pushed out from its two-vertex midpoint, away from the board center. */
const PORT_PUSH = 0.35

const SEAT_COLORS: readonly string[] = [
  palette.players.red,
  palette.players.blue,
  palette.players.white,
  palette.players.orange,
]

function seatColor(owner: number): string {
  return SEAT_COLORS[owner] ?? '#999999'
}

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
  return (
    <>
      {board.ports.map((port, i) => {
        const a = vw.get(port.vertices[0])
        const b = vw.get(port.vertices[1])
        if (!a || !b) return null
        const midX = (a[0] + b[0]) / 2
        const midZ = (a[2] + b[2]) / 2
        const len = Math.hypot(midX, midZ) || 1
        // unit vector from board center (origin) outward through the midpoint
        const outX = midX / len
        const outZ = midZ / len
        const position: [number, number, number] = [midX + outX * PORT_PUSH, TILE_TOP, midZ + outZ * PORT_PUSH]
        // face the board center: rotate so the model's local -Z axis (its
        // export-convention "front") points back toward the origin
        const rotation: [number, number, number] = [0, Math.atan2(outX, outZ), 0]
        const color = port.kind === 'generic' ? null : RESOURCE_COLORS[port.kind]
        return (
          <TintedPiece
            key={`${port.vertices[0]}-${port.vertices[1]}-${i}`}
            source={portSrc}
            color={color}
            matchName="sail"
            position={position}
            rotation={rotation}
          />
        )
      })}
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
