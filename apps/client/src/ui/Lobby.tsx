import { useState } from 'react'
import type { CatanPlayerCount } from '@meridian/rules'
import { createCatanMatch, describeJoinError, joinCatanMatch } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'
import { WaitingRoom } from './WaitingRoom'

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

  return (
    <div className="lobby">
      <h1>Meridian</h1>
      <div className="players-choice">
        {([3, 4, 5, 6, 7, 8] as const).map((n) => (
          <button
            key={n}
            data-testid={`players-${n}`}
            className={players === n ? 'selected' : undefined}
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy && code.length === 4) void withCatch(() => joinCatanMatch(code))
          }}
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
      {(error || note) && (
        <div className="error" role="alert" data-testid="lobby-error">
          {error ?? note}
        </div>
      )}
    </div>
  )
}
