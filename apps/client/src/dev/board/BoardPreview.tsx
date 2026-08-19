import { useEffect, useMemo } from 'react'
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
import { useCatanStore, type Mode } from '../../scene/catan/catanStore'
import { BuildBar } from '../../ui/BuildBar'

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

  // Task 9 needs a mode-switchable, our-turn "main phase" view (a fresh
  // game's real turn state starts in setup) so PickLayer/Highlights/BuildBar
  // can be eyeballed for every mode without a server driving turn.setup.
  return { ...view, buildings, roads, turn: { ...view.turn, phase: 'main', current: 0 } }
}

const MODE_SWITCHES: readonly { mode: Mode; label: string }[] = [
  { mode: { kind: 'idle' }, label: 'Idle' },
  { mode: { kind: 'placeRoad' }, label: 'Place Road' },
  { mode: { kind: 'placeSettlement' }, label: 'Place Settlement' },
  { mode: { kind: 'placeCity' }, label: 'Place City' },
  { mode: { kind: 'robber' }, label: 'Robber' },
]

/**
 * Dev-only mode switcher: sets the store's `mode` directly, no server
 * round-trip needed, so every PickLayer/Highlights mode can be verified
 * visually on /board.
 */
function ModeSwitcher() {
  const mode = useCatanStore((s) => s.mode)
  const setMode = useCatanStore((s) => s.setMode)
  return (
    <div style={{ position: 'fixed', top: 12, left: 12, zIndex: 10, display: 'flex', gap: 6 }}>
      {MODE_SWITCHES.map((m) => (
        <button
          key={m.label}
          type="button"
          data-testid={`dev-mode-${m.mode.kind}`}
          onClick={() => setMode(m.mode)}
          style={{
            padding: '6px 10px',
            fontSize: 12,
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            background: mode.kind === m.mode.kind ? '#2c6e8f' : '#20222b',
            color: '#fff',
            border: 0,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

export function BoardPreview() {
  const view = useMemo(buildDemoView, [])

  // Task 9's PickLayer/Highlights/BuildBar read `seat`/`mode` from the store
  // (not from CatanScene's `view` prop), so the store needs a seat even
  // though this dev route has no server driving it.
  useEffect(() => {
    useCatanStore.getState().setSeat(0)
  }, [])

  return (
    <>
      <CatanScene view={view} />
      <ModeSwitcher />
      <div style={{ position: 'fixed', bottom: 16, left: 16, zIndex: 10 }}>
        <BuildBar />
      </div>
    </>
  )
}
