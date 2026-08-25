import type { Resource } from '@meridian/rules'
import { RESOURCE_COLORS } from '../scene/catan/palette'

const LABELS: Record<Resource, string> = {
  wood: 'Wood',
  brick: 'Brick',
  sheep: 'Sheep',
  wheat: 'Wheat',
  ore: 'Ore',
}

/** Multiplies each RGB channel by `factor` — the icon's second (shadow) fill. */
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * factor)
  const g = Math.round(((n >> 8) & 255) * factor)
  const b = Math.round((n & 255) * factor)
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * Silhouette path data per resource: [main fill, shadow fill]. Flat,
 * two-tone, single-viewBox-unit glyphs — no gradients, no strokes. Each
 * `d` may hold several `M…Z` subpaths (still one fill, one <path>).
 */
const GLYPHS: Record<Resource, { main: string; shadow: string }> = {
  // Pine tree: stepped zigzag canopy over a short trunk.
  wood: {
    main: 'M12 2 L16 8 L13.3 8 L17.6 14.3 L14.3 14.3 L20 21 L4 21 L9.7 14.3 L6.4 14.3 L10.7 8 L8 8 Z',
    shadow: 'M10.3 21 H13.7 V23 H10.3 Z',
  },
  // Running-bond brick stack: two ground bricks, one offset brick above.
  brick: {
    main: 'M2 15 H10.5 V20.5 H2 Z M13.5 15 H22 V20.5 H13.5 Z',
    shadow: 'M7 8 H17 V13.5 H7 Z',
  },
  // Fluffy cloud-blob body; head + four short legs in the shadow tone.
  sheep: {
    main: 'M4.5 15.5c-1.9 0-3.4-1.4-3.4-3.2 0-1.6 1.2-2.9 2.7-3.1.3-2 2.1-3.6 4.3-3.6 1.2 0 2.3.5 3.1 1.3.7-.8 1.7-1.3 2.9-1.3 2.1 0 3.9 1.6 4.1 3.7 1.8.1 3.2 1.5 3.2 3.2 0 1.8-1.6 3.3-3.6 3.3H4.5Z',
    shadow:
      'M18.4 9.4a1.8 1.8 0 1 1 3.6 0 1.8 1.8 0 0 1-3.6 0Z M5 15.5h1.3v3.3H5Z M8.6 15.5h1.3v3.3H8.6Z M12.2 15.5h1.3v3.3h-1.3Z M15.8 15.5h1.3v3.3h-1.3Z',
  },
  // Wheat ear: central stem, four mirrored spike pairs, tip cap — all
  // in the main tone; the stem shows through as the shadow tone.
  wheat: {
    main:
      'M12 2.5 L14.2 5.8 L12 7.4 L9.8 5.8 Z ' +
      'M12 9 L18.3 6 L14.7 8.6 Z M12 9 L5.7 6 L9.3 8.6 Z ' +
      'M12 12.3 L18.3 9.3 L14.7 11.9 Z M12 12.3 L5.7 9.3 L9.3 11.9 Z ' +
      'M12 15.6 L18.3 12.6 L14.7 15.2 Z M12 15.6 L5.7 12.6 L9.3 15.2 Z ' +
      'M12 18.9 L18.3 15.9 L14.7 18.5 Z M12 18.9 L5.7 15.9 L9.3 18.5 Z',
    shadow: 'M11.2 6.5 H12.8 V21.5 H11.2 Z',
  },
  // Faceted gem: full silhouette in the main tone, one diagonal shading facet.
  ore: {
    main: 'M12 2.5 L19.5 8.8 L16 21 L8 21 L4.5 8.8 Z',
    shadow: 'M12 2.5 L4.5 8.8 L8 21 L11.3 12 Z',
  },
}

/**
 * One inline SVG glyph per resource, replacing the flat `res-dot` color
 * circle everywhere resources are listed. Two fills only: the resource's
 * `RESOURCE_COLORS` hue (palette.ts — single source of truth for resource
 * color, shared with the 3D scene) and a darker shade of the same hue, so
 * color association with the existing palette survives.
 */
export function ResourceIcon({ r, className }: { r: Resource; className?: string }) {
  const glyph = GLYPHS[r]
  const main = RESOURCE_COLORS[r]
  return (
    <svg
      className={className ? `res-icon ${className}` : 'res-icon'}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      role="img"
      aria-label={LABELS[r]}
    >
      <title>{LABELS[r]}</title>
      <path d={glyph.main} fill={main} />
      <path d={glyph.shadow} fill={shade(main, 0.62)} />
    </svg>
  )
}
