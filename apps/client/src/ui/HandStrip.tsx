import { RESOURCES, type CatanClientState } from '@meridian/rules'
import { ResourceIcon } from './ResourceIcon'

/**
 * Your hand, one cell per resource, with the bank's remaining stock as a dim
 * second line — the bank-shortage rule (short bank + 2+ claimants pays
 * nobody) is fair but unknowable at the table without it.
 */
export function HandStrip({ view }: { view: CatanClientState }) {
  return (
    <div className="hand-strip">
      {RESOURCES.map((r) => (
        <div className="hand-count" key={r} data-testid={`hand-${r}`}>
          <span className="hand-label"><ResourceIcon r={r} />{r}</span>
          <span className="hand-value" data-testid={`hand-value-${r}`}>{view.you.resources[r]}</span>
          <span className="bank-value" data-testid={`bank-${r}`}>bank {view.bank[r]}</span>
        </div>
      ))}
    </div>
  )
}
