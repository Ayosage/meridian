import { useMemo } from 'react'
import {
  createCatanGame,
  createRng,
  edgeId,
  redactCatanState,
  vertexId,
  type Building,
  type CatanClientState,
} from '@meridian/rules'
import { CatanScene } from '../../scene/catan/CatanScene'

/**
 * Local beginner-board view — no server, no room. Lets CatanScene's
 * terrain/piece/tint rendering be iterated on directly (dev-only, /board).
 */
function buildDemoView(): CatanClientState {
  const state = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
  const view = redactCatanState(state, 0)
  const center = { q: 0, r: 0 }

  // A few demo pieces (2 settlements, 1 city, 3 roads, spread across seats)
  // so tint + placement are visible on first load.
  const buildings: Record<string, Building> = {
    ...view.buildings,
    [vertexId(center, 0)]: { owner: 0, kind: 'settlement' },
    [vertexId(center, 2)]: { owner: 1, kind: 'settlement' },
    [vertexId(center, 4)]: { owner: 2, kind: 'city' },
  }
  const roads: Record<string, number> = {
    ...view.roads,
    [edgeId(center, 0)]: 0,
    [edgeId(center, 2)]: 1,
    [edgeId(center, 4)]: 3,
  }

  return { ...view, buildings, roads }
}

export function BoardPreview() {
  const view = useMemo(buildDemoView, [])
  return <CatanScene view={view} />
}
