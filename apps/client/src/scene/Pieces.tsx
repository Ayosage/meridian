import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { GameState } from '@meridian/rules'
import { coordToWorld } from './layout'

const SCRATCH_MATRIX = new THREE.Matrix4()
const TEAM_COLORS = [new THREE.Color('#4f7cff'), new THREE.Color('#ff5f4f')]
const FALLBACK_COLOR = new THREE.Color('#999999')

interface PiecesProps {
  game: GameState
  selectedPieceId: string | null
  onPieceClick(id: string): void
}

export function Pieces({ game, selectedPieceId, onPieceClick }: PiecesProps) {
  const capacity = game.ruleset.setup.length
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const idsRef = useRef<string[]>([])

  const geometry = useMemo(() => new THREE.ConeGeometry(0.35, 0.8, 5), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // Rewrite transforms + colors when the authoritative state (or selection) changes —
  // never per frame.
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    idsRef.current = []
    game.pieces.forEach((p, i) => {
      const [x, , z] = coordToWorld(p.at)
      const s = p.id === selectedPieceId ? 1.15 : 1
      SCRATCH_MATRIX.makeScale(s, s, s).setPosition(x, 0.55, z)
      mesh.setMatrixAt(i, SCRATCH_MATRIX)
      mesh.setColorAt(i, TEAM_COLORS[p.owner] ?? FALLBACK_COLOR)
      idsRef.current.push(p.id)
    })
    mesh.count = game.pieces.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [game, selectedPieceId])

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, capacity]}
      onClick={(e) => {
        e.stopPropagation()
        if (e.instanceId === undefined) return
        const id = idsRef.current[e.instanceId]
        if (id) onPieceClick(id)
      }}
    >
      <meshStandardMaterial />
    </instancedMesh>
  )
}
