import { useMemo } from 'react'
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

/**
 * The tokens GLB parks its 10 pucks in a grid — each `token_<n>` mesh must be
 * cloned by name and re-positioned; its node transform (grid slot) is not
 * meaningful placement data.
 */
function findTokenMesh(tokensRoot: THREE.Object3D, n: number): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  tokensRoot.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh && o.name === `token_${n}`) found = o as THREE.Mesh
  })
  return found
}

function Hex({ hex, hasRobber }: { hex: HexTile; hasRobber: boolean }) {
  const puck = useSliceGltf('tile_base')
  const dressing = useSliceGltf(TERRAIN_GLB[hex.terrain])
  const tokensRoot = useSliceGltf('tokens')
  const robber = useSliceGltf('robber')
  const pos = coordToWorld(hex.coord)
  const spot = TOKEN_SPOT[hex.terrain]

  const tokenMesh = useMemo(
    () => (hex.token != null ? findTokenMesh(tokensRoot, hex.token) : null),
    [tokensRoot, hex.token],
  )

  const robberY = (spot ? spot[1] : DESERT_ROBBER_Y) + ROBBER_LIFT

  return (
    <group position={pos}>
      <Clone object={puck} castShadow receiveShadow />
      <Clone object={dressing} castShadow receiveShadow />
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
