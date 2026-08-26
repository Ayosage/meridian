import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BuildBar } from '../src/ui/BuildBar'

/** The chunk of markup between a cost row's testid and the button's end. */
function costRow(html: string, id: string): string {
  const start = html.indexOf(`data-testid="${id}"`)
  expect(start, `${id} missing`).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</button>', start))
}

describe('BuildBar cost labels', () => {
  // Store is at its INITIAL state under node vitest (no match): buttons are
  // disabled, but every cost row must still teach what the action costs.
  const html = renderToStaticMarkup(<BuildBar />)

  it('road: wood + brick', () => {
    const row = costRow(html, 'cost-road')
    expect(row).toContain('Wood')
    expect(row).toContain('Brick')
    expect(row).not.toContain('Ore')
  })

  it('settlement: wood + brick + wheat + sheep', () => {
    const row = costRow(html, 'cost-settlement')
    for (const r of ['Wood', 'Brick', 'Wheat', 'Sheep']) expect(row).toContain(r)
  })

  it('city: one icon per unit — three ore, two wheat, no numerals', () => {
    const row = costRow(html, 'cost-city')
    expect(row.match(/aria-label="Ore"/g)).toHaveLength(3)
    expect(row.match(/aria-label="Wheat"/g)).toHaveLength(2)
    expect(row).not.toMatch(/>\s*[23]\s*</)
  })

  it('dev card: ore + wheat + sheep', () => {
    const row = costRow(html, 'cost-devCard')
    for (const r of ['Ore', 'Wheat', 'Sheep']) expect(row).toContain(r)
  })
})
