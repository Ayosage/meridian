/**
 * Beauty-slice palette tokens — "Painted Miniature at Golden Hour".
 * Spec: docs/superpowers/specs/2026-08-19-beauty-slice-art-direction-design.md §1, §4.
 * These are the single source of truth for slice colors; production inherits them.
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
