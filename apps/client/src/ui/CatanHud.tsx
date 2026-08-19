import { useEffect } from 'react'
import { RESOURCES, type CatanClientState } from '@meridian/rules'
import { leaveCatanMatch, sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
// Only App.tsx imports hud.css today; this also mounts standalone wherever
// CatanHud is used, so it owns its own stylesheet dependency rather than
// relying on whichever entry point happens to import it first.
import './hud.css'

/**
 * Public VP for one seat, computed straight from the redacted view: hidden
 * VP dev cards never appear here by construction (CatanClientState doesn't
 * carry other seats' dev cards) — this is deliberately the *public* subset
 * of `@meridian/rules`' `victoryPoints`, not a reimplementation of it: that
 * helper is typed over the full `CatanState` (server-side, with real
 * `players[].devCards`), which a `CatanClientState` view doesn't structurally
 * match, so it can't be called here.
 */
function publicVictoryPoints(view: CatanClientState, seat: number): number {
  let vp = 0
  for (const b of Object.values(view.buildings)) {
    if (b.owner === seat) vp += b.kind === 'city' ? 2 : 1
  }
  if (view.awards.longestRoad === seat) vp += 2
  if (view.awards.largestArmy === seat) vp += 2
  return vp
}

function TurnBanner({ view, seat, connected }: { view: CatanClientState; seat: number | null; connected: boolean[] }) {
  const { current, phase } = view.turn
  const isYou = seat !== null && current === seat
  const isAutopilot = connected[current] === false

  const label = isYou
    ? phase === 'preRoll'
      ? 'Your turn — roll'
      : 'Your turn'
    : `Player ${current + 1}'s turn`

  return (
    <div className="turn-banner" data-testid="turn-banner">
      {label}
      {!isYou && isAutopilot && <span className="autopilot-badge">autopilot</span>}
    </div>
  )
}

function DiceDisplay({ dice }: { dice: readonly [number, number] | null }) {
  return (
    <div className="dice-display">
      {dice ? `⚅ ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}` : '⚅ —'}
    </div>
  )
}

function HandStrip({ view }: { view: CatanClientState }) {
  return (
    <div className="hand-strip">
      {RESOURCES.map((r) => (
        <div className="hand-count" key={r} data-testid={`hand-${r}`}>
          <span className="hand-label">{r}</span>
          <span className="hand-value">{view.you.resources[r]}</span>
        </div>
      ))}
    </div>
  )
}

function OpponentStrip({ view, seat, connected }: { view: CatanClientState; seat: number | null; connected: boolean[] }) {
  const opponents = view.players.map((_, i) => i).filter((i) => i !== seat)
  return (
    <div className="opponent-strip">
      {opponents.map((i) => {
        const p = view.players[i]!
        return (
          <div className="opponent-card" key={i} data-testid={`opponent-${i}`}>
            <div className="opponent-name">
              Player {i + 1}
              {connected[i] === false && <span className="autopilot-badge">autopilot</span>}
            </div>
            <div className="opponent-stats">
              <span>{p.resourceCount} cards</span>
              <span>{p.devCardCount} dev</span>
              <span>{p.knightsPlayed} knights</span>
              <span>{publicVictoryPoints(view, i)} VP</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Toast() {
  const toast = useCatanStore((s) => s.toast)
  const setToast = useCatanStore((s) => s.setToast)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast, setToast])

  if (!toast) return null
  return (
    <div className="toast" data-testid="rule-error">
      {toast}
    </div>
  )
}

function WinOverlay({ view }: { view: CatanClientState }) {
  const seat = useCatanStore((s) => s.seat)
  if (view.winner === null) return null
  const isYou = view.winner === seat
  return (
    <div className="modal-backdrop">
      <div className="modal win-overlay" data-testid="win-overlay">
        <div className="modal-title">{isYou ? 'You win!' : `Player ${view.winner + 1} wins`}</div>
        {view.winnerVpCards !== null && view.winnerVpCards > 0 && (
          <div className="win-vp-cards">+{view.winnerVpCards} VP cards revealed</div>
        )}
        <button type="button" className="modal-submit" data-testid="back-to-lobby" onClick={leaveCatanMatch}>
          Back to lobby
        </button>
      </div>
    </div>
  )
}

/**
 * Live-match HUD: turn/dice/roll/end-turn controls, own hand, opponent
 * public stats, toasts, and the win overlay. Mounted alongside CatanScene
 * once `view` is non-null (see App.tsx).
 */
export function CatanHud() {
  const view = useCatanStore((s) => s.view)
  const seat = useCatanStore((s) => s.seat)
  const connected = useCatanStore((s) => s.connected)

  if (view === null) return null

  const canRoll = view.turn.phase === 'preRoll' && seat !== null && view.turn.current === seat
  const canEndTurn = view.turn.phase === 'main' && seat !== null && view.turn.current === seat

  return (
    <div className="overlay catan-hud">
      <TurnBanner view={view} seat={seat} connected={connected} />
      <DiceDisplay dice={view.turn.dice} />
      <button
        type="button"
        className="roll-button"
        data-testid="roll-button"
        disabled={!canRoll}
        onClick={() => sendCatanIntent({ type: 'rollDice' })}
      >
        Roll
      </button>
      <button
        type="button"
        className="end-turn"
        data-testid="end-turn"
        disabled={!canEndTurn}
        onClick={() => sendCatanIntent({ type: 'endTurn' })}
      >
        END TURN
      </button>
      <HandStrip view={view} />
      <OpponentStrip view={view} seat={seat} connected={connected} />
      <Toast />
      <WinOverlay view={view} />
    </div>
  )
}
