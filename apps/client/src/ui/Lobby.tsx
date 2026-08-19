import { useState } from 'react'
import { createMatch, joinMatch } from '../net/connection'
import { useMeridianStore } from '../store'

export function Lobby() {
  const status = useMeridianStore((s) => s.status)
  const error = useMeridianStore((s) => s.error)
  const setError = useMeridianStore((s) => s.setError)
  const [code, setCode] = useState('')
  const busy = status === 'connecting'

  async function withCatch(fn: () => Promise<void>): Promise<void> {
    try {
      setError(null)
      await fn()
    } catch {
      setError('could not reach the match — check the code and try again')
      useMeridianStore.getState().setStatus('idle')
    }
  }

  return (
    <div className="lobby">
      <h1>Meridian</h1>
      <button data-testid="create-button" disabled={busy} onClick={() => void withCatch(createMatch)}>
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
          onClick={() => void withCatch(() => joinMatch(code))}
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
