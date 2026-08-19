export const TILE_STATE = { none: 0, hover: 1, legal: 2, selected: 3 } as const
export type TileStateName = keyof typeof TILE_STATE

export const TILE_COLORS: Record<TileStateName, readonly [number, number, number]> = {
  none: [0.16, 0.18, 0.22],
  hover: [0.28, 0.32, 0.4],
  legal: [0.2, 0.45, 0.35],
  selected: [0.55, 0.45, 0.2],
}

/** Priority: selected > legal > hover > none. Single source of tile visual state. */
export function tileStateFor(
  key: string,
  hoveredKey: string | null,
  selectedKey: string | null,
  legalTargets: ReadonlySet<string>,
): TileStateName {
  if (key === selectedKey) return 'selected'
  if (legalTargets.has(key)) return 'legal'
  if (key === hoveredKey) return 'hover'
  return 'none'
}
