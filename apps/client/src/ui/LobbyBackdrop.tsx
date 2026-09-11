import { Component, Suspense, useMemo, type ReactNode } from 'react'
import { CatanScene } from '../scene/catan/CatanScene'
import { lobbyBoardView } from '../scene/catan/lobbyView'
import './hud.css'

/** WebGL can fail (no GPU, blocked context): fall back to the still poster. */
class GlBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The real board behind the lobby: same scene the match uses, a local
 * beginner island with pieces on it, drifting slowly under a dark scrim so
 * the controls stay legible. Decorative: hidden from assistive tech.
 */
export function LobbyBackdrop() {
  const view = useMemo(() => lobbyBoardView(), [])
  const drift = useMemo(() => !prefersReducedMotion(), [])
  const poster = <div className="lobby-poster" />
  return (
    <div className="lobby-backdrop" aria-hidden="true" data-testid="lobby-backdrop">
      <GlBoundary fallback={poster}>
        <Suspense fallback={poster}>
          <CatanScene view={view} backdrop drift={drift} />
        </Suspense>
      </GlBoundary>
      <div className="lobby-scrim" />
    </div>
  )
}
