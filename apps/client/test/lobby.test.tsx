// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCatanStore } from '../src/scene/catan/catanStore'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Client render in jsdom so zustand's live state (not its SSR initial state) reaches the markup. */
function render(el: React.ReactElement): string {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(el))
  const html = host.innerHTML
  act(() => root.unmount())
  return html
}
import { Lobby } from '../src/ui/Lobby'

// The backdrop mounts a WebGL canvas; jsdom has none. Stub it.
vi.mock('../src/ui/LobbyBackdrop', () => ({ LobbyBackdrop: () => <div data-testid="lobby-backdrop" /> }))

describe('Lobby', () => {
  beforeEach(() => useCatanStore.getState().reset())

  it('renders the connection note the net layer leaves in the store', () => {
    const s = useCatanStore.getState()
    s.setToast('Connection to the match was lost.')
    s.setStatus('error')
    const html = render(<Lobby />)
    expect(html).toContain('data-testid="lobby-error"')
    expect(html).toContain('Connection to the match was lost.')
  })

  it('shows no error line when idle', () => {
    expect(render(<Lobby />)).not.toContain('data-testid="lobby-error"')
  })

  it('labels both choices and the code input', () => {
    const html = render(<Lobby />)
    expect(html).toContain('<legend>Players</legend>')
    expect(html).toContain('<legend>Bots to fill empty seats</legend>')
    expect(html).toMatch(/<label for="join-code-input">Join with a code<\/label>/)
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('data-testid="lobby-backdrop"')
  })

  it('keeps every bot count on screen so the row never reflows; counts above the table are disabled', () => {
    const html = render(<Lobby />)
    for (let n = 0; n <= 7; n++) expect(html).toContain(`data-testid="bots-${n}"`)
    // default table is 4 players: bots 4..7 are disabled, 0..3 enabled
    expect(html).toMatch(/data-testid="bots-3"[^>]*>/)
    expect(html).not.toMatch(/data-testid="bots-3"[^>]*disabled/)
    expect(html).toMatch(/data-testid="bots-4"[^>]*disabled/)
  })
})
