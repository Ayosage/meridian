import { sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { seatLabel } from '../scene/catan/hudLogic'
// Only App.tsx imports hud.css today; this also mounts standalone on the
// /board dev route (BoardPreview), so it owns its own stylesheet dependency
// rather than relying on whichever entry point happens to import it first.
import './hud.css'

/**
 * Robber steal overlay: entered by catanStore.clickHex when a robbed hex has
 * eligible victims (see resolveHexClick). Lists each victim seat; clicking one
 * sends moveRobber with that seat as stealFrom — hex is carried in the mode.
 */
export function StealChooser() {
  const mode = useCatanStore((s) => s.mode)
  const view = useCatanStore((s) => s.view)
  const clickStealVictim = useCatanStore((s) => s.clickStealVictim)
  const seatNames = useCatanStore((s) => s.seatNames)

  if (mode.kind !== 'steal' || view === null) return null

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Steal from</div>
        <div className="steal-victims">
          {mode.victims.map((victim) => (
            <button
              key={victim}
              type="button"
              className="steal-victim-btn"
              data-testid={`steal-victim-${victim}`}
              onClick={() => clickStealVictim(victim, sendCatanIntent)}
            >
              {seatLabel(seatNames, victim)} ({view.players[victim]?.resourceCount ?? 0} cards)
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
