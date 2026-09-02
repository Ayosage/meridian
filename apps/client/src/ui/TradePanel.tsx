import { RESOURCES, type CatanClientState, type Resource } from '@meridian/rules'
import { sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { ResourceIcon } from './ResourceIcon'
import { bankRates, offerResponsesFor, selectionTotal, type ResourceSelection } from '../scene/catan/tradeLogic'
import { seatLabel } from '../scene/catan/hudLogic'
import './hud.css'

/** Chip list for one side of posted terms, e.g. "2 wood" (shared with IncomingOffer). */
export function TermChips({ terms }: { terms: Partial<Record<Resource, number>> }) {
  return (
    <>
      {RESOURCES.filter((r) => (terms[r] ?? 0) > 0).map((r) => (
        <span className="res-chip" key={r}>
          <ResourceIcon r={r} />
          {terms[r]} {r}
        </span>
      ))}
    </>
  )
}

/** One stepper row over the five resources (shared by composer give/get and the counter draft). */
export function StepperRow({
  sel, hand, prefix, onInc, onDec,
}: {
  sel: ResourceSelection
  /** When set, a resource with 0 in hand renders depleted (give sides only). */
  hand: CatanClientState['you']['resources'] | null
  prefix: string
  onInc: (r: Resource) => void
  onDec: (r: Resource) => void
}) {
  return (
    <div className="res-stepper-row">
      {RESOURCES.map((r) => (
        <div className={hand !== null && hand[r] === 0 ? 'res-stepper depleted' : 'res-stepper'} key={r}>
          <span className="res-name"><ResourceIcon r={r} />{r}</span>
          <span className="res-count">{sel[r]}</span>
          <div className="steppers">
            <button type="button" className="mini-btn" data-testid={`${prefix}-minus-${r}`} disabled={sel[r] <= 0} onClick={() => onDec(r)}>&minus;</button>
            <button type="button" className="mini-btn" data-testid={`${prefix}-plus-${r}`} disabled={hand !== null && sel[r] >= hand[r]} onClick={() => onInc(r)}>+</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function Composer({ view, seat }: { view: CatanClientState; seat: number }) {
  const tradeTab = useCatanStore((s) => s.tradeTab)
  const setTradeTab = useCatanStore((s) => s.setTradeTab)
  const tradeGive = useCatanStore((s) => s.tradeGive)
  const tradeGet = useCatanStore((s) => s.tradeGet)
  const incTradeGive = useCatanStore((s) => s.incTradeGive)
  const decTradeGive = useCatanStore((s) => s.decTradeGive)
  const incTradeGet = useCatanStore((s) => s.incTradeGet)
  const decTradeGet = useCatanStore((s) => s.decTradeGet)
  const submitOffer = useCatanStore((s) => s.submitOffer)
  const bankGive = useCatanStore((s) => s.bankGive)
  const bankGet = useCatanStore((s) => s.bankGet)
  const setBankGive = useCatanStore((s) => s.setBankGive)
  const setBankGet = useCatanStore((s) => s.setBankGet)
  const submitBankTrade = useCatanStore((s) => s.submitBankTrade)
  const toggleTrade = useCatanStore((s) => s.toggleTrade)

  const rates = bankRates(view, seat)

  return (
    <div className="trade-panel" data-testid="trade-panel">
      <div className="trade-panel-header">
        <span className="title">Trade</span>
        <div className="trade-tabs">
          <button type="button" data-testid="trade-tab-players" className={tradeTab === 'players' ? 'trade-tab active' : 'trade-tab'} onClick={() => setTradeTab('players')}>Players</button>
          <button type="button" data-testid="trade-tab-bank" className={tradeTab === 'bank' ? 'trade-tab active' : 'trade-tab'} onClick={() => setTradeTab('bank')}>Bank</button>
        </div>
        <button type="button" className="mini-btn" data-testid="trade-close" onClick={toggleTrade}>&times;</button>
      </div>
      {tradeTab === 'players' ? (
        <>
          <div className="section-label">You give</div>
          <StepperRow sel={tradeGive} hand={view.you.resources} prefix="trade-give" onInc={incTradeGive} onDec={decTradeGive} />
          <div className="section-label">You get</div>
          <StepperRow sel={tradeGet} hand={null} prefix="trade-get" onInc={incTradeGet} onDec={decTradeGet} />
          <button
            type="button"
            className="modal-submit"
            data-testid="trade-offer-submit"
            disabled={selectionTotal(tradeGive) === 0 || selectionTotal(tradeGet) === 0}
            onClick={() => submitOffer(sendCatanIntent)}
          >
            Offer to players
          </button>
        </>
      ) : (
        <>
          <div className="section-label">You give</div>
          <div className="res-stepper-row">
            {RESOURCES.map((r) => (
              <button
                type="button"
                key={r}
                data-testid={`bank-give-${r}`}
                className={bankGive === r ? 'bank-chip selected' : 'bank-chip'}
                disabled={view.you.resources[r] < rates[r]}
                onClick={() => setBankGive(r)}
              >
                <span className="res-name"><ResourceIcon r={r} />{r}</span>
                <span className="bank-rate">{rates[r]}:1</span>
              </button>
            ))}
          </div>
          <div className="section-label">You get</div>
          <div className="res-stepper-row">
            {RESOURCES.map((r) => (
              <button
                type="button"
                key={r}
                data-testid={`bank-get-${r}`}
                className={bankGet === r ? 'bank-chip selected' : 'bank-chip'}
                disabled={view.bank[r] < 1}
                onClick={() => setBankGet(r)}
              >
                <span className="res-name"><ResourceIcon r={r} />{r}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="modal-submit"
            data-testid="bank-trade-submit"
            disabled={bankGive === null || bankGet === null || bankGive === bankGet}
            onClick={() => submitBankTrade(sendCatanIntent)}
          >
            {bankGive !== null && bankGet !== null && bankGive !== bankGet
              ? `Trade ${rates[bankGive]} ${bankGive} → 1 ${bankGet}`
              : 'Trade with the bank'}
          </button>
          <div className="trade-footnote">2:1 on a matching port · 3:1 with a generic port</div>
        </>
      )}
    </div>
  )
}

function OfferReview({ view, seat }: { view: CatanClientState; seat: number }) {
  const confirmTradeWith = useCatanStore((s) => s.confirmTradeWith)
  const cancelOpenTrade = useCatanStore((s) => s.cancelOpenTrade)
  const seatNames = useCatanStore((s) => s.seatNames)
  const responses = offerResponsesFor(view, seat)
  const offer = view.turn.openTrade
  if (!responses || !offer) return null

  return (
    <div className="trade-panel" data-testid="offer-review">
      <div className="trade-panel-header">
        <span className="title">Your offer</span>
        <button type="button" className="trade-tab" data-testid="offer-cancel" onClick={() => cancelOpenTrade(sendCatanIntent)}>Cancel</button>
      </div>
      <div className="offer-terms">
        <TermChips terms={offer.give} />
        <span>→</span>
        <TermChips terms={offer.get} />
      </div>
      <div className="response-rows">
        {responses.map((r) => (
          <div className="response-row" key={r.seat}>
            <span className="response-name">{seatLabel(seatNames, r.seat)}</span>
            <span className={`response-status ${r.kind}`}>
              {r.kind === 'waiting' && 'Waiting…'}
              {r.kind === 'accept' && 'Accepted'}
              {r.kind === 'reject' && 'Declined'}
              {r.kind === 'counter' && (
                <>Counter · you give <TermChips terms={r.youGive} />, get <TermChips terms={r.youGet} /></>
              )}
            </span>
            {(r.kind === 'accept' || r.kind === 'counter') && (
              <button type="button" className="confirm-btn" data-testid={`confirm-trade-${r.seat}`} onClick={() => confirmTradeWith(r.seat, sendCatanIntent)}>
                Confirm
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Docked trade surface (design spec §2, Option A): the composer while no
 * offer is open, the response review while our own offer is. Mounted next
 * to BuildBar in App.tsx; renders nothing off-turn or outside main phase.
 */
export function TradePanel() {
  const view = useCatanStore((s) => s.view)
  const seat = useCatanStore((s) => s.seat)
  const tradeOpen = useCatanStore((s) => s.tradeOpen)

  if (view === null || seat === null) return null
  if (view.turn.openTrade && view.turn.current === seat) return <OfferReview view={view} seat={seat} />
  if (!tradeOpen || view.turn.phase !== 'main' || view.turn.current !== seat) return null
  return <Composer view={view} seat={seat} />
}
