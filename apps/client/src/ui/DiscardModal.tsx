import { RESOURCES } from '@meridian/rules'
import { sendCatanIntent } from '../net/catan'
import { discardSelectionTotal, useCatanStore } from '../scene/catan/catanStore'
// Only App.tsx imports hud.css today; this also mounts standalone on the
// /board dev route (BoardPreview), so it owns its own stylesheet dependency
// rather than relying on whichever entry point happens to import it first.
import './hud.css'

/**
 * Forced-discard overlay: server owes `view.turn.pendingDiscards[seat]` cards
 * (see catanStore.deriveMode — mode is 'discard' iff that's > 0). Per-resource
 * steppers are capped at the hand count; submit only enables at exact-N.
 */
export function DiscardModal() {
  const view = useCatanStore((s) => s.view)
  const seat = useCatanStore((s) => s.seat)
  const mode = useCatanStore((s) => s.mode)
  const discardSelection = useCatanStore((s) => s.discardSelection)
  const incrementDiscard = useCatanStore((s) => s.incrementDiscard)
  const decrementDiscard = useCatanStore((s) => s.decrementDiscard)
  const submitDiscard = useCatanStore((s) => s.submitDiscard)

  if (mode.kind !== 'discard' || view === null || seat === null) return null

  const owed = view.turn.pendingDiscards[seat] ?? 0
  const selected = discardSelectionTotal(discardSelection)

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Discard {owed} cards</div>
        <div className="discard-rows">
          {RESOURCES.map((r) => {
            const have = view.you.resources[r]
            const count = discardSelection[r]
            return (
              <div className="discard-row" key={r}>
                <span className="discard-label">{r}</span>
                <button
                  type="button"
                  className="stepper-btn"
                  data-testid={`discard-minus-${r}`}
                  disabled={count <= 0}
                  onClick={() => decrementDiscard(r)}
                >
                  &minus;
                </button>
                <span className="discard-value">
                  {count} / {have}
                </span>
                <button
                  type="button"
                  className="stepper-btn"
                  data-testid={`discard-plus-${r}`}
                  disabled={count >= have}
                  onClick={() => incrementDiscard(r)}
                >
                  +
                </button>
              </div>
            )
          })}
        </div>
        <div className="modal-total" data-testid="discard-count">
          {selected} / {owed} selected
        </div>
        <button
          type="button"
          className="modal-submit"
          data-testid="discard-submit"
          disabled={selected !== owed}
          onClick={() => submitDiscard(sendCatanIntent)}
        >
          Discard
        </button>
      </div>
    </div>
  )
}
