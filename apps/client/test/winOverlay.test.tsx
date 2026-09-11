// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { createCatanGame, createRng, redactCatanState } from '@meridian/rules'
import { useCatanStore } from '../src/scene/catan/catanStore'
import { WinOverlay } from '../src/ui/CatanHud'

const view = () => redactCatanState(createCatanGame({ playerCount: 4 }, createRng(1)), 0)

afterEach(() => useCatanStore.getState().reset())

describe('WinOverlay', () => {
  it('names the winner from the view, and says so when the match was abandoned', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 0, view: view() })
    await act(async () => root.render(<WinOverlay view={useCatanStore.getState().view!} />))
    expect(host.querySelector('[data-testid="win-overlay"]')).toBeNull()
    await act(async () => useCatanStore.getState().setWinner({ reason: 'abandoned', winner: null }))
    expect(host.querySelector('[data-testid="win-overlay"]')?.textContent).toMatch(/abandoned/i)
    await act(async () => root.unmount())
    host.remove()
  })
})
