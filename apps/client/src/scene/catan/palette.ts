import type { Resource } from '@meridian/rules'

/**
 * Beauty-slice palette tokens — "Painted Miniature at Golden Hour".
 * Spec: docs/superpowers/specs/2026-08-19-beauty-slice-art-direction-design.md §1, §4.
 * These are the single source of truth for slice colors; production inherits them.
 * Promoted from dev/slice/palette.ts (Task 8) so the full board client shares one copy.
 */
export const palette = {
  terrain: {
    pine: '#0f2613', // deep pine green (forest canopy midtone)
    wheat: '#b8862c', // ochre wheat
    hills: '#a85838', // terracotta (future hills tile)
    mountain: '#5a6270', // slate blue rock
    snow: '#f5e6cc', // warm snow
    desert: '#d9c6a0', // parchment (future desert tile)
    tileSide: '#8c6b47', // puck side wood
  },
  players: {
    red: '#b32117',
    blue: '#1f4e8c',
    white: '#e8e2d4',
    orange: '#d0691a',
  },
  water: {
    deep: '#12333e',
    shallow: '#2c6b6a',
    foam: '#e8ecdf',
    skyReflect: '#b8cae8',
  },
  light: {
    sun: '#ffd9a0',
    skyFill: '#b8cae8',
    groundFill: '#6b5e4f',
  },
} as const

/** Seat-indexed player colors — shared by 3D pieces and HUD player cards. */
export const SEAT_COLORS: readonly string[] = [
  palette.players.red,
  palette.players.blue,
  palette.players.white,
  palette.players.orange,
]

export function seatColor(seat: number): string {
  return SEAT_COLORS[seat] ?? '#999999'
}

/** Port sail tint for a 2:1 resource port; generic ports keep the GLB's cream default. */
export const RESOURCE_COLORS: Readonly<Record<Resource, string>> = {
  wood: '#2d5a27',
  brick: '#b34a2a',
  sheep: '#8fbc5a',
  wheat: '#d9a84e',
  ore: '#7a8290',
}
