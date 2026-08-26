import { useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { CatanBoard, CatanClientState, EdgeId, VertexId } from '@meridian/rules'
import { edgeWorld, portsEqual, portWorld, vertexWorld, TILE_TOP } from './catanLayout'
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

/**
 * Small deterministic hash -> a stable per-key angle jitter in
 * [-maxRadians, maxRadians]. Not Math.random(): a boat's heading must stay
 * fixed across re-renders (same key -> same jitter every time), not
 * re-roll whenever the component re-mounts.
 */
function seededAngleJitter(key: string, maxRadians: number): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  const unit = (Math.abs(h) % 1000) / 1000
  return (unit * 2 - 1) * maxRadians
}

/**
 * Two boats per port — one docked off each of the port's two vertices,
 * not one at the shared midpoint — so which two spaces the port actually
 * serves reads at a glance (user request). Each keeps the port's own
 * outward push/direction (so both still read as "this port's boats," docked
 * beside it rather than scattered), with a small per-boat heading jitter
 * (seeded off its vertex id, not random per render) so a pair doesn't look
 * like a stamped formation.
 */
function Ports({ board }: { board: CatanBoard }) {
  const portSrc = useSliceGltf('port')
  const vw = vertexWorld()
  // Every snapshot re-mints `board` (each robber move included) while its
  // ports never change mid-match, and vw is module-cached — so key the memos
  // on a content-stable ports reference, not on board identity, or the boats
  // and sign placements rebuild on every robber move for nothing.
  const portsRef = useRef(board.ports)
  if (!portsEqual(portsRef.current, board.ports)) portsRef.current = board.ports
  const ports = portsRef.current
  const placements = useMemo(() => portWorld({ ports }, vw, PORT_PUSH), [ports, vw])

  const boats = useMemo(() => {
    const list: {
      key: string
      position: [number, number, number]
      rotation: [number, number, number]
      color: string | null
    }[] = []
    ports.forEach((port, i) => {
      const p = placements[i]
      if (!p) return
      const baseAngle = Math.atan2(p.outX, p.outZ)
      const color = port.kind === 'generic' ? null : RESOURCE_COLORS[port.kind]
      for (const vId of port.vertices) {
        const vPos = vw.get(vId)
        if (!vPos) continue
        list.push({
          key: `${p.key}-${vId}`,
          position: [vPos[0] + p.outX * PORT_PUSH, TILE_TOP, vPos[2] + p.outZ * PORT_PUSH],
          // face the board center (the port's shared outward direction),
          // same "local -Z is front" convention as before, jittered per boat
          rotation: [0, baseAngle + seededAngleJitter(vId, 0.35), 0],
          color,
        })
      }
    })
    return list
  }, [ports, placements, vw])

  return (
    <>
      {boats.map((b) => (
        <TintedPiece
          key={b.key}
          source={portSrc}
          color={b.color}
          matchName="sail"
          position={b.position}
          rotation={b.rotation}
        />
      ))}
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
