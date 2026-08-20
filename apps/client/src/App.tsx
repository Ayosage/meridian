import { useEffect } from 'react'
import { CatanScene } from './scene/catan/CatanScene'
import { useCatanStore } from './scene/catan/catanStore'
import { Lobby } from './ui/Lobby'
import { WaitingRoom } from './ui/WaitingRoom'
import { BuildBar } from './ui/BuildBar'
import { DiscardModal } from './ui/DiscardModal'
import { StealChooser } from './ui/StealChooser'
import { CatanHud } from './ui/CatanHud'
import { TradePanel } from './ui/TradePanel'
import { IncomingOffer } from './ui/IncomingOffer'
import { DevCardStrip } from './ui/DevCardStrip'
import { YearOfPlentyModal } from './ui/YearOfPlentyModal'
import { MonopolyModal } from './ui/MonopolyModal'
import { reconnectCatan } from './net/catan'
import './ui/hud.css'

export function App() {
  const status = useCatanStore((s) => s.status)
  const view = useCatanStore((s) => s.view)

  useEffect(() => {
    void reconnectCatan()
  }, [])

  if (status === 'idle' || status === 'connecting' || status === 'error') return <Lobby />
  if (status === 'waiting') return <WaitingRoom />

  // 'playing' / 'reconnecting' / 'ended': once a snapshot has ever arrived
  // (view !== null), keep rendering the match — 'ended' still needs the
  // board behind CatanHud's win overlay, and 'reconnecting' keeps the last
  // known view up rather than flashing back to the lobby.
  if (view === null) return <Lobby />

  return (
    <>
      <CatanScene view={view} />
      <CatanHud />
      <BuildBar />
      <TradePanel />
      <IncomingOffer />
      <DevCardStrip />
      <YearOfPlentyModal />
      <MonopolyModal />
      <DiscardModal />
      <StealChooser />
    </>
  )
}
