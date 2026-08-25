import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Resource } from '@meridian/rules'
import { RESOURCE_ICON_PATHS, shadeResourceColor } from '../../ui/ResourceIcon'
import { RESOURCE_COLORS } from './palette'
import type { PortPlacement } from './catanLayout'
import { WATER_Y } from './catanLayout'

const FONT_URL = '/assets/fonts/helvetiker_bold.typeface.json'
/**
 * Blender-authored raft deck (assets/slice.blend's `piece_raft` collection,
 * exported by assets/export_slice.py — same pipeline as port.glb/
 * settlement.glb). Vertex-colored planks + support beams on the shared
 * "building" material (no textures), matching ART-STANDARD. The runtime
 * info layer (icon + rate) is NOT baked into this asset — one raft model,
 * instanced per port, with per-instance content merged on top separately.
 */
const RAFT_URL = '/assets/slice/raft.glb'

const INK = '#2a2318'

/**
 * Raft placement relative to the boat (`p.position`): pure outward push
 * alone doesn't reliably clear the boat (the raft's axis-aligned footprint
 * can still swing a corner back toward it at some ring headings — see
 * RaftInstances' doc comment for why it's unrotated), and pure sideways
 * offset alone isn't safe either — purely tangential movement isn't
 * guaranteed to stay over open water and can swing the raft back over the
 * *same* tile's own scatter dressing (trees, etc.), since only the radial
 * "outward from board center" direction is guaranteed clear of land.
 * Combining both — push further out (guarantees open water) *and* to the
 * side (clears the boat) — satisfies both.
 */
const RAFT_EXTRA_OUTWARD = 0.55
const RAFT_LATERAL_OFFSET = 0.45

// --- Raft deck placement. raft.glb's object origin sits at the deck's
// bottom (matching the tile/piece convention elsewhere in this pipeline —
// see CatanBoard.tsx's TOKEN_SPOT and assets/export_slice.py), with the
// top (plank) surface RAFT_DECK_HEIGHT above that (measured in Blender —
// see assets/slice.blend's piece_raft collection). A small margin above
// WATER_Y keeps the deck's own bottom from z-fighting the water plane.
const RAFT_Y_MARGIN = 0.015
const RAFT_DECK_HEIGHT = 0.055
const RAFT_ORIGIN_Y = WATER_Y + RAFT_Y_MARGIN
const RAFT_TOP_Y = RAFT_ORIGIN_Y + RAFT_DECK_HEIGHT

// --- Content: the resource icon + trade-rate text, embossed proud on the
// raft's top face, lying flat and reading straight up toward the camera —
// exactly like the number tokens (docs/PERF.md's "static after mount"
// idiom: no per-port rotation, no billboarding). Built once as a single
// merged, vertex-colored static mesh (cheaper than one InstancedMesh per
// resource kind — every port's content differs in icon shape and/or tint).
const CONTENT_GAP = 0.01
const CONTENT_DEPTH = 0.03
const CONTENT_Y = RAFT_TOP_Y + CONTENT_GAP + CONTENT_DEPTH / 2
const ICON_VIEWBOX = 24
/** World-unit height the 24x24 icon viewBox is scaled to. */
const ICON_SIZE = 0.2
const ICON_LOCAL_X = -0.21
/** "2:1" sits beside its icon; "3:1" (no icon) is centered on the deck. */
const RATE_TEXT_SIZE = 0.2
const RATE_TEXT_CURVE_SEGMENTS = 8
const RATE_TEXT_X_PAIRED = 0.13
const RATE_TEXT_X_ALONE = 0

/** Rafts float beside the board and must not steal PickLayer's vertex/edge/hex raycasts. */
function noRaycast() {}

const SCRATCH_MATRIX = new THREE.Matrix4()
const SCRATCH_COLOR = new THREE.Color()

/**
 * The boat sits at `p.position` (the port midpoint pushed outward by
 * Pieces.tsx's PORT_PUSH). The raft sits further out (RAFT_EXTRA_OUTWARD,
 * along the same guaranteed-open-water `out` direction) and to one side
 * (RAFT_LATERAL_OFFSET, along the perpendicular of `out` — (outZ, -outX),
 * a 90° rotation in the XZ plane, always the same rotational sense around
 * the ring so every raft ends up on a consistent side of its own boat).
 */
function raftWorldXZ(p: PortPlacement): [number, number] {
  return [
    p.position[0] + p.outX * RAFT_EXTRA_OUTWARD + p.outZ * RAFT_LATERAL_OFFSET,
    p.position[2] + p.outZ * RAFT_EXTRA_OUTWARD - p.outX * RAFT_LATERAL_OFFSET,
  ]
}

/** First mesh in `root` whose node name matches exactly (mirrors CatanBoard.tsx's findMeshByName). */
function findMeshByName(root: THREE.Object3D, name: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  root.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh && o.name === name) found = o as THREE.Mesh
  })
  return found
}

/**
 * One static InstancedMesh for every raft deck, geometry/material shared
 * (by reference) from the loaded GLB — no per-instance tint, so no clone
 * needed (mirrors CatanBoard.tsx's InstancedVariant). Translation only, no
 * per-port yaw: the deck's footprint is close enough to symmetric that a
 * fixed orientation reads fine from every angle, and — more importantly —
 * keeping it unrotated means raftWorldXZ's clearance math (above) doesn't
 * also have to account for the footprint swinging toward the boat at some
 * headings.
 */
function RaftInstances({
  geometry,
  material,
  positions,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  positions: readonly [number, number, number][]
}) {
  const ref = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const inst = ref.current
    if (!inst) return
    positions.forEach((p, i) => {
      SCRATCH_MATRIX.makeTranslation(...p)
      inst.setMatrixAt(i, SCRATCH_MATRIX)
    })
    inst.instanceMatrix.needsUpdate = true
    inst.computeBoundingSphere()
    inst.raycast = noRaycast
  }, [positions])

  if (positions.length === 0) return null
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, positions.length]}
      matrixAutoUpdate={false}
      castShadow
      receiveShadow
    />
  )
}

/**
 * Content faces straight up into a low-elevation sun (~20°, see rig.tsx):
 * a horizontal face gets a much more grazing, dimmer hit of direct light
 * than the vertical faces the rest of the rig's assets are tuned for, so
 * mid-brightness RESOURCE_COLORS values (ore's slate gray in particular)
 * read muddier here than their raw hex would suggest. A flat multiplier on
 * the baked vertex color compensates without touching the shared palette
 * or the rig's lighting (both used well beyond this one layer).
 */
const CONTENT_BRIGHTNESS = 1.3

/** Uniform-color clone of a base (uncolored) geometry — reused to bake a different tint per port onto the same rate-text shape. */
function colorize(base: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const geo = base.clone()
  const count = geo.attributes['position']!.count
  const c = SCRATCH_COLOR.set(hex).multiplyScalar(CONTENT_BRIGHTNESS)
  const arr = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

/**
 * Keeps a shadow-tone icon shape from z-fighting the main shape it
 * overlaps — see buildIconGeometry's doc comment. Expressed in the icon's
 * raw 24-unit viewBox space (like CONTENT_DEPTH's raw-space counterpart
 * below), since it's applied before the final uniform scale-down.
 */
const SHADOW_Z_NUDGE_RAW = 0.5

/**
 * Converts one resource's icon path data (RESOURCE_ICON_PATHS — the same
 * data ResourceIcon.tsx draws as a 2D <svg>, single source of truth) into
 * flat extruded geometry via SVGLoader, vertex-colored with the icon's own
 * two-tone main/shadow fill. SVG authors Y-down; scaling Y negative first
 * (screen-down -> font-up) then applying the same rotateX(-90°) treatment
 * TextGeometry gets below lays the icon flat, extrude-axis pointing world
 * +Y (up, proud) and glyph-up pointing world -Z — reading correctly under
 * the board's fixed oblique camera, same as the number tokens. The Y-flip
 * inverts winding, so the shared content material renders DoubleSide
 * rather than depending on getting handedness exactly right.
 *
 * The extrude depth is specified in the icon's own raw 24-unit viewBox
 * space, not world units directly: ExtrudeGeometry builds the shape's X/Y
 * *and* its Z (depth) in that same local space, and the later uniform
 * `scale(scale, -scale, scale)` divides all three by ~120x (ICON_VIEWBOX /
 * ICON_SIZE) to reach world size. Passing CONTENT_DEPTH (a world-unit
 * value) straight to `depth` would let that scale-down shrink the relief
 * to a ~0.00025-unit sliver — invisible, and too thin for SHADOW_Z_NUDGE
 * to survive the same scale-down either, silently reopening the z-fight
 * it exists to prevent. Dividing by `scale` first keeps both at their
 * intended world-unit size after the geometry is scaled down.
 */
function buildIconGeometry(resource: Resource, loader: SVGLoader): THREE.BufferGeometry {
  const glyph = RESOURCE_ICON_PATHS[resource]
  const main = RESOURCE_COLORS[resource]
  const shadow = shadeResourceColor(main, 0.62)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}">` +
    `<path d="${glyph.main}" fill="${main}"/>` +
    `<path d="${glyph.shadow}" fill="${shadow}"/>` +
    `</svg>`
  const { paths } = loader.parse(svg)
  const scale = ICON_SIZE / ICON_VIEWBOX
  const rawDepth = CONTENT_DEPTH / scale
  const parts: THREE.BufferGeometry[] = []
  // The shadow path's shapes (sheep's head/legs, wood's trunk, ...) are
  // drawn second in the SVG and so paint on top of the main shape wherever
  // they overlap in the flat 2D icon (e.g. the head circle sits inside the
  // cloud body's silhouette) — SVG's painter's algorithm resolves that for
  // free. Extruded flat, main and shadow would sit at the exact same
  // height and z-fight over that overlap instead, so the shadow shapes get
  // a hair of extra proud-ness (SHADOW_Z_NUDGE_RAW) to win the overlap
  // cleanly, matching the 2D paint order.
  paths.forEach((path, pathIndex) => {
    for (const shape of SVGLoader.createShapes(path)) {
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: rawDepth,
        bevelEnabled: false,
        curveSegments: 8,
      })
      if (pathIndex > 0) geo.translate(0, 0, SHADOW_Z_NUDGE_RAW)
      const count = geo.attributes['position']!.count
      const arr = new Float32Array(count * 3)
      const c = SCRATCH_COLOR.copy(path.color).multiplyScalar(CONTENT_BRIGHTNESS)
      for (let i = 0; i < count; i++) {
        arr[i * 3] = c.r
        arr[i * 3 + 1] = c.g
        arr[i * 3 + 2] = c.b
      }
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
      parts.push(geo)
    }
  })
  const merged = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  merged.scale(scale, -scale, scale)
  merged.rotateX(-Math.PI / 2)
  merged.center()
  return merged
}

/**
 * Bakes every port's content (icon + "2:1" for resource ports, "3:1" alone
 * for generic ones) directly into world space and merges it into one
 * static mesh — see the CONTENT block comment above for why this beats
 * per-resource instancing here. No per-port matrix: content lies flat and
 * unrotated (translation only), same as the raft deck itself.
 */
function buildContentGeometry(
  placements: readonly PortPlacement[],
  iconGeometry: Record<Resource, THREE.BufferGeometry>,
  rate2to1: THREE.BufferGeometry,
  rate3to1: THREE.BufferGeometry,
): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = []
  for (const p of placements) {
    const [x, z] = raftWorldXZ(p)

    if (p.kind === 'generic') {
      const text = colorize(rate3to1, INK)
      text.translate(x + RATE_TEXT_X_ALONE, CONTENT_Y, z)
      parts.push(text)
    } else {
      const icon = iconGeometry[p.kind].clone()
      icon.translate(x + ICON_LOCAL_X, CONTENT_Y, z)

      const text = colorize(rate2to1, RESOURCE_COLORS[p.kind])
      text.translate(x + RATE_TEXT_X_PAIRED, CONTENT_Y, z)

      parts.push(icon, text)
    }
  }
  if (parts.length === 0) return null
  const merged = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  return merged
}

/**
 * Port rafts: a flat, vertex-colored plank platform (raft.glb, Blender-
 * authored via the same pipeline as port.glb/settlement.glb) floating just
 * above the water beside each boat, carrying the resource icon (SVGLoader-
 * converted from ResourceIcon.tsx's path data) and trade rate for resource
 * ports, or just the rate for generic ones — both lying flat on the deck,
 * reading upward like the number tokens. Draw calls: 1 raft InstancedMesh
 * (shadow-casting, so 2 passes: main + the sun's shadow map) + 1 merged
 * content mesh (icons + all rate text, no shadow) = 3 total.
 */
export function PortSigns({ placements }: { placements: readonly PortPlacement[] }) {
  const font = useLoader(FontLoader, FONT_URL)
  const svgLoader = useMemo(() => new SVGLoader(), [])
  const raftScene = useGLTF(RAFT_URL).scene
  const raftMesh = useMemo(() => findMeshByName(raftScene, 'raft_deck'), [raftScene])

  const contentMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        // Matte on purpose: a shinier surface throws a sharp specular
        // streak across thin numeral strokes under the rig's raking sun,
        // fragmenting the digit's silhouette into confusing bright/dark
        // patches at this scale.
        roughness: 0.9,
        side: THREE.DoubleSide,
      }),
    [],
  )

  const iconGeometry = useMemo(() => {
    const resources: Resource[] = ['wood', 'brick', 'sheep', 'wheat', 'ore']
    const entries = resources.map((r): [Resource, THREE.BufferGeometry] => [r, buildIconGeometry(r, svgLoader)])
    return Object.fromEntries(entries) as Record<Resource, THREE.BufferGeometry>
  }, [svgLoader])

  const rateGeometry = useMemo(() => {
    const build = (text: string) => {
      const geo = new TextGeometry(text, {
        font,
        size: RATE_TEXT_SIZE,
        depth: CONTENT_DEPTH,
        curveSegments: RATE_TEXT_CURVE_SEGMENTS,
        bevelEnabled: false,
      })
      // Text is authored in the XY plane, extruded along +Z; rotating -90°
      // about X maps that extrude axis onto world +Y (proud, facing up)
      // and the glyph's height axis onto world -Z, which reads top-up for
      // the board's fixed oblique camera — same treatment as the icons.
      geo.rotateX(-Math.PI / 2)
      geo.center()
      return geo
    }
    return { twoToOne: build('2:1'), threeToOne: build('3:1') }
  }, [font])

  const raftPositions = useMemo(
    () =>
      placements.map((p): [number, number, number] => {
        const [x, z] = raftWorldXZ(p)
        return [x, RAFT_ORIGIN_Y, z]
      }),
    [placements],
  )

  const contentGeometry = useMemo(
    () => buildContentGeometry(placements, iconGeometry, rateGeometry.twoToOne, rateGeometry.threeToOne),
    [placements, iconGeometry, rateGeometry],
  )

  const raftMaterial = raftMesh && (Array.isArray(raftMesh.material) ? raftMesh.material[0]! : raftMesh.material)

  return (
    <>
      {raftMesh && raftMaterial && (
        <RaftInstances geometry={raftMesh.geometry} material={raftMaterial} positions={raftPositions} />
      )}
      {contentGeometry && (
        <mesh
          geometry={contentGeometry}
          material={contentMaterial}
          matrixAutoUpdate={false}
          raycast={noRaycast}
        />
      )}
    </>
  )
}

useGLTF.preload(RAFT_URL)
