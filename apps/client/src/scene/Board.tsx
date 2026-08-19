import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { coordKey, type Coord } from '@meridian/rules'
import { TILE_SIZE, boardCoords, coordToWorld } from './layout'
import { TILE_COLORS, tileStateFor } from './tileVisuals'

const SCRATCH_MATRIX = new THREE.Matrix4()
const SCRATCH_COLOR = new THREE.Color()

interface BoardProps {
  radius: number
  legalTargets: ReadonlySet<string>
  selectedCoordKey: string | null
  onTileClick(c: Coord): void
  onTileHover?(key: string | null): void
}

export function Board({
  radius,
  legalTargets,
  selectedCoordKey,
  onTileClick,
  onTileHover,
}: BoardProps) {
  const coords = useMemo(() => boardCoords(radius), [radius])
  const keys = useMemo(() => coords.map(coordKey), [coords])
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const hoveredRef = useRef<string | null>(null)

  const geometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(TILE_SIZE * 0.94, TILE_SIZE * 0.94, 0.15, 6)
    g.rotateY(Math.PI / 6) // pointy-top orientation to match the layout
    return g
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // Static transforms: once per board.
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    coords.forEach((c, i) => {
      const [x, y, z] = coordToWorld(c)
      SCRATCH_MATRIX.identity().setPosition(x, y, z)
      mesh.setMatrixAt(i, SCRATCH_MATRIX)
    })
    mesh.instanceMatrix.needsUpdate = true
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords])

  // Repaint when highlight inputs change.
  useEffect(() => {
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legalTargets, selectedCoordKey])

  function paint(): void {
    const mesh = meshRef.current
    if (!mesh) return
    keys.forEach((key, i) => {
      const state = tileStateFor(key, hoveredRef.current, selectedCoordKey, legalTargets)
      const [r, g, b] = TILE_COLORS[state]
      mesh.setColorAt(i, SCRATCH_COLOR.setRGB(r, g, b))
    })
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  function setHover(key: string | null): void {
    if (hoveredRef.current === key) return
    hoveredRef.current = key
    onTileHover?.(key)
    paint()
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, coords.length]}
      onPointerMove={(e) => {
        e.stopPropagation()
        setHover(e.instanceId !== undefined ? (keys[e.instanceId] ?? null) : null)
      }}
      onPointerOut={() => setHover(null)}
      onClick={(e) => {
        e.stopPropagation()
        if (e.instanceId === undefined) return
        const c = coords[e.instanceId]
        if (c) onTileClick(c)
      }}
    >
      <meshStandardMaterial />
    </instancedMesh>
  )
}
