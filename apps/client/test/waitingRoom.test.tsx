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
import { WaitingRoom } from '../src/ui/WaitingRoom'

vi.mock('../src/ui/LobbyBackdrop', () => ({ LobbyBackdrop: () => <div data-testid="lobby-backdrop" /> }))

function seed(opts: { seats: number; target: number; bots: number; seat: number }) {
  const s = useCatanStore.getState()
  s.reset()
  s.setJoined('PUVF')
  s.setSeat(opts.seat)
  s.setLobby(
    Array.from({ length: opts.seats }, (_, i) => `sess-${i}`),
    Array.from({ length: opts.seats }, () => true),
    opts.target,
    opts.bots,
  )
}

describe('WaitingRoom', () => {
  beforeEach(() => useCatanStore.getState().reset())

  it('shows the code, the invite link controls, and a way out', () => {
    seed({ seats: 1, target: 4, bots: 0, seat: 0 })
    const html = render(<WaitingRoom />)
    expect(html).toContain('data-testid="join-code"')
    expect(html).toContain('PUVF')
    expect(html).toContain('data-testid="copy-code"')
    expect(html).toContain('data-testid="copy-link"')
    expect(html).toContain('data-testid="leave-match"')
    expect(html).toContain('Waiting for players (1/4)')
    expect(html).toContain('The match starts when 4 players have joined')
  })

  it('tells the host the early-start rule instead of hiding the control', () => {
    seed({ seats: 1, target: 4, bots: 0, seat: 0 })
    const html = render(<WaitingRoom />)
    expect(html).not.toContain('data-testid="start-early"')
    expect(html).toContain('start early once 3 players are here')
  })

  it('offers Start now at target-1 humans', () => {
    seed({ seats: 3, target: 4, bots: 0, seat: 0 })
    expect(render(<WaitingRoom />)).toContain('data-testid="start-early"')
  })

  it('says nothing about early start to a joiner or when bots fill the room', () => {
    seed({ seats: 2, target: 4, bots: 0, seat: 1 })
    expect(render(<WaitingRoom />)).not.toContain('start early')
    seed({ seats: 1, target: 4, bots: 3, seat: 0 })
    const html = render(<WaitingRoom />)
    expect(html).not.toContain('start early')
    expect(html).toContain('Bot 1')
    expect(html).toContain('when 1 player has joined')
  })
})
