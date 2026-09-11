import { useCatanStore } from '../scene/catan/catanStore'
import './hud.css'

/**
 * Tells the player the socket dropped and the client is retrying. Mounted in
 * the match overlay; before this, `status === 'reconnecting'` left the last
 * snapshot on screen with nothing saying why the board stopped moving.
 */
export function ConnectionBanner() {
  const status = useCatanStore((s) => s.status)
  if (status !== 'reconnecting') return null
  return (
    <div className="connection-strip" role="status" aria-live="polite" data-testid="connection-strip">
      Reconnecting to the match…
    </div>
  )
}
