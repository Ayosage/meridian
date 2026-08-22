import { useEffect } from 'react'
import { RESOURCES, type CatanClientState } from '@meridian/rules'
import { leaveCatanMatch, sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { playerCards } from '../scene/catan/hudLogic'
import { seatColor } from '../scene/catan/palette'
// Only App.tsx imports hud.css today; this also mounts standalone wherever
// CatanHud is used, so it owns its own stylesheet dependency rather than
// relying on whichever entry point happens to import it first.
import './hud.css'

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

function PlayerStrip({ view, seat, connected }: { view: CatanClientState; seat: number | null; connected: boolean[] }) {
  return (
    <div className="opponent-strip">
      {playerCards(view, seat, connected).map((c) => (
        <div
          className={c.isYou ? 'opponent-card you-card' : 'opponent-card'}
          key={c.seat}
          data-testid={c.isYou ? 'player-you' : `opponent-${c.seat}`}
          style={{ borderLeftColor: seatColor(c.seat) }}
        >
          <div className="opponent-name">
            <span className="seat-swatch" style={{ background: seatColor(c.seat) }} />
            {c.isYou ? 'You' : `Player ${c.seat + 1}`}
            {c.autopilot && <span className="autopilot-badge">autopilot</span>}
          </div>
          <div className="opponent-stats">
            <span>{c.resourceCount} cards</span>
            <span>{c.devCardCount} dev</span>
            <span>{c.knightsPlayed} knights</span>
            <span data-testid={`vp-${c.seat}`}>{c.vp} VP</span>
          </div>
        </div>
      ))}
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
 * Live-match HUD: turn/dice/roll/end-turn controls, own hand, the full
 * player strip (self card shows true VP incl. hidden VP dev cards; others
 * show public stats), toasts, and the win overlay. Mounted alongside CatanScene
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
      <PlayerStrip view={view} seat={seat} connected={connected} />
      <Toast />
      <WinOverlay view={view} />
    </div>
  )
}
