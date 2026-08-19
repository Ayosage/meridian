import { coordKey, type Coord } from '@meridian/rules'
import { sendIntent } from './net/connection'
import { useMeridianStore } from './store'

export function clickTile(c: Coord): void {
  const s = useMeridianStore.getState()
  const pieceId = s.selectedPieceId
  if (!pieceId) return
  if (!s.legalTargets.has(coordKey(c))) {
    s.clearSelection()
    return
  }
  sendIntent({ type: 'move', pieceId, to: c })
  s.clearSelection()
}

export function clickPiece(id: string): void {
  const s = useMeridianStore.getState()
  const piece = s.game?.pieces.find((p) => p.id === id)
  if (!piece) return
  if (piece.owner === s.seat) {
    s.selectPiece(id)
    return
  }
  clickTile(piece.at) // enemy piece: capture attempt on its hex
}

export function endTurn(): void {
  sendIntent({ type: 'endTurn' })
}
