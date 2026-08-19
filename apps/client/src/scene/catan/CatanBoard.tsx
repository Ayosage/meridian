import { useEffect, useMemo, useRef } from 'react'
import { Clone, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { coordKey, type CatanBoard as CatanBoardData, type HexTile, type Terrain } from '@meridian/rules'
import { coordToWorld } from '../layout'

const ASSETS = '/assets/slice'

/** hex.terrain -> its GLB dressing asset. */
const TERRAIN_GLB: Readonly<Record<Terrain, string>> = {
  forest: 'terrain_forest',
  fields: 'terrain_fields',
  mountains: 'terrain_mountains',
  pasture: 'terrain_pasture',
  hills: 'terrain_hills',
  desert: 'terrain_desert',
}

/**
 * Local [x, y, z] offset (on the puck, relative to its center) of the clear
 * spot each terrain leaves for a number token. Desert never carries a token.
 */
export const TOKEN_SPOT: Readonly<Partial<Record<Terrain, readonly [number, number, number]>>> = {
  mountains: [-0.45, 0.242, 0.35],
  forest: [0.6, 0.245, -0.1],
  fields: [-0.38, 0.292, -0.3],
  pasture: [-0.35, 0.268, 0.25],
  hills: [0.15, 0.3, 0.55],
}

/** Robber Y when it sits on the desert (no TOKEN_SPOT entry to derive a height from). */
const DESERT_ROBBER_Y = 0.24
const ROBBER_LIFT = 0.02

function useSliceGltf(name: string): THREE.Group {
  const { scene } = useGLTF(`${ASSETS}/${name}.glb`)
  return scene
}

/** First mesh in `root` whose node name matches exactly. */
function findMeshByName(root: THREE.Object3D, name: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  root.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh && o.name === name) found = o as THREE.Mesh
  })
  return found
}

interface VariantGroup {
  /** Template mesh — its geometry + material are reused (shared, not cloned) by every instance. */
  mesh: THREE.Mesh
  /** One local-to-tile matrix per repeated node in a single GLB template (e.g. per pine in one forest tile). */
  matrices: THREE.Matrix4[]
}

/**
 * Groups a GLB's repeated child nodes (matched by name) by their shared
 * source geometry — e.g. forest's 14 `pine_i*` nodes collapse to 3 groups
 * (pine_a/b/c), pasture's 80 `gclump*` nodes collapse to 1. Reads
 * `matrixWorld` relative to `root` (the GLTF scene, which itself sits at
 * identity — never inserted into the render tree), i.e. each node's
 * placement *within one tile*, before that tile's own world offset.
 */
function collectVariants(root: THREE.Object3D, match: (name: string) => boolean): VariantGroup[] {
  root.updateMatrixWorld(true)
  const byGeometry = new Map<THREE.BufferGeometry, VariantGroup>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !match(mesh.name)) return
    let group = byGeometry.get(mesh.geometry)
    if (!group) {
      group = { mesh, matrices: [] }
      byGeometry.set(mesh.geometry, group)
    }
    group.matrices.push(mesh.matrixWorld.clone())
  })
  return [...byGeometry.values()]
}

const SCRATCH_TRANSLATE = new THREE.Matrix4()
const SCRATCH_MATRIX = new THREE.Matrix4()

/**
 * One InstancedMesh for every occurrence of a scatter variant across every
 * tile of the matching terrain, built once (the board is static once
 * mounted — no per-frame matrix writes). Geometry/material are shared
 * references from the source GLB (no per-instance tint, so no clone needed).
 */
function InstancedVariant({
  mesh,
  localMatrices,
  tilePositions,
}: {
  mesh: THREE.Mesh
  localMatrices: THREE.Matrix4[]
  tilePositions: readonly [number, number, number][]
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const count = localMatrices.length * tilePositions.length

  useEffect(() => {
    const inst = ref.current
    if (!inst || count === 0) return
    let i = 0
    for (const [tx, ty, tz] of tilePositions) {
      SCRATCH_TRANSLATE.makeTranslation(tx, ty, tz)
      for (const local of localMatrices) {
        SCRATCH_MATRIX.multiplyMatrices(SCRATCH_TRANSLATE, local)
        inst.setMatrixAt(i++, SCRATCH_MATRIX)
      }
    }
    inst.instanceMatrix.needsUpdate = true
    inst.computeBoundingSphere()
  }, [localMatrices, tilePositions, count])

  if (count === 0) return null
  return (
    <instancedMesh
      ref={ref}
      args={[mesh.geometry, mesh.material, count]}
      matrixAutoUpdate={false}
      castShadow
      receiveShadow
    />
  )
}

/**
 * Batches the board's two scatter/pattern terrains (forest pines, pasture
 * grass clumps + sheep) into per-variant InstancedMeshes spanning every tile
 * of that terrain, instead of one draw call per repeated node per tile.
 * Perf: draw calls for these terrains alone dropped from 396 (60 forest +
 * 336 pasture, at 19-tile board sizing) to ~10 — see docs/PERF.md.
 */
function ScatterInstances({ board }: { board: CatanBoardData }) {
  const forestSrc = useSliceGltf(TERRAIN_GLB.forest)
  const pastureSrc = useSliceGltf(TERRAIN_GLB.pasture)

  const forestPositions = useMemo(
    () => board.hexes.filter((h) => h.terrain === 'forest').map((h) => coordToWorld(h.coord)),
    [board.hexes],
  )
  const pasturePositions = useMemo(
    () => board.hexes.filter((h) => h.terrain === 'pasture').map((h) => coordToWorld(h.coord)),
    [board.hexes],
  )

  const pineVariants = useMemo(
    () => collectVariants(forestSrc, (n) => n.startsWith('pine_i')),
    [forestSrc],
  )
  const clumpVariants = useMemo(
    () => collectVariants(pastureSrc, (n) => n.startsWith('gclump')),
    [pastureSrc],
  )
  const sheepVariants = useMemo(
    () => collectVariants(pastureSrc, (n) => n.startsWith('sheep_')),
    [pastureSrc],
  )

  return (
    <>
      {pineVariants.map((v, i) => (
        <InstancedVariant key={`pine-${i}`} mesh={v.mesh} localMatrices={v.matrices} tilePositions={forestPositions} />
      ))}
      {clumpVariants.map((v, i) => (
        <InstancedVariant key={`clump-${i}`} mesh={v.mesh} localMatrices={v.matrices} tilePositions={pasturePositions} />
      ))}
      {sheepVariants.map((v, i) => (
        <InstancedVariant key={`sheep-${i}`} mesh={v.mesh} localMatrices={v.matrices} tilePositions={pasturePositions} />
      ))}
    </>
  )
}

/**
 * Ground-only dressing for the two instanced terrains (their scatter meshes
 * are rendered by `ScatterInstances`, not per-tile — cloning the full
 * dressing here would double them). Every other terrain keeps its full
 * clone (no repeated nodes worth instancing — see docs/PERF.md).
 */
const GROUND_ONLY_NODE: Partial<Record<Terrain, string>> = {
  forest: 'forest_ground',
  pasture: 'pasture_ground',
}

function Hex({ hex, hasRobber }: { hex: HexTile; hasRobber: boolean }) {
  const puck = useSliceGltf('tile_base')
  const dressing = useSliceGltf(TERRAIN_GLB[hex.terrain])
  const tokensRoot = useSliceGltf('tokens')
  const robber = useSliceGltf('robber')
  const pos = coordToWorld(hex.coord)
  const spot = TOKEN_SPOT[hex.terrain]

  const tokenMesh = useMemo(
    () => (hex.token != null ? findMeshByName(tokensRoot, `token_${hex.token}`) : null),
    [tokensRoot, hex.token],
  )
  const groundNodeName = GROUND_ONLY_NODE[hex.terrain]
  const groundMesh = useMemo(
    () => (groundNodeName ? findMeshByName(dressing, groundNodeName) : null),
    [dressing, groundNodeName],
  )

  const robberY = (spot ? spot[1] : DESERT_ROBBER_Y) + ROBBER_LIFT

  return (
    <group position={pos}>
      <Clone object={puck} castShadow receiveShadow />
      {groundNodeName ? (
        groundMesh && <Clone object={groundMesh} castShadow receiveShadow />
      ) : (
        <Clone object={dressing} castShadow receiveShadow />
      )}
      {tokenMesh && spot && <Clone object={tokenMesh} position={spot} castShadow receiveShadow />}
      {hasRobber && <Clone object={robber} position={[0, robberY, 0]} castShadow receiveShadow />}
    </group>
  )
}

export function CatanBoard({ board }: { board: CatanBoardData }) {
  return (
    <>
      {board.hexes.map((hex) => (
        <Hex key={coordKey(hex.coord)} hex={hex} hasRobber={board.robber === coordKey(hex.coord)} />
      ))}
      <ScatterInstances board={board} />
    </>
  )
}

useGLTF.preload(`${ASSETS}/tile_base.glb`)
useGLTF.preload(`${ASSETS}/terrain_forest.glb`)
useGLTF.preload(`${ASSETS}/terrain_fields.glb`)
useGLTF.preload(`${ASSETS}/terrain_mountains.glb`)
useGLTF.preload(`${ASSETS}/terrain_pasture.glb`)
useGLTF.preload(`${ASSETS}/terrain_hills.glb`)
useGLTF.preload(`${ASSETS}/terrain_desert.glb`)
useGLTF.preload(`${ASSETS}/tokens.glb`)
useGLTF.preload(`${ASSETS}/robber.glb`)
