// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
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
})
