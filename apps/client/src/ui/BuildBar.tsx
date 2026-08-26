import { COSTS, RESOURCES, hasResources } from '@meridian/rules'
import { useCatanStore } from '../scene/catan/catanStore'
import { canBuyDevCard } from '../scene/catan/devCardLogic'
import { sendCatanIntent } from '../net/catan'
import { ResourceIcon } from './ResourceIcon'
// Only App.tsx imports hud.css today; BuildBar also mounts standalone on the
// /board dev route (BoardPreview), so it owns its own stylesheet dependency
// rather than relying on whichever entry point happens to import it first.
import './hud.css'

const PIECES = [
  { kind: 'placeRoad' as const, cost: 'road' as const, label: 'Road', testId: 'build-road' },
  { kind: 'placeSettlement' as const, cost: 'settlement' as const, label: 'Settlement', testId: 'build-settlement' },
  { kind: 'placeCity' as const, cost: 'city' as const, label: 'City', testId: 'build-city' },
]

/** The action's price, straight from the rules' COSTS table — icons, with a count only when it isn't 1. */
function CostRow({ cost }: { cost: keyof typeof COSTS }) {
  return (
    <span className="build-cost" data-testid={`cost-${cost}`}>
      {RESOURCES.filter((r) => (COSTS[cost][r] ?? 0) > 0).map((r) => (
        <span key={r} className="build-cost-item">
          {(COSTS[cost][r] ?? 0) > 1 && `${COSTS[cost][r]} `}
          <ResourceIcon r={r} />
        </span>
      ))}
    </span>
  )
}

/**
 * Road/settlement/city buttons: click toggles the matching voluntary
 * placement mode (see catanStore.toggleBuildMode), disabled + dimmed when
 * unaffordable or it isn't our turn to build.
 */
export function BuildBar() {
  const view = useCatanStore((s) => s.view)
  const seat = useCatanStore((s) => s.seat)
  const mode = useCatanStore((s) => s.mode)
  const toggleBuildMode = useCatanStore((s) => s.toggleBuildMode)
  const tradeOpen = useCatanStore((s) => s.tradeOpen)
  const toggleTrade = useCatanStore((s) => s.toggleTrade)
  const tradeMute = useCatanStore((s) => s.tradeMute)
  const toggleTradeMute = useCatanStore((s) => s.toggleTradeMute)

  const canBuild = (cost: keyof typeof COSTS): boolean =>
    view !== null &&
    seat !== null &&
    view.turn.phase === 'main' &&
    view.turn.current === seat &&
    hasResources(view.you.resources, COSTS[cost])

  return (
    <div className="build-bar">
      {PIECES.map((p) => {
        const affordable = canBuild(p.cost)
        return (
          <button
            key={p.kind}
            type="button"
            data-testid={p.testId}
            className={mode.kind === p.kind ? 'build-bar-btn active' : 'build-bar-btn'}
            disabled={!affordable}
            onClick={() => toggleBuildMode(p.kind)}
          >
            {p.label}
            <CostRow cost={p.cost} />
          </button>
        )
      })}
      <button
        type="button"
        data-testid="build-dev"
        className="build-bar-btn"
        disabled={view === null || seat === null || !canBuyDevCard(view, seat)}
        onClick={() => sendCatanIntent({ type: 'buyDevCard' })}
      >
        Dev Card
        <CostRow cost="devCard" />
      </button>
      <button
        type="button"
        data-testid="trade-toggle"
        className={tradeOpen ? 'build-bar-btn active' : 'build-bar-btn'}
        disabled={view === null || seat === null || view.turn.phase !== 'main' || view.turn.current !== seat}
        onClick={toggleTrade}
      >
        Trade
      </button>
      <button
        type="button"
        data-testid="trade-mute-toggle"
        className={tradeMute ? 'mute-pill active' : 'mute-pill'}
        onClick={toggleTradeMute}
      >
        {tradeMute ? 'Trades muted' : 'Mute trades'}
      </button>
    </div>
  )
}
