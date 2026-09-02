import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { coordKey, type CatanClientState } from '@meridian/rules'
import { coordToWorld } from '../layout'
import { edgeWorld, TILE_TOP, vertexWorld } from './catanLayout'
import { legalEdgesForMode, legalVerticesForMode, useCatanStore } from './catanStore'
import { seatColor } from './palette'

const Y_LIFT = 0.01 // sits just above TILE_TOP so it never z-fights the board
const PULSE_SPEED = 4
const PULSE_BASE = 0.45
const PULSE_RANGE = 0.35

// One geometry per marker shape for the whole layer: every dot/bar shares
// these buffers instead of each <circleGeometry>/<boxGeometry> element
// allocating its own (up to ~100 markers on a radius-3 board during setup).
const DOT_GEOMETRY = new THREE.CircleGeometry(0.18, 24)
const BAR_GEOMETRY = new THREE.BoxGeometry(0.5, 0.03, 0.16)

interface Dot {
  key: string
  position: readonly [number, number, number]
}
interface Bar extends Dot {
  angle: number
}

/**
 * Renders every marker off ONE pulsing material: a single useFrame writes
 * one opacity per frame, rather than one callback + one material per marker
 * (the previous PulseDot/PulseBar each registered their own). Filled dots
 * mark legal vertices / robber-target hexes; bars mark legal road edges
 * (box, not a rotated plane, so a single Y-rotation aligns it like Roads/PickLayer).
 */
function Markers({ color, dots, bars }: { color: string; dots: readonly Dot[]; bars: readonly Bar[] }) {
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: PULSE_BASE + PULSE_RANGE,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [color],
  )
  useEffect(() => () => material.dispose(), [material])
  useFrame(({ clock }) => {
    material.opacity = PULSE_BASE + PULSE_RANGE * Math.sin(clock.elapsedTime * PULSE_SPEED)
  })

  return (
    <group>
      {dots.map((d) => (
        <mesh
          key={d.key}
          geometry={DOT_GEOMETRY}
          material={material}
          position={[d.position[0], d.position[1] + Y_LIFT, d.position[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      ))}
      {bars.map((b) => (
        <mesh
          key={b.key}
          geometry={BAR_GEOMETRY}
          material={material}
          position={[b.position[0], b.position[1] + Y_LIFT, b.position[2]]}
          rotation={[0, b.angle, 0]}
        />
      ))}
    </group>
  )
}

/**
 * Legality glow for the active mode, in the local seat's color (palette's
 * shared seat table — all eight seats, same hue as the seat's pieces).
 * Reuses the store's legalVerticesForMode/legalEdgesForMode so the
 * highlighted set is always exactly what a click would accept.
 */
export function Highlights({ view }: { view: CatanClientState }) {
  const seat = useCatanStore((s) => s.seat)
  const mode = useCatanStore((s) => s.mode)
  if (seat === null) return null

  const dots: Dot[] = []
  const bars: Bar[] = []

  if (mode.kind === 'placeSettlement' || mode.kind === 'placeCity') {
    const vw = vertexWorld(view.board.hexes)
    for (const id of legalVerticesForMode(view, seat, mode)) {
      const position = vw.get(id)
      if (position) dots.push({ key: id, position })
    }
  } else if (mode.kind === 'placeRoad' || mode.kind === 'roadBuilding') {
    const ew = edgeWorld(view.board.hexes)
    for (const id of legalEdgesForMode(view, seat, mode)) {
      const edge = ew.get(id)
      if (edge) bars.push({ key: id, position: edge.pos, angle: edge.angle })
    }
  } else if (mode.kind === 'robber') {
    for (const hex of view.board.hexes) {
      const key = coordKey(hex.coord)
      if (key === view.board.robber) continue
      const [x, , z] = coordToWorld(hex.coord)
      dots.push({ key, position: [x, TILE_TOP, z] })
    }
  }

  if (dots.length === 0 && bars.length === 0) return null
  return <Markers color={seatColor(seat)} dots={dots} bars={bars} />
}
