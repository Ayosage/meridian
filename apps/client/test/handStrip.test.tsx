import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CatanClientState } from '@meridian/rules'
import { HandStrip } from '../src/ui/HandStrip'

const view = {
  you: { resources: { wood: 2, brick: 0, sheep: 1, wheat: 4, ore: 0 } },
  bank: { wood: 19, brick: 13, sheep: 7, wheat: 0, ore: 19 },
} as unknown as CatanClientState

describe('HandStrip', () => {
  it('shows your count and the bank stock for every resource', () => {
    const html = renderToStaticMarkup(<HandStrip view={view} />)
    expect(html).toContain('data-testid="hand-wheat"')
    expect(html).toContain('data-testid="bank-wheat"')
    // wheat: you hold 4, bank is empty — both visible
    expect(html).toMatch(/hand-wheat[^]*?4[^]*?bank-wheat[^]*?0/)
  })
})
