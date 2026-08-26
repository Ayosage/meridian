import { startEarly } from '../net/catan'
import { useCatanStore } from '../scene/catan/catanStore'

export function WaitingRoom() {
  const roomId = useCatanStore((s) => s.roomId)
  const seat = useCatanStore((s) => s.seat)
  const seats = useCatanStore((s) => s.seats)
  const connected = useCatanStore((s) => s.connected)
  const targetPlayers = useCatanStore((s) => s.targetPlayers)
  const botCount = useCatanStore((s) => s.botCount)
  const seatNames = useCatanStore((s) => s.seatNames)

  const isHost = seat === 0
  const canStartEarly =
    isHost && seats.length >= 3 && targetPlayers !== null && seats.length === targetPlayers - 1 && botCount === 0
  const humanTarget = (targetPlayers ?? 0) - botCount

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
            {seatNames[i] ?? `Player ${i + 1}`}
            {i === seat ? ' (you)' : ''}
          </li>
        ))}
        {Array.from({ length: botCount }, (_, i) => (
          <li key={`bot-${i}`} data-testid={`bot-seat-${i}`}>
            <span className="dot connected" />
            Bot {i + 1}
          </li>
        ))}
      </ul>
      <div data-testid="status">
        waiting for players ({seats.length}/{humanTarget > 0 ? humanTarget : '?'})
      </div>
      {canStartEarly && (
        <button data-testid="start-early" onClick={startEarly}>
          Start now
        </button>
      )}
    </div>
  )
}
