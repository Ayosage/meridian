import { useEffect, useMemo, useRef } from 'react'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { RESOURCE_COLORS } from './palette'
import type { PortPlacement } from './catanLayout'
import { TILE_TOP } from './catanLayout'

const FONT_URL = '/assets/fonts/helvetiker_bold.typeface.json'

// Cream/ink pairing extends the token-numeral precedent (ART-STANDARD.md):
// the plaque reads like the numeral disc, the rate text like the numeral
// itself — tinted by resource instead of by number rarity (the red 6/8).
const PLAQUE_CREAM = '#f2e6c9'
const INK = '#2a2318'

/** Height above the tile plane the sign floats at — clear of the boat's sail (peaks ~0.26 above TILE_TOP). */
const SIGN_LIFT = 0.55
const TEXT_SIZE = 0.22
const TEXT_DEPTH = 0.05
const PLAQUE_W = 0.62
const PLAQUE_D = 0.05
const PLAQUE_H = 0.4
/** Numerals must sit proud of their surface (ART-STANDARD ≥0.005) — a floating gap avoids any coincident-plane z-fight. */
const TEXT_GAP = 0.01
const TEXT_Y_OFFSET = PLAQUE_D / 2 + TEXT_DEPTH / 2 + TEXT_GAP

/** Signs float above the board and must not steal PickLayer's vertex/edge/hex raycasts. */
function noRaycast() {}

const SCRATCH_MATRIX = new THREE.Matrix4()
const SCRATCH_COLOR = new THREE.Color()

/**
 * One static InstancedMesh: same geometry and (base) material for every
 * instance, per-instance translation only — lying flat like the token
 * numerals (no per-port yaw), written once since the board is static after
 * mount. `colors`, when given, sets a per-instance tint over the base
 * (white) material; omitted, every instance renders the material's own color.
 */
function SignInstances({
  geometry,
  material,
  positions,
  colors,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  positions: readonly [number, number, number][]
  colors?: readonly string[]
}) {
  const ref = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const inst = ref.current
    if (!inst) return
    positions.forEach((p, i) => {
      SCRATCH_MATRIX.makeTranslation(...p)
      inst.setMatrixAt(i, SCRATCH_MATRIX)
      if (colors) inst.setColorAt(i, SCRATCH_COLOR.set(colors[i]!))
    })
    inst.instanceMatrix.needsUpdate = true
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true
    inst.computeBoundingSphere()
    inst.raycast = noRaycast
  }, [positions, colors])

  if (positions.length === 0) return null
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, positions.length]}
      matrixAutoUpdate={false}
    />
  )
}

/**
 * Rate signs for every port: a cream plaque floating above each boat with
 * the trade rate ("2:1"/"3:1") extruded on its face, tinted by resource for
 * resource ports and ink-neutral for generic ones. Text lies flat facing up
 * (rotateX bakes the extrude axis onto world +Y) so it reads under the
 * board's fixed oblique camera the same way the token-numeral discs do —
 * no per-port rotation, no billboarding, matching that established asset's
 * static-after-mount instancing (docs/PERF.md budget: 9 signs, ~3 draw calls).
 */
export function PortSigns({ placements }: { placements: readonly PortPlacement[] }) {
  const font = useLoader(FontLoader, FONT_URL)

  const plaqueGeometry = useMemo(() => new THREE.BoxGeometry(PLAQUE_W, PLAQUE_D, PLAQUE_H), [])
  const plaqueMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: PLAQUE_CREAM, roughness: 0.7 }),
    [],
  )
  const inkMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: INK, roughness: 0.6 }), [])
  const tintableMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }),
    [],
  )

  const rateGeometry = useMemo(() => {
    const build = (text: string) => {
      const geo = new TextGeometry(text, {
        font,
        size: TEXT_SIZE,
        depth: TEXT_DEPTH,
        curveSegments: 4,
        bevelEnabled: false,
      })
      // Text is authored in the XY plane, extruded along +Z; rotating -90°
      // about X maps that extrude axis onto world +Y (proud, facing up) and
      // the glyph's height axis onto world -Z, which reads top-up for the
      // board's camera (positioned on the +Z side, looking back toward -Z).
      geo.rotateX(-Math.PI / 2)
      geo.center()
      return geo
    }
    return { twoToOne: build('2:1'), threeToOne: build('3:1') }
  }, [font])

  const plaquePositions = useMemo(
    () => placements.map((p): [number, number, number] => [p.position[0], TILE_TOP + SIGN_LIFT, p.position[2]]),
    [placements],
  )
  const textY = TILE_TOP + SIGN_LIFT + TEXT_Y_OFFSET
  const resourcePorts = useMemo(() => placements.filter((p) => p.kind !== 'generic'), [placements])
  const genericPorts = useMemo(() => placements.filter((p) => p.kind === 'generic'), [placements])
  const resourcePositions = useMemo(
    () => resourcePorts.map((p): [number, number, number] => [p.position[0], textY, p.position[2]]),
    [resourcePorts, textY],
  )
  const resourceColors = useMemo(
    () => resourcePorts.map((p) => RESOURCE_COLORS[p.kind as Exclude<typeof p.kind, 'generic'>]),
    [resourcePorts],
  )
  const genericPositions = useMemo(
    () => genericPorts.map((p): [number, number, number] => [p.position[0], textY, p.position[2]]),
    [genericPorts, textY],
  )

  return (
    <>
      <SignInstances geometry={plaqueGeometry} material={plaqueMaterial} positions={plaquePositions} />
      <SignInstances
        geometry={rateGeometry.twoToOne}
        material={tintableMaterial}
        positions={resourcePositions}
        colors={resourceColors}
      />
      <SignInstances geometry={rateGeometry.threeToOne} material={inkMaterial} positions={genericPositions} />
    </>
  )
}
