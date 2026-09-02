import { useEffect } from 'react'
import { sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { canAcceptOffer, incomingOfferFor, shouldShowOfferBanner } from '../scene/catan/tradeLogic'
import { seatLabel } from '../scene/catan/hudLogic'
import { StepperRow, TermChips } from './TradePanel'
import './hud.css'

/**
 * Responder's banner for the open offer (design spec §2): accept / counter /
 * decline while unanswered, a waiting line after answering. Hidden while a
 * forced mode (discard/robber/steal) needs this seat.
 */
export function IncomingOffer() {
  const view = useCatanStore((s) => s.view)
  const seat = useCatanStore((s) => s.seat)
  const mode = useCatanStore((s) => s.mode)
  const tradeMute = useCatanStore((s) => s.tradeMute)
  const autoDeclineIfMuted = useCatanStore((s) => s.autoDeclineIfMuted)
  const counterDraft = useCatanStore((s) => s.counterDraft)
  const respondToOffer = useCatanStore((s) => s.respondToOffer)
  const startCounter = useCatanStore((s) => s.startCounter)
  const cancelCounter = useCatanStore((s) => s.cancelCounter)
  const submitCounter = useCatanStore((s) => s.submitCounter)
  const incCounterGive = useCatanStore((s) => s.incCounterGive)
  const decCounterGive = useCatanStore((s) => s.decCounterGive)
  const incCounterGet = useCatanStore((s) => s.incCounterGet)
  const decCounterGet = useCatanStore((s) => s.decCounterGet)
  const seatNames = useCatanStore((s) => s.seatNames)

  // Unconditional (before any early return, per React's rules of hooks) so it
  // still runs on every snapshot even when the component itself renders null.
  useEffect(() => {
    autoDeclineIfMuted(sendCatanIntent)
  }, [view, seat, tradeMute, autoDeclineIfMuted])

  if (view === null || seat === null) return null
  if (mode.kind === 'discard' || mode.kind === 'robber' || mode.kind === 'steal') return null
  if (!shouldShowOfferBanner(view, seat, tradeMute)) return null
  const offer = incomingOfferFor(view, seat)!

  return (
    <div className="offer-banner" data-testid="offer-banner">
      <div className="title">{seatLabel(seatNames, offer.from)} offers a trade</div>
      {offer.responded ? (
        <div className="trade-footnote">Response sent — waiting for {seatLabel(seatNames, offer.from)}</div>
      ) : counterDraft !== null ? (
        <>
          <div className="section-label">You give</div>
          <StepperRow sel={counterDraft.give} hand={view.you.resources} prefix="counter-give" onInc={incCounterGive} onDec={decCounterGive} />
          <div className="section-label">You get</div>
          <StepperRow sel={counterDraft.get} hand={null} prefix="counter-get" onInc={incCounterGet} onDec={decCounterGet} />
          <div className="offer-actions">
            <button type="button" className="accept-btn" data-testid="counter-submit" onClick={() => submitCounter(sendCatanIntent)}>Send counter</button>
            <button type="button" className="counter-btn" data-testid="counter-cancel" onClick={cancelCounter}>Back</button>
          </div>
        </>
      ) : (
        <>
          <div className="offer-terms">
            <div className="offer-side">
              <span className="offer-side-label">You receive</span>
              <span><TermChips terms={offer.youReceive} /></span>
            </div>
            <span>→</span>
            <div className="offer-side">
              <span className="offer-side-label">You give</span>
              <span><TermChips terms={offer.youGive} /></span>
            </div>
          </div>
          <div className="offer-actions">
            <button
              type="button"
              className="accept-btn"
              data-testid="offer-accept"
              disabled={!canAcceptOffer(view, seat)}
              onClick={() => respondToOffer('accept', sendCatanIntent)}
            >
              Accept
            </button>
            <button type="button" className="counter-btn" data-testid="offer-counter" onClick={startCounter}>Counter</button>
            <button type="button" className="decline-btn" data-testid="offer-decline" onClick={() => respondToOffer('reject', sendCatanIntent)}>Decline</button>
          </div>
        </>
      )}
    </div>
  )
}
