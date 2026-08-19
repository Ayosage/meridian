import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { MatchScene } from './scene/MatchScene'
import { Lobby } from './ui/Lobby'
import { Hud } from './ui/Hud'
import { clickPiece, clickTile } from './interaction'
import { reconnectMatch } from './net/connection'
import { useMeridianStore } from './store'
import './ui/hud.css'

export function App() {
  const status = useMeridianStore((s) => s.status)
  const game = useMeridianStore((s) => s.game)
  const selectedPieceId = useMeridianStore((s) => s.selectedPieceId)
  const legalTargets = useMeridianStore((s) => s.legalTargets)

  useEffect(() => {
    void reconnectMatch()
  }, [])

  if (status === 'idle' || status === 'connecting' || status === 'error') return <Lobby />

  return (
    <>
      <Canvas
        camera={{ position: [0, 9.5, 8.5], fov: 45 }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <color attach="background" args={['#0d1017']} />
        {game && (
          <MatchScene
            game={game}
            selectedPieceId={selectedPieceId}
            legalTargets={legalTargets}
            onTileClick={clickTile}
            onPieceClick={clickPiece}
          />
        )}
      </Canvas>
      <Hud />
    </>
  )
}
