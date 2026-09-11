// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCatanStore } from '../src/scene/catan/catanStore'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const net = vi.hoisted(() => ({ configureLobby: vi.fn(), startMatch: vi.fn(), leaveCatanMatch: vi.fn() }))
vi.mock('../src/net/catan', () => net)
vi.mock('../src/ui/LobbyBackdrop', () => ({ LobbyBackdrop: () => <div data-testid="lobby-backdrop" /> }))

import { WaitingRoom } from '../src/ui/WaitingRoom'

/** Client render in jsdom so zustand's live state (not its SSR initial state) reaches the markup. */
function render(el: React.ReactElement): string {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(el))
  const html = host.innerHTML
  act(() => root.unmount())
  return html
}

/** Keep the tree mounted so buttons can be clicked. */
function mount(el: React.ReactElement): { host: HTMLElement; root: Root; click(testid: string): void } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  return {
    host,
    root,
    click(testid) {
      const b = host.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)
      if (!b) throw new Error(`no ${testid}`)
      act(() => b.click())
    },
  }
}

function seed(opts: { seats: number; target: number; bots: number; seat: number; names?: string[] }) {
  const s = useCatanStore.getState()
  s.reset()
  s.setJoined('PUVF')
  s.setSeat(opts.seat)
  s.setLobby(
    Array.from({ length: opts.seats }, (_, i) => `seat-${i}`),
    Array.from({ length: opts.seats }, () => true),
    opts.target,
    opts.bots,
    opts.names,
  )
}

describe('WaitingRoom', () => {
  beforeEach(() => {
    useCatanStore.getState().reset()
    net.configureLobby.mockReset()
    net.startMatch.mockReset()
  })

  it('labels seats positionally: an empty name falls back to Player N, a named seat keeps its name', () => {
    seed({ seats: 2, target: 3, bots: 0, seat: 0, names: ['', 'Bob'] })
    const html = render(<WaitingRoom />)
    expect(html).toContain('Player 1')
    expect(html).toContain('Bob')
    expect(html).not.toContain('Player 2')
  })

  it('shows the code, the invite link controls, and a way out', () => {
    seed({ seats: 1, target: 4, bots: 0, seat: 0 })
    const html = render(<WaitingRoom />)
    expect(html).toContain('data-testid="join-code"')
    expect(html).toContain('PUVF')
    expect(html).toContain('data-testid="copy-code"')
    expect(html).toContain('data-testid="copy-link"')
    expect(html).toContain('data-testid="leave-match"')
    expect(html).toContain('Waiting for players (1/4)')
    expect(html).toContain('The match starts when you press Start now')
  })

  it('the host sees the table controls and a Start now that says what bots will fill', () => {
    seed({ seats: 2, target: 4, bots: 0, seat: 0 })
    const html = render(<WaitingRoom />)
    expect(html).toContain('data-testid="players-4"')
    expect(html).toContain('data-testid="bots-0"')
    expect(html).toContain('data-testid="start-now"')
    expect(html).toContain('Start now fills 2 empty seats with bots')
    expect(html).not.toContain('data-testid="table-summary"')
  })

  it('changing the table sends configure; Start now sends start', () => {
    seed({ seats: 2, target: 4, bots: 0, seat: 0 })
    const m = mount(<WaitingRoom />)
    m.click('players-6')
    expect(net.configureLobby).toHaveBeenLastCalledWith(6, 0)
    m.click('bots-2')
    expect(net.configureLobby).toHaveBeenLastCalledWith(4, 2)
    m.click('start-now')
    expect(net.startMatch).toHaveBeenCalledTimes(1)
    act(() => m.root.unmount())
    m.host.remove()
  })

  it('bot counts that would push out seated players are disabled, and shrinking the table clamps bots', () => {
    seed({ seats: 3, target: 4, bots: 3, seat: 0 })
    const m = mount(<WaitingRoom />)
    const bots = (n: number) => m.host.querySelector<HTMLButtonElement>(`[data-testid="bots-${n}"]`)!
    expect(bots(1).disabled).toBe(false)
    expect(bots(2).disabled).toBe(true)
    expect(bots(3).disabled).toBe(true)
    m.click('players-3')
    expect(net.configureLobby).toHaveBeenLastCalledWith(3, 0)
    act(() => m.root.unmount())
    m.host.remove()
  })

  it('a joiner sees the table as text, no controls, and no start button', () => {
    seed({ seats: 2, target: 4, bots: 1, seat: 1 })
    const html = render(<WaitingRoom />)
    expect(html).toContain('data-testid="table-summary"')
    expect(html).toContain('4 players, 1 bot')
    expect(html).not.toContain('data-testid="players-4"')
    expect(html).not.toContain('data-testid="start-now"')
    expect(html).toContain('when the host presses Start now')
  })

  it('bot seats render from the bot count', () => {
    seed({ seats: 1, target: 4, bots: 3, seat: 0 })
    const html = render(<WaitingRoom />)
    expect(html).toContain('Bot 1')
    expect(html).toContain('Waiting for players (1/1)')
  })
})
