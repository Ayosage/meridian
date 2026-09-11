import { useState } from 'react'
import type { CatanPlayerCount } from '@meridian/rules'
import { createCatanMatch, describeJoinError, joinCatanMatch } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { LobbyBackdrop } from './LobbyBackdrop'
import { WaitingRoom } from './WaitingRoom'

const PLAYER_COUNTS = [3, 4, 5, 6, 7, 8] as const
/** Every bot count the biggest table allows; counts above the current table are disabled, not removed, so nothing reflows. */
const BOT_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7] as const

export function Lobby() {
  const status = useCatanStore((s) => s.status)
  // 'Connection lost' / dead-link notes are set by the net layer; the lobby
  // is the screen that ends up showing them.
  const note = useCatanStore((s) => (s.status === 'error' ? s.toast : null))
  const setToast = useCatanStore((s) => s.setToast)
  const [code, setCode] = useState('')
  const [players, setPlayers] = useState<CatanPlayerCount>(4)
  const [bots, setBots] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const maxBots = players - 1
  const busy = status === 'connecting'

  async function withCatch(fn: () => Promise<void>): Promise<void> {
    try {
      setError(null)
      setToast(null)
      await fn()
    } catch (e) {
      setError(describeJoinError(e))
      useCatanStore.getState().setStatus('idle')
    }
  }

  if (status === 'waiting') {
    return <WaitingRoom />
  }

  const canJoin = !busy && code.length === 4

  return (
    <div className="lobby">
      <LobbyBackdrop />
      <div className="lobby-panel">
        <h1 className="lobby-title">Meridian</h1>
        <p className="lobby-tagline">
          A board game for 3 to 8 players, one browser tab each. Settle the island, trade, and reach ten points first.
        </p>

        <fieldset className="lobby-group">
          <legend>Players</legend>
          <div className="seg" role="radiogroup" aria-label="Players">
            {PLAYER_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={players === n}
                data-testid={`players-${n}`}
                className={players === n ? 'seg-btn selected' : 'seg-btn'}
                disabled={busy}
                onClick={() => {
                  setPlayers(n)
                  setBots((b) => Math.min(b, n - 1))
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="lobby-group">
          <legend>Bots to fill empty seats</legend>
          <div className="seg" role="radiogroup" aria-label="Bots">
            {BOT_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={bots === n}
                data-testid={`bots-${n}`}
                className={bots === n ? 'seg-btn selected' : 'seg-btn'}
                disabled={busy || n > maxBots}
                onClick={() => setBots(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          className="wr-btn primary lobby-cta"
          data-testid="create-button"
          disabled={busy}
          onClick={() => void withCatch(() => createCatanMatch(players, bots))}
        >
          {busy ? 'Connecting…' : 'Create match'}
        </button>

        <div className="lobby-divider" role="separator">
          or
        </div>

        <form
          className="lobby-join"
          onSubmit={(e) => {
            e.preventDefault()
            if (canJoin) void withCatch(() => joinCatanMatch(code))
          }}
        >
          <label htmlFor="join-code-input">Join with a code</label>
          <div className="lobby-join-row">
            <input
              id="join-code-input"
              data-testid="join-input"
              className="lobby-code"
              maxLength={4}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD"
              aria-describedby="join-code-help"
            />
            <button type="submit" className="wr-btn" data-testid="join-button" disabled={!canJoin}>
              Join
            </button>
          </div>
          <span id="join-code-help" className="visually-hidden">
            Four letters from the host
          </span>
        </form>

        {(error || note) && (
          <div className="error" role="alert" data-testid="lobby-error">
            {error ?? note}
          </div>
        )}
      </div>
    </div>
  )
}
