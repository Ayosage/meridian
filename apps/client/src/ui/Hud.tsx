import { useEffect } from 'react'
import { endTurn } from '../interaction'
import { useMeridianStore } from '../store'

export function Hud() {
  const { status, joinCode, seat, game, error, matchResult, setError } = useMeridianStore()

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 3000)
    return () => clearTimeout(t)
  }, [error, setError])

  const ourTurn = game !== null && seat !== null && game.winner === null && game.currentPlayer === seat
  const statusText =
    status === 'waiting'
      ? 'waiting for opponent'
      : status === 'reconnecting'
        ? 'reconnecting…'
        : status === 'ended'
          ? 'match over'
          : ourTurn
            ? 'your turn'
            : "opponent's turn"

  const winnerText =
    matchResult !== null || (game && game.winner !== null)
      ? (matchResult?.winner ?? game?.winner) === seat
        ? `You win${matchResult?.reason === 'forfeit' ? ' (forfeit)' : ''}`
        : `You lose${matchResult?.reason === 'forfeit' ? ' (forfeit)' : ''}`
      : null

  return (
    <div className="overlay">
      <div className="panel">
        {joinCode && (
          <div>
            code <span className="code" data-testid="join-code">{joinCode}</span>
          </div>
        )}
        <div data-testid="status">{statusText}</div>
      </div>
      <button className="end-turn" data-testid="end-turn" disabled={!ourTurn} onClick={endTurn}>
        END TURN
      </button>
      {error && (
        <div className="toast" data-testid="rule-error">
          {error}
        </div>
      )}
      {winnerText && (
        <div className="banner" data-testid="winner-banner">
          {winnerText}
        </div>
      )}
    </div>
  )
}
