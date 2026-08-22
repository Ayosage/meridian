import { RESOURCES } from '@meridian/rules'
import { sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { selectionTotal } from '../scene/catan/tradeLogic'
import './hud.css'

/** Take-two-from-the-bank picker (design spec §3), DiscardModal pattern. */
export function YearOfPlentyModal() {
  const view = useCatanStore((s) => s.view)
  const devModal = useCatanStore((s) => s.devModal)
  const plentySelection = useCatanStore((s) => s.plentySelection)
  const incPlenty = useCatanStore((s) => s.incPlenty)
  const decPlenty = useCatanStore((s) => s.decPlenty)
  const submitPlenty = useCatanStore((s) => s.submitPlenty)
  const closeDevModal = useCatanStore((s) => s.closeDevModal)

  if (devModal !== 'yearOfPlenty' || view === null) return null
  const selected = selectionTotal(plentySelection)

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Year of Plenty</div>
        <div className="modal-total">Take any two resources from the bank</div>
        <div className="discard-rows">
          {RESOURCES.map((r) => (
            <div className="discard-row" key={r}>
              <span className="discard-label">{r}</span>
              <button type="button" className="stepper-btn" data-testid={`plenty-minus-${r}`} disabled={plentySelection[r] <= 0} onClick={() => decPlenty(r)}>&minus;</button>
              <span className="discard-value">{plentySelection[r]}</span>
              <button type="button" className="stepper-btn" data-testid={`plenty-plus-${r}`} disabled={selected >= 2 || plentySelection[r] >= view.bank[r]} onClick={() => incPlenty(r)}>+</button>
            </div>
          ))}
        </div>
        <div className="modal-total" data-testid="plenty-count">{selected} of 2 selected</div>
        <button type="button" className="modal-submit" data-testid="plenty-submit" disabled={selected !== 2} onClick={() => submitPlenty(sendCatanIntent)}>
          Take resources
        </button>
        <button type="button" className="trade-tab" data-testid="plenty-cancel" onClick={closeDevModal}>Cancel</button>
      </div>
    </div>
  )
}
