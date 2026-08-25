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
/** Generic "3:1" text sits on the same ink-colored backing plate every port gets — needs a light color of its own or it vanishes into its own backing. */
const GENERIC_RATE_COLOR = '#f2e6c9'

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
const RAFT_EXTRA_OUTWARD = 1.05
const RAFT_LATERAL_OFFSET = 0.45

// --- Raft deck placement. raft.glb's object origin sits at the deck's
// bottom (matching the tile/piece convention elsewhere in this pipeline —
// see CatanBoard.tsx's TOKEN_SPOT and assets/export_slice.py), with the
// top (plank) surface RAFT_DECK_HEIGHT above that (measured in Blender —
// see assets/slice.blend's piece_raft collection). A small margin above
// WATER_Y keeps the deck's own bottom from z-fighting the water plane.
const RAFT_Y_MARGIN = 0.015
const RAFT_DECK_HEIGHT = 0.07
/**
 * Uniform grow-factor for the whole raft presentation (deck instances +
 * content sizes below). The craftsmanship pass added 10x geometry that is
 * invisible at ~40px on screen — at gameplay zoom only size, silhouette,
 * and contrast register, so the raft reads bigger rather than finer.
 */
const RAFT_SCALE = 1.3
const RAFT_ORIGIN_Y = WATER_Y + RAFT_Y_MARGIN
const RAFT_TOP_Y = RAFT_ORIGIN_Y + RAFT_DECK_HEIGHT * RAFT_SCALE

// --- Content: the resource icon + trade-rate text, embossed proud on the
// raft's top face, lying flat and reading straight up toward the camera —
// exactly like the number tokens (docs/PERF.md's "static after mount"
// idiom). Built once as a single merged, vertex-colored static mesh
// (cheaper than one InstancedMesh per resource kind — every port's
// content differs in icon shape and/or tint). The content's own *reading
// orientation* stays fixed world-up regardless of the raft's yaw (a
// Y-rotation on a Y-up-facing surface never changes which way it's
// readable from above — matches the un-rotated, always-correct tokens);
// only its *position* follows the raft's yaw, via facingAngle, so it
// stays centered on the deck once the deck itself starts turning to fix
// the sliver problem below.
const CONTENT_GAP = 0.01
const CONTENT_DEPTH = 0.03
const ICON_VIEWBOX = 24
/** World-unit height the 24x24 icon viewBox is scaled to. */
const ICON_SIZE = 0.26
const ICON_LOCAL_X = -0.27
/** "2:1" sits beside its icon; "3:1" (no icon) is centered on the deck. */
const RATE_TEXT_SIZE = 0.26
const RATE_TEXT_CURVE_SEGMENTS = 8
const RATE_TEXT_X_PAIRED = 0.17
const RATE_TEXT_X_ALONE = 0

// --- Ink backing: a thin dark wafer under the icon+rate (token-style ink
// treatment), sized to cover both in either layout. Folded into the same
// merged content mesh as everything else below — more geometry, not
// another draw call. Exists because RESOURCE_COLORS values close in hue
// to the deck's own wood tones (wheat's tan especially) read low-contrast
// directly on bare planks; a dark backing gives every resource color the
// same contrast floor instead of special-casing wheat's hex value alone.
const INK_BACKING_W = 0.74
const INK_BACKING_D = 0.33
const INK_BACKING_HEIGHT = 0.012
const INK_BACKING_Y = RAFT_TOP_Y + CONTENT_GAP + INK_BACKING_HEIGHT / 2
const CONTENT_Y = INK_BACKING_Y + INK_BACKING_HEIGHT / 2 + CONTENT_GAP + CONTENT_DEPTH / 2

/** Rafts float beside the board and must not steal PickLayer's vertex/edge/hex raycasts. */
function noRaycast() {}

const SCRATCH_MATRIX = new THREE.Matrix4()
const RAFT_SCALE_V3 = new THREE.Vector3(RAFT_SCALE, RAFT_SCALE, RAFT_SCALE)
const SCRATCH_COLOR = new THREE.Color()

/**
 * The boat sits at `p.position` (the port midpoint pushed outward by
 * Pieces.tsx's PORT_PUSH). The raft sits further out (RAFT_EXTRA_OUTWARD,
 * along the same guaranteed-open-water `out` direction) and to one side
 * (RAFT_LATERAL_OFFSET, along the perpendicular of `out` — (outZ, -outX),
 * a 90° rotation in the XZ plane, always the same rotational sense around
 * the ring so every raft ends up on a consistent side of its own boat).
 * RAFT_EXTRA_OUTWARD needs real margin, not just "past the boat": at some
 * ring headings the tile's own edge sits close enough behind the boat that
 * a modest push still let the tile occlude most of the raft, leaving only
 * a thin unclipped strip visible — read as a "sliver" bug before tracing
 * it to distance, not orientation (confirmed by parallax: rotating the
 * camera revealed more of the same raft rather than a shape that stayed
 * thin from every angle).
 */
function raftWorldXZ(p: PortPlacement): [number, number] {
  return [
    p.position[0] + p.outX * RAFT_EXTRA_OUTWARD + p.outZ * RAFT_LATERAL_OFFSET,
    p.position[2] + p.outZ * RAFT_EXTRA_OUTWARD - p.outX * RAFT_LATERAL_OFFSET,
  ]
}

/**
 * Fixed XZ this rig's board camera starts at (CatanScene.tsx's
 * `camera={{ position: [0, 9, 8], ... }}`). A raft with no yaw is
 * world-axis-aligned regardless of where it sits on the ring — for some
 * port headings the camera ends up looking almost straight down the
 * raft's own wide (0.64) axis, foreshortening the whole rectangular deck
 * into a near-invisible sliver. Yawing each raft so its *short* (0.4,
 * depth) axis points at the camera keeps the wide axis roughly
 * perpendicular to the view instead, presenting its broad face — the
 * same fix, and the same formula, this file used earlier for vertical
 * plaque content that needed to face the camera rather than the board
 * center to stay legible from every ring position.
 */
const CAMERA_XZ: readonly [number, number] = [0, 8]

/** Yaw that points local +Z at CAMERA_XZ (rotationY(θ) maps local +Z to world (sinθ, cosθ)). */
function facingAngle(x: number, z: number): number {
  return Math.atan2(CAMERA_XZ[0] - x, CAMERA_XZ[1] - z)
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
 * needed (mirrors CatanBoard.tsx's InstancedVariant). Yawed per port
 * (rotationsY, Y-axis only — the deck stays perfectly flat on the water,
 * never tilted) via facingAngle, so the deck's wide axis doesn't
 * foreshorten into a sliver at ring headings where a fixed world
 * orientation would put it edge-on to the camera.
 */
function RaftInstances({
  geometry,
  material,
  positions,
  rotationsY,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  positions: readonly [number, number, number][]
  rotationsY: readonly number[]
}) {
  const ref = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const inst = ref.current
    if (!inst) return
    positions.forEach((p, i) => {
      SCRATCH_MATRIX.makeRotationY(rotationsY[i]!).scale(RAFT_SCALE_V3).setPosition(p[0], p[1], p[2])
      inst.setMatrixAt(i, SCRATCH_MATRIX)
    })
    inst.instanceMatrix.needsUpdate = true
    inst.computeBoundingSphere()
    inst.raycast = noRaycast
  }, [positions, rotationsY])

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
 * Set back to 1.0 after the winding fix below (see buildIconGeometry):
 * black icons were originally (mis)diagnosed as a lighting problem and
 * "fixed" with a 1.3x multiplier here, which changed nothing because the
 * real cause was upstream of any color value reaching the shader at all.
 * Kept as a hook in case the correctly-lit colors genuinely need a nudge.
 */
const CONTENT_BRIGHTNESS = 1.0

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
 * Flips a Shape's Y coordinates (screen-down -> font/world-up) *before*
 * extrusion, by re-tessellating it into plain polygons (extractPoints)
 * and rebuilding a fresh Shape/Path from the negated points instead of
 * mirroring the built 3D geometry afterward. That was the original
 * approach (`merged.scale(scale, -scale, scale)`) and it was wrong: a
 * mirror baked directly into vertex positions flips winding as the
 * rasterizer sees it, but three.js has no way to know that after the
 * fact — unlike a live Object3D negative scale, which the renderer
 * specially detects and compensates for, a mirror baked into raw
 * BufferGeometry data is invisible to that compensation. With the
 * content material's `DoubleSide`, three.js flips the *shading* normal
 * based on `gl_FrontFacing` (a winding-derived, hardware-computed
 * front/back test) to keep double-sided surfaces lit correctly from
 * either side — but that assumes winding and the stored normal still
 * agree. After the un-compensated mirror they didn't, so the visible cap
 * consistently got a normal facing away from the light: geometrically
 * present, correctly vertex-colored, and rendered fully unlit (black)
 * regardless of resource. Flipping the *2D shape* first sidesteps the
 * whole problem: ExtrudeGeometry computes correct winding for whatever
 * shape it's given, so there's no mirror left to compensate for.
 */
function flipShapeY(shape: THREE.Shape, divisions: number): THREE.Shape {
  const { shape: outer, holes } = shape.extractPoints(divisions)
  const flipped = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, -p.y)))
  for (const hole of holes) {
    flipped.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, -p.y))))
  }
  return flipped
}

/**
 * Converts one resource's icon path data (RESOURCE_ICON_PATHS — the same
 * data ResourceIcon.tsx draws as a 2D <svg>, single source of truth) into
 * flat extruded geometry via SVGLoader, vertex-colored with the icon's own
 * two-tone main/shadow fill. The Y-flip (flipShapeY) plus the same
 * rotateX(-90°) treatment TextGeometry gets below lays the icon flat,
 * extrude-axis pointing world +Y (up, proud) and glyph-up pointing world
 * -Z — reading correctly under the board's fixed oblique camera, same as
 * the number tokens.
 *
 * The extrude depth is specified in the icon's own raw 24-unit viewBox
 * space, not world units directly: ExtrudeGeometry builds the shape's X/Y
 * *and* its Z (depth) in that same local space, and the later uniform
 * `scale(scale, scale, scale)` divides all three by ~120x (ICON_VIEWBOX /
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
      const flipped = flipShapeY(shape, 12)
      const geo = new THREE.ExtrudeGeometry(flipped, {
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
  merged.scale(scale, scale, scale)
  merged.rotateX(-Math.PI / 2)
  merged.center()
  return merged
}

/**
 * Rotates a local (offsetX, 0) position offset by yaw θ — the position-only
 * counterpart of Matrix4.makeRotationY (x' = x·cosθ, z' = -x·sinθ), used to
 * keep content/backing centered on the raft once the deck itself is yawed.
 * Never applied to the content geometry's own orientation, only to where
 * it's translated — see the CONTENT block comment for why.
 */
function rotateOffsetX(offsetX: number, cos: number, sin: number): [number, number] {
  return [offsetX * cos, -offsetX * sin]
}

/**
 * Bakes every port's content (ink backing + icon + "2:1" for resource
 * ports, backing + "3:1" alone for generic ones) directly into world space
 * and merges it into one static mesh — see the CONTENT and ink-backing
 * block comments above for why this beats per-resource instancing and a
 * separate backing layer. Every piece shares the same per-port yaw
 * (facingAngle, matching RaftInstances) for its *position*; only the
 * backing plate's own geometry is rotated to match (a plain rectangle has
 * no "reading direction" to protect) — the icon/text geometry itself never
 * rotates.
 */
function buildContentGeometry(
  placements: readonly PortPlacement[],
  inkBacking: THREE.BufferGeometry,
  iconGeometry: Record<Resource, THREE.BufferGeometry>,
  rate2to1: THREE.BufferGeometry,
  rate3to1: THREE.BufferGeometry,
): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = []
  for (const p of placements) {
    const [x, z] = raftWorldXZ(p)
    const yaw = facingAngle(x, z)
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)

    const backing = colorize(inkBacking, INK)
    backing.rotateY(yaw)
    backing.translate(x, INK_BACKING_Y, z)
    parts.push(backing)

    if (p.kind === 'generic') {
      const [tx, tz] = rotateOffsetX(RATE_TEXT_X_ALONE, cos, sin)
      const text = colorize(rate3to1, GENERIC_RATE_COLOR)
      text.translate(x + tx, CONTENT_Y, z + tz)
      parts.push(text)
    } else {
      const [ix, iz] = rotateOffsetX(ICON_LOCAL_X, cos, sin)
      const icon = iconGeometry[p.kind].clone()
      icon.translate(x + ix, CONTENT_Y, z + iz)

      const [tx, tz] = rotateOffsetX(RATE_TEXT_X_PAIRED, cos, sin)
      const text = colorize(rate2to1, RESOURCE_COLORS[p.kind])
      text.translate(x + tx, CONTENT_Y, z + tz)

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
 * above the water beside each boat, yawed per port (facingAngle) so its
 * wide axis presents broadside to the camera instead of foreshortening
 * edge-on at some ring headings. Carries the resource icon (SVGLoader-
 * converted from ResourceIcon.tsx's path data) and trade rate for resource
 * ports, or just the rate for generic ones, on an ink backing plate — both
 * lying flat and reading straight up like the number tokens (unaffected by
 * the raft's own yaw — see the CONTENT block comment). Draw calls: 1 raft
 * InstancedMesh (shadow-casting, so 2 passes: main + the sun's shadow map)
 * + 1 merged content mesh (ink backing + icons + all rate text, no
 * shadow) = 3 total.
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
      }),
    [],
  )

  const inkBackingGeometry = useMemo(
    // BoxGeometry is indexed by default; the icon/text geometries it gets
    // merged with (ExtrudeGeometry/TextGeometry) aren't — mergeGeometries
    // requires every input to match on indexed-ness or none at all.
    () => new THREE.BoxGeometry(INK_BACKING_W, INK_BACKING_HEIGHT, INK_BACKING_D).toNonIndexed(),
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

  const raftRotations = useMemo(
    () =>
      placements.map((p) => {
        const [x, z] = raftWorldXZ(p)
        return facingAngle(x, z)
      }),
    [placements],
  )

  const contentGeometry = useMemo(
    () => buildContentGeometry(placements, inkBackingGeometry, iconGeometry, rateGeometry.twoToOne, rateGeometry.threeToOne),
    [placements, inkBackingGeometry, iconGeometry, rateGeometry],
  )

  const raftMaterial = raftMesh && (Array.isArray(raftMesh.material) ? raftMesh.material[0]! : raftMesh.material)

  return (
    <>
      {raftMesh && raftMaterial && (
        <RaftInstances
          geometry={raftMesh.geometry}
          material={raftMaterial}
          positions={raftPositions}
          rotationsY={raftRotations}
        />
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
