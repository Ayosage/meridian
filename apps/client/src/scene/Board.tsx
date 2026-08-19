import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { coordKey, type Coord } from '@meridian/rules'
import { TILE_SIZE, boardCoords, coordToWorld } from './layout'
import { createBoardMaterial } from './boardMaterial'
import { TILE_STATE, tileStateFor } from './tileVisuals'

const SCRATCH_MATRIX = new THREE.Matrix4()

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

  const material = useMemo(() => createBoardMaterial(), [])
  useEffect(() => () => material.dispose(), [material])
  const stateAttr = useMemo(
    () => new THREE.InstancedBufferAttribute(new Float32Array(coords.length), 1),
    [coords],
  )
  useEffect(() => {
    geometry.setAttribute('aState', stateAttr)
  }, [geometry, stateAttr])

  useFrame((state) => {
    material.uniforms.uTime!.value = state.clock.elapsedTime
  })

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
    keys.forEach((key, i) => {
      stateAttr.array[i] = TILE_STATE[tileStateFor(key, hoveredRef.current, selectedCoordKey, legalTargets)]
    })
    stateAttr.needsUpdate = true
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
      args={[geometry, material, coords.length]}
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
    />
  )
}
