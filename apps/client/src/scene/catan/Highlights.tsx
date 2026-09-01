import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { coordKey, type CatanClientState } from '@meridian/rules'
import { coordToWorld } from '../layout'
import { edgeWorld, TILE_TOP, vertexWorld } from './catanLayout'
import { legalEdgesForMode, legalVerticesForMode, useCatanStore } from './catanStore'
import { palette } from './palette'

const Y_LIFT = 0.01 // sits just above TILE_TOP so it never z-fights the board
const PULSE_SPEED = 4
const PULSE_BASE = 0.45
const PULSE_RANGE = 0.35

const SEAT_COLORS: readonly string[] = [
  palette.players.red,
  palette.players.blue,
  palette.players.white,
  palette.players.orange,
]

function seatColor(seat: number): string {
  return SEAT_COLORS[seat] ?? '#ffffff'
}

function usePulse(ref: React.RefObject<THREE.Mesh>) {
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.opacity = PULSE_BASE + PULSE_RANGE * Math.sin(clock.elapsedTime * PULSE_SPEED)
  })
}

/** Pulsing filled dot, flat on the ground — marks a legal vertex or robber-target hex. */
function PulseDot({ position, color }: { position: readonly [number, number, number]; color: string }) {
  const ref = useRef<THREE.Mesh>(null)
  usePulse(ref)
  return (
    <mesh ref={ref} position={[position[0], position[1] + Y_LIFT, position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.18, 24]} />
      <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** Pulsing bar along an edge — marks a legal road placement. Box (not a rotated plane) so a single Y-rotation aligns it, matching Roads/PickLayer. */
function PulseBar({
  position,
  angle,
  color,
}: {
  position: readonly [number, number, number]
  angle: number
  color: string
}) {
  const ref = useRef<THREE.Mesh>(null)
  usePulse(ref)
  return (
    <mesh ref={ref} position={[position[0], position[1] + Y_LIFT, position[2]]} rotation={[0, angle, 0]}>
      <boxGeometry args={[0.5, 0.03, 0.16]} />
      <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} />
    </mesh>
  )
}

/**
 * Legality glow for the active mode, in the local seat's color. Reuses the
 * store's legalVerticesForMode/legalEdgesForMode so the highlighted set is
 * always exactly what a click would accept.
 */
export function Highlights({ view }: { view: CatanClientState }) {
  const seat = useCatanStore((s) => s.seat)
  const mode = useCatanStore((s) => s.mode)
  if (seat === null) return null
  const color = seatColor(seat)

  if (mode.kind === 'placeSettlement' || mode.kind === 'placeCity') {
    const vw = vertexWorld(view.board.hexes)
    return (
      <group>
        {legalVerticesForMode(view, seat, mode).map((id) => {
          const pos = vw.get(id)
          return pos ? <PulseDot key={id} position={pos} color={color} /> : null
        })}
      </group>
    )
  }

  if (mode.kind === 'placeRoad' || mode.kind === 'roadBuilding') {
    const ew = edgeWorld(view.board.hexes)
    return (
      <group>
        {legalEdgesForMode(view, seat, mode).map((id) => {
          const edge = ew.get(id)
          return edge ? <PulseBar key={id} position={edge.pos} angle={edge.angle} color={color} /> : null
        })}
      </group>
    )
  }

  if (mode.kind === 'robber') {
    return (
      <group>
        {view.board.hexes
          .filter((hex) => coordKey(hex.coord) !== view.board.robber)
          .map((hex) => {
            const [x, , z] = coordToWorld(hex.coord)
            return <PulseDot key={coordKey(hex.coord)} position={[x, TILE_TOP, z]} color={color} />
          })}
      </group>
    )
  }

  return null
}
