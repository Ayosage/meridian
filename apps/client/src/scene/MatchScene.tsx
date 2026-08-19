import { coordKey, type Coord, type GameState } from '@meridian/rules'
import { Board } from './Board'
import { Pieces } from './Pieces'

interface MatchSceneProps {
  game: GameState
  selectedPieceId: string | null
  legalTargets: ReadonlySet<string>
  onTileClick(c: Coord): void
  onPieceClick(id: string): void
}

export function MatchScene(props: MatchSceneProps) {
  const selected = props.game.pieces.find((p) => p.id === props.selectedPieceId)
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[6, 10, 4]} intensity={0.9} />
      <Board
        radius={props.game.ruleset.board.radius}
        legalTargets={props.legalTargets}
        selectedCoordKey={selected ? coordKey(selected.at) : null}
        onTileClick={props.onTileClick}
      />
      <Pieces
        game={props.game}
        selectedPieceId={props.selectedPieceId}
        onPieceClick={props.onPieceClick}
      />
    </>
  )
}
