import { COSTS, hasResources } from '@meridian/rules'
import { useCatanStore } from '../scene/catan/catanStore'

const PIECES = [
  { kind: 'placeRoad' as const, cost: 'road' as const, label: 'Road', testId: 'build-road' },
  { kind: 'placeSettlement' as const, cost: 'settlement' as const, label: 'Settlement', testId: 'build-settlement' },
  { kind: 'placeCity' as const, cost: 'city' as const, label: 'City', testId: 'build-city' },
]

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
          </button>
        )
      })}
    </div>
  )
}
