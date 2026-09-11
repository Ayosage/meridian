import { useEffect } from 'react'
import { type CatanClientState } from '@meridian/rules'
import { leaveCatanMatch, sendCatanIntent } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { playerCards, seatLabel } from '../scene/catan/hudLogic'
import { seatColor } from '../scene/catan/palette'
import { ActionLog } from './ActionLog'
import { ConnectionBanner } from './ConnectionBanner'
import { DiceCanvas } from './DiceCanvas'
import { HandStrip } from './HandStrip'
// Only App.tsx imports hud.css today; this also mounts standalone wherever
// CatanHud is used, so it owns its own stylesheet dependency rather than
// relying on whichever entry point happens to import it first.
import './hud.css'

function TurnBanner({ view, seat, connected }: { view: CatanClientState; seat: number | null; connected: boolean[] }) {
  const seatNames = useCatanStore((s) => s.seatNames)
  const { current, phase } = view.turn
  const isYou = seat !== null && current === seat
  const isAutopilot = connected[current] === false

  // Setup turns say what the board is waiting for: the forced placement
  // has no button to discover, so a bare "Your turn" reads as a stall.
  const label = isYou
    ? phase === 'preRoll'
      ? 'Your turn: roll'
      : phase === 'setup' && view.turn.setup
        ? `Your turn: place a ${view.turn.setup.expect}`
        : phase === 'robber'
          ? 'Your turn: move the robber'
          : 'Your turn'
    : `${seatLabel(seatNames, current)}'s turn`

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
      <DiceCanvas dice={dice} />
      <span className="dice-total" data-testid="dice-total">
        {dice ? `${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}` : '—'}
      </span>
    </div>
  )
}


function PlayerStrip({ view, seat, connected }: { view: CatanClientState; seat: number | null; connected: boolean[] }) {
  const seatNames = useCatanStore((s) => s.seatNames)
  return (
    <div className={view.players.length > 4 ? 'opponent-strip compact' : 'opponent-strip'}>
      {playerCards(view, seat, connected).map((c) => (
        <div
          className={c.isYou ? 'opponent-card you-card' : 'opponent-card'}
          key={c.seat}
          data-testid={c.isYou ? 'player-you' : `opponent-${c.seat}`}
        >
          <div className="opponent-name">
            <span className="seat-swatch" style={{ background: seatColor(c.seat) }} />
            {c.isYou ? 'You' : seatLabel(seatNames, c.seat)}
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
  const toastSeq = useCatanStore((s) => s.toastSeq)
  const setToast = useCatanStore((s) => s.setToast)

  // Keyed on toastSeq, not the text: two identical rule errors in a row must
  // restart the 3s dismiss rather than letting the first timer close the second.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast, toastSeq, setToast])

  if (!toast) return null
  return (
    <div className="toast" role="status" aria-live="polite" data-testid="rule-error">
      {toast}
    </div>
  )
}

export function WinOverlay({ view }: { view: CatanClientState }) {
  const seat = useCatanStore((s) => s.seat)
  const seatNames = useCatanStore((s) => s.seatNames)
  const result = useCatanStore((s) => s.winner)
  const abandoned = result?.reason === 'abandoned'
  if (view.winner === null && !abandoned) return null
  const isYou = view.winner === seat
  const title = abandoned
    ? 'Match abandoned'
    : isYou
      ? 'You win!'
      : `${seatLabel(seatNames, view.winner ?? 0)} wins`
  return (
    <div className="modal-backdrop">
      <div className="modal win-overlay" data-testid="win-overlay">
        <div className="modal-title">{title}</div>
        {abandoned && <div className="win-vp-cards">Every player left, so the match was closed.</div>}
        {!abandoned && view.winnerVpCards !== null && view.winnerVpCards > 0 && (
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
      <ConnectionBanner />
      <TurnBanner view={view} seat={seat} connected={connected} />
      <DiceDisplay dice={view.turn.dice} />
      <div className="orbit-hint" data-testid="orbit-hint">
        drag to rotate · scroll to zoom
      </div>
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
      <div className="right-rail">
        <PlayerStrip view={view} seat={seat} connected={connected} />
        <ActionLog />
      </div>
      <Toast />
      <WinOverlay view={view} />
    </div>
  )
}
