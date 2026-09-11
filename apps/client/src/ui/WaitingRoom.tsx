import { useEffect, useState } from 'react'
import { configureLobby, leaveCatanMatch, startMatch } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { maxBots, startPlan, tableSummary, humanTarget, inviteLink } from './waitingRoomLogic'
import { LobbyBackdrop } from './LobbyBackdrop'
import { BOT_COUNTS, PLAYER_COUNTS, Segmented } from './Segmented'

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
  const isHost = seat === 0
  const start = startPlan({ isHost, seated: seats.length, targetPlayers, botCount })
  const table = targetPlayers ?? 4
  const botCap = maxBots(table, seats.length)
  const fillText =
    start.kind === 'ready'
      ? start.fill === 0
        ? 'Everyone is here.'
        : start.fill === 1
          ? 'Start now fills 1 empty seat with a bot.'
          : `Start now fills ${start.fill} empty seats with bots.`
      : ''

  return (
    <div className="lobby waiting-room">
      <LobbyBackdrop />
      <div className="lobby-panel">
      <h1 className="lobby-title">Meridian</h1>

      <section className="wr-invite" aria-labelledby="wr-code-label">
        <div id="wr-code-label" className="wr-label">
          Match code
        </div>
        <div className="wr-code" data-testid="join-code">
          {code}
        </div>
        <p className="wr-help">
          Send the code or the link to your friends. The match starts when {humans} {humans === 1 ? 'player has' : 'players have'} joined, or when {isHost ? 'you start it' : 'the host starts it'}.
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
            {seatNames[i] || `Player ${i + 1}`}
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

      {isHost ? (
        <>
          <fieldset className="lobby-group">
            <legend>Players at the table</legend>
            <Segmented
              label="Players"
              options={PLAYER_COUNTS}
              value={table}
              prefix="players"
              onChange={(n) => configureLobby(n, Math.min(botCount, maxBots(n, seats.length)))}
            />
          </fieldset>
          <fieldset className="lobby-group">
            <legend>Bots to fill empty seats</legend>
            <Segmented
              label="Bots"
              options={BOT_COUNTS}
              value={botCount}
              prefix="bots"
              isDisabled={(n) => n > botCap}
              onChange={(n) => configureLobby(table, n)}
            />
          </fieldset>
          {start.kind === 'ready' && (
            <>
              <button type="button" className="wr-btn primary" data-testid="start-now" onClick={startMatch}>
                Start now
              </button>
              <p className="wr-help" data-testid="start-hint">
                {fillText}
              </p>
            </>
          )}
        </>
      ) : (
        <p className="wr-help" data-testid="table-summary">
          Table: {tableSummary(table, botCount)}. The host can change it before the match starts.
        </p>
      )}

      <button type="button" className="wr-btn quiet" data-testid="leave-match" onClick={leaveCatanMatch}>
        Leave match
      </button>
      </div>
    </div>
  )
}
