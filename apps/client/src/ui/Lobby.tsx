import { useState } from 'react'
import { createCatanMatch, joinCatanMatch } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { WaitingRoom } from './WaitingRoom'

export function Lobby() {
  const status = useCatanStore((s) => s.status)
  const [code, setCode] = useState('')
  const [players, setPlayers] = useState<3 | 4>(4)
  const [bots, setBots] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const maxBots = players - 1
  const busy = status === 'connecting'

  async function withCatch(fn: () => Promise<void>): Promise<void> {
    try {
      setError(null)
      await fn()
    } catch {
      setError('could not reach the match — check the code and try again')
      useCatanStore.getState().setStatus('idle')
    }
  }

  if (status === 'waiting') {
    return <WaitingRoom />
  }

  return (
    <div className="lobby">
      <h1>Meridian</h1>
      <div className="players-choice">
        <button
          data-testid="players-3"
          className={players === 3 ? 'selected' : undefined}
          disabled={busy}
          onClick={() => {
            setPlayers(3)
            setBots((b) => Math.min(b, 2))
          }}
        >
          3 players
        </button>
        <button
          data-testid="players-4"
          className={players === 4 ? 'selected' : undefined}
          disabled={busy}
          onClick={() => setPlayers(4)}
        >
          4 players
        </button>
      </div>
      <div className="players-choice bots-choice">
        {Array.from({ length: maxBots + 1 }, (_, n) => (
          <button
            key={n}
            data-testid={`bots-${n}`}
            className={bots === n ? 'selected' : undefined}
            disabled={busy}
            onClick={() => setBots(n)}
          >
            {n === 0 ? 'No bots' : `${n} bot${n > 1 ? 's' : ''}`}
          </button>
        ))}
      </div>
      <button
        data-testid="create-button"
        disabled={busy}
        onClick={() => void withCatch(() => createCatanMatch(players, bots))}
      >
        Create match
      </button>
      <div>
        <input
          data-testid="join-input"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="CODE"
        />
        <button
          data-testid="join-button"
          disabled={busy || code.length !== 4}
          onClick={() => void withCatch(() => joinCatanMatch(code))}
        >
          Join
        </button>
      </div>
      {error && (
        <div className="error" data-testid="lobby-error">
          {error}
        </div>
      )}
    </div>
  )
}
