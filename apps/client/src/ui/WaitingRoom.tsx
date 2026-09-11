import { useEffect, useState } from 'react'
import { leaveCatanMatch, startEarly } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { earlyStart, humanTarget, inviteLink } from './waitingRoomLogic'

/** Copies text and reports "Copied" for a moment; silent if the clipboard API is missing. */
function useCopy(): [copied: string | null, copy: (label: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (copied === null) return
    const t = setTimeout(() => setCopied(null), 1600)
    return () => clearTimeout(t)
  }, [copied])
  const copy = (label: string, text: string) => {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
    if (!clipboard?.writeText) return
    void clipboard.writeText(text).then(() => setCopied(label), () => undefined)
  }
  return [copied, copy]
}

export function WaitingRoom() {
  const roomId = useCatanStore((s) => s.roomId)
  const seat = useCatanStore((s) => s.seat)
  const seats = useCatanStore((s) => s.seats)
  const connected = useCatanStore((s) => s.connected)
  const targetPlayers = useCatanStore((s) => s.targetPlayers)
  const botCount = useCatanStore((s) => s.botCount)
  const seatNames = useCatanStore((s) => s.seatNames)
  const [copied, copy] = useCopy()

  const code = roomId ?? ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const link = inviteLink(origin, code)
  const humans = humanTarget(targetPlayers, botCount)
  const start = earlyStart({ isHost: seat === 0, seated: seats.length, targetPlayers, botCount })

  return (
    <div className="lobby waiting-room">
      <h1>Meridian</h1>

      <section className="wr-invite" aria-labelledby="wr-code-label">
        <div id="wr-code-label" className="wr-label">
          Match code
        </div>
        <div className="wr-code" data-testid="join-code">
          {code}
        </div>
        <p className="wr-help">
          Send the code or the link to your friends. The match starts when {humans} {humans === 1 ? 'player has' : 'players have'} joined.
        </p>
        <div className="wr-actions">
          <button type="button" className="wr-btn" data-testid="copy-code" onClick={() => copy('code', code)}>
            {copied === 'code' ? 'Copied' : 'Copy code'}
          </button>
          <button type="button" className="wr-btn" data-testid="copy-link" onClick={() => copy('link', link)}>
            {copied === 'link' ? 'Copied' : 'Copy invite link'}
          </button>
        </div>
      </section>

      <ul className="seat-list" aria-label="seats">
        {seats.map((_, i) => (
          <li key={i}>
            <span className={`dot ${connected[i] ? 'connected' : 'disconnected'}`} aria-hidden="true" />
            {seatNames[i] ?? `Player ${i + 1}`}
            {i === seat ? ' (you)' : ''}
            <span className="visually-hidden">{connected[i] ? ', connected' : ', disconnected'}</span>
          </li>
        ))}
        {Array.from({ length: botCount }, (_, i) => (
          <li key={`bot-${i}`} data-testid={`bot-seat-${i}`}>
            <span className="dot connected" aria-hidden="true" />
            Bot {i + 1}
          </li>
        ))}
      </ul>

      <div className="wr-status" role="status" aria-live="polite" data-testid="status">
        Waiting for players ({seats.length}/{humans > 0 ? humans : '?'})
      </div>

      {start.kind === 'ready' && (
        <button type="button" className="wr-btn primary" data-testid="start-early" onClick={startEarly}>
          Start now
        </button>
      )}
      {start.kind === 'needs' && (
        <p className="wr-help" data-testid="start-hint">
          You can start early once {start.players} players are here. Empty seats get a caretaker.
        </p>
      )}

      <button type="button" className="wr-btn quiet" data-testid="leave-match" onClick={leaveCatanMatch}>
        Leave match
      </button>
    </div>
  )
}
