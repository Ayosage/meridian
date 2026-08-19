import { startEarly } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'

export function WaitingRoom() {
  const roomId = useCatanStore((s) => s.roomId)
  const seat = useCatanStore((s) => s.seat)
  const seats = useCatanStore((s) => s.seats)
  const connected = useCatanStore((s) => s.connected)
  const targetPlayers = useCatanStore((s) => s.targetPlayers)

  const isHost = seat === 0
  const canStartEarly = isHost && seats.length === 3 && targetPlayers === 4

  return (
    <div className="lobby waiting-room">
      <h1>Meridian</h1>
      <div className="panel">
        code <span className="code" data-testid="join-code">{roomId}</span>
      </div>
      <ul className="seat-list">
        {seats.map((_, i) => (
          <li key={i}>
            <span className={`dot ${connected[i] ? 'connected' : 'disconnected'}`} />
            Player {i + 1}
            {i === seat ? ' (you)' : ''}
          </li>
        ))}
      </ul>
      <div data-testid="status">
        waiting for players ({seats.length}/{targetPlayers ?? '?'})
      </div>
      {canStartEarly && (
        <button data-testid="start-early" onClick={startEarly}>
          Start now
        </button>
      )}
    </div>
  )
}
