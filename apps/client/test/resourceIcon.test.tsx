import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { RESOURCES, type Resource } from '@meridian/rules'
import { ResourceIcon } from '../src/ui/ResourceIcon'

it('renders a distinct, titled SVG for every resource', () => {
  const markup: Record<Resource, string> = Object.fromEntries(
    RESOURCES.map((r) => [r, renderToStaticMarkup(<ResourceIcon r={r} />)]),
  ) as Record<Resource, string>

  // Accessibility: each glyph names its resource via <title> and aria-label.
  for (const r of RESOURCES) {
    expect(markup[r]).toContain('<svg')
    expect(markup[r]).toContain('<title>')
    expect(markup[r].toLowerCase()).toContain(`aria-label="${r}`)
  }

  // Distinctness: no two resources render identical markup (same silhouette).
  const rendered = Object.values(markup)
  expect(new Set(rendered).size).toBe(rendered.length)
})
