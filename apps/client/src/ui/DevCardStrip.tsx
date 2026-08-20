import { sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { DEV_LABELS, devHand } from '../scene/catan/devCardLogic'
import './hud.css'

/**
 * Own dev-card hand above the hand strip (design spec §3). Play dispatch:
 * knight sends directly (next snapshot forces robber mode); roadBuilding
 * enters the staged board mode; yearOfPlenty/monopoly open their modals.
 */
export function DevCardStrip() {
  const view = useCatanStore((s) => s.view)
  const seat = useCatanStore((s) => s.seat)
  const startRoadBuilding = useCatanStore((s) => s.startRoadBuilding)
  const openDevModal = useCatanStore((s) => s.openDevModal)

  if (view === null || seat === null) return null
  const hand = devHand(view, seat)
  if (hand.length === 0) return null

  const play = (card: string) => {
    if (card === 'knight') sendCatanIntent({ type: 'playDevCard', card: 'knight' })
    else if (card === 'roadBuilding') startRoadBuilding()
    else if (card === 'yearOfPlenty') openDevModal('yearOfPlenty')
    else if (card === 'monopoly') openDevModal('monopoly')
  }

  return (
    <div className="dev-strip" data-testid="dev-strip">
      <div className="dev-strip-header">Dev cards · {view.devDeckCount} in deck</div>
      <div className="dev-cards-row">
        {hand.map((g) => (
          <div className="dev-card-tile" key={g.card} data-testid={`dev-tile-${g.card}`}>
            <div className="dev-card-name">
              <span>{DEV_LABELS[g.card]}</span>
              {g.newCount > 0 && <span className="badge-new">new</span>}
            </div>
            <span className="dev-card-count">×{g.count}</span>
            {g.card === 'vp' ? (
              <span className="dev-card-note">revealed at win</span>
            ) : (
              <button
                type="button"
                className="dev-play-btn"
                data-testid={`dev-play-${g.card}`}
                disabled={!g.playable}
                onClick={() => play(g.card)}
              >
                Play
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
