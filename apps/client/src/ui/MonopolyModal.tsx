import { RESOURCES } from '@meridian/rules'
import { sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { ResourceIcon } from './ResourceIcon'
import './hud.css'

/** Name-a-resource picker (design spec §3): click = play. */
export function MonopolyModal() {
  const devModal = useCatanStore((s) => s.devModal)
  const submitMonopoly = useCatanStore((s) => s.submitMonopoly)
  const closeDevModal = useCatanStore((s) => s.closeDevModal)

  if (devModal !== 'monopoly') return null

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Monopoly</div>
        <div className="modal-total">Name a resource — every player gives you all of theirs</div>
        <div className="steal-victims">
          {RESOURCES.map((r) => (
            <button type="button" className="steal-victim-btn" key={r} data-testid={`monopoly-pick-${r}`} onClick={() => submitMonopoly(r, sendCatanIntent)}>
              <ResourceIcon r={r} /> {r}
            </button>
          ))}
        </div>
        <button type="button" className="trade-tab" data-testid="monopoly-cancel" onClick={closeDevModal}>Cancel</button>
      </div>
    </div>
  )
}
