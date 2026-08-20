import { beforeEach, describe, expect, it } from 'vitest'
import {
  coordKey,
  createCatanGame,
  createRng,
  redactCatanState,
  standardTopology,
  type CatanClientState,
} from '@meridian/rules'
import {
  resolveEdgeClick,
  resolveHexClick,
  resolveVertexClick,
  robberVictims,
  useCatanStore,
} from '../src/scene/catan/catanStore'

/** A minimal valid view built from the real engine; buildings/roads/players/turn overridable per test. */
function makeView(overrides: {
  seat?: number
  turn?: Partial<CatanClientState['turn']>
  buildings?: CatanClientState['buildings']
  roads?: CatanClientState['roads']
  players?: CatanClientState['players']
} = {}): CatanClientState {
  const state = createCatanGame({ playerCount: 4 }, createRng(1))
  const base = redactCatanState(state, overrides.seat ?? 0)
  return {
    ...base,
    turn: { ...base.turn, ...overrides.turn },
    buildings: overrides.buildings ?? base.buildings,
    roads: overrides.roads ?? base.roads,
    players: overrides.players ?? base.players,
  }
}

const topo = standardTopology()

describe('resolveVertexClick / resolveEdgeClick (pure)', () => {
  it('setup settlement: legal vertex -> placeSetupSettlement', () => {
    const v = topo.vertices[0]!
    const view = makeView({ turn: { phase: 'setup', current: 0, setup: { expect: 'settlement', lastSettlement: null } } })
    expect(resolveVertexClick(view, 0, { kind: 'placeSettlement' }, v)).toEqual({
      type: 'placeSetupSettlement',
      vertex: v,
    })
  })

  it('setup settlement: occupied vertex is illegal -> null', () => {
    const v = topo.vertices[0]!
    const view = makeView({
      turn: { phase: 'setup', current: 0, setup: { expect: 'settlement', lastSettlement: null } },
      buildings: { [v]: { owner: 1, kind: 'settlement' } },
    })
    expect(resolveVertexClick(view, 0, { kind: 'placeSettlement' }, v)).toBeNull()
  })

  it('setup road: edge adjacent to lastSettlement -> placeSetupRoad', () => {
    const v = topo.vertices[0]!
    const e = topo.vertexEdges[v]![0]!
    const view = makeView({ turn: { phase: 'setup', current: 0, setup: { expect: 'road', lastSettlement: v } } })
    expect(resolveEdgeClick(view, 0, { kind: 'placeRoad' }, e)).toEqual({ type: 'placeSetupRoad', edge: e })
  })

  it('setup road: edge NOT adjacent to lastSettlement is illegal -> null', () => {
    const v = topo.vertices[0]!
    const farEdge = topo.edges.find((e) => !topo.vertexEdges[v]!.includes(e))!
    const view = makeView({ turn: { phase: 'setup', current: 0, setup: { expect: 'road', lastSettlement: v } } })
    expect(resolveEdgeClick(view, 0, { kind: 'placeRoad' }, farEdge)).toBeNull()
  })

  it('main-phase settlement: vertex reachable via our own road -> build settlement', () => {
    const v = topo.vertices[0]!
    const e = topo.vertexEdges[v]![0]!
    const view = makeView({ turn: { phase: 'main', current: 0 }, roads: { [e]: 0 } })
    expect(resolveVertexClick(view, 0, { kind: 'placeSettlement' }, v)).toEqual({
      type: 'build',
      piece: 'settlement',
      location: v,
    })
  })

  it('main-phase settlement: unreachable vertex is illegal -> null', () => {
    const v = topo.vertices[0]!
    const view = makeView({ turn: { phase: 'main', current: 0 } })
    expect(resolveVertexClick(view, 0, { kind: 'placeSettlement' }, v)).toBeNull()
  })

  it('main-phase road: edge reachable via our own settlement -> build road', () => {
    const v = topo.vertices[0]!
    const e = topo.vertexEdges[v]![1]!
    const view = makeView({ turn: { phase: 'main', current: 0 }, buildings: { [v]: { owner: 0, kind: 'settlement' } } })
    expect(resolveEdgeClick(view, 0, { kind: 'placeRoad' }, e)).toEqual({ type: 'build', piece: 'road', location: e })
  })

  it('city: our settlement -> build city', () => {
    const v = topo.vertices[0]!
    const view = makeView({ turn: { phase: 'main', current: 0 }, buildings: { [v]: { owner: 0, kind: 'settlement' } } })
    expect(resolveVertexClick(view, 0, { kind: 'placeCity' }, v)).toEqual({
      type: 'build',
      piece: 'city',
      location: v,
    })
  })

  it('city: an opponent settlement is illegal -> null', () => {
    const v = topo.vertices[0]!
    const view = makeView({ turn: { phase: 'main', current: 0 }, buildings: { [v]: { owner: 1, kind: 'settlement' } } })
    expect(resolveVertexClick(view, 0, { kind: 'placeCity' }, v)).toBeNull()
  })

  it('is a no-op outside a placement mode', () => {
    const v = topo.vertices[0]!
    const e = topo.vertexEdges[v]![0]!
    const view = makeView({ turn: { phase: 'main', current: 0 } })
    expect(resolveVertexClick(view, 0, { kind: 'idle' }, v)).toBeNull()
    expect(resolveEdgeClick(view, 0, { kind: 'idle' }, e)).toBeNull()
  })
})

describe('robberVictims / resolveHexClick (pure)', () => {
  function robberView(): CatanClientState {
    const state = createCatanGame({ playerCount: 4 }, createRng(2))
    const base = redactCatanState(state, 0)
    return { ...base, turn: { ...base.turn, phase: 'robber', current: 0 } }
  }

  it('robberVictims excludes ourselves and empty-handed opponents', () => {
    const view = robberView()
    const targetHex = view.board.hexes[0]!.coord
    const verts = topo.hexVertices[coordKey(targetHex)]!
    const rigged: CatanClientState = {
      ...view,
      buildings: {
        [verts[0]!]: { owner: 0, kind: 'settlement' }, // us -> excluded
        [verts[1]!]: { owner: 1, kind: 'settlement' }, // no resources -> excluded
        [verts[2]!]: { owner: 2, kind: 'settlement' }, // has resources -> included
      },
      players: view.players.map((p, i) => (i === 2 ? { ...p, resourceCount: 1 } : p)),
    }
    expect(robberVictims(rigged, 0, targetHex)).toEqual([2])
  })

  it('hex with a resourced adjacent opponent -> enters steal mode with that victim', () => {
    const view = robberView()
    const targetHex = view.board.hexes.find((h) => coordKey(h.coord) !== view.board.robber)!.coord
    const victimVertex = topo.hexVertices[coordKey(targetHex)]![0]!
    const rigged: CatanClientState = {
      ...view,
      buildings: { [victimVertex]: { owner: 1, kind: 'settlement' } },
      players: view.players.map((p, i) => (i === 1 ? { ...p, resourceCount: 2 } : p)),
    }
    expect(resolveHexClick(rigged, 0, { kind: 'robber' }, targetHex)).toEqual({
      mode: { kind: 'steal', hex: targetHex, victims: [1] },
    })
  })

  it('hex with no eligible victims -> sends moveRobber directly', () => {
    const view = robberView()
    const targetHex = view.board.hexes.find((h) => coordKey(h.coord) !== view.board.robber)!.coord
    expect(resolveHexClick(view, 0, { kind: 'robber' }, targetHex)).toEqual({
      intent: { type: 'moveRobber', hex: targetHex, stealFrom: null },
    })
  })

  it('cannot target the hex the robber already occupies', () => {
    const view = robberView()
    const robberHex = view.board.hexes.find((h) => coordKey(h.coord) === view.board.robber)!.coord
    expect(resolveHexClick(view, 0, { kind: 'robber' }, robberHex)).toBeNull()
  })

  it('is a no-op outside robber mode', () => {
    const view = robberView()
    const targetHex = view.board.hexes.find((h) => coordKey(h.coord) !== view.board.robber)!.coord
    expect(resolveHexClick(view, 0, { kind: 'idle' }, targetHex)).toBeNull()
  })
})

describe('store click handlers (mode transitions + injected send spy)', () => {
  beforeEach(() => {
    useCatanStore.getState().reset()
  })

  it('build-bar click sets, then un-sets, a voluntary placement mode', () => {
    useCatanStore.getState().toggleBuildMode('placeRoad')
    expect(useCatanStore.getState().mode).toEqual({ kind: 'placeRoad' })
    useCatanStore.getState().toggleBuildMode('placeRoad')
    expect(useCatanStore.getState().mode).toEqual({ kind: 'idle' })
  })

  it('build-bar click never overrides a forced mode', () => {
    useCatanStore.getState().setMode({ kind: 'robber' })
    useCatanStore.getState().toggleBuildMode('placeRoad')
    expect(useCatanStore.getState().mode).toEqual({ kind: 'robber' })
  })

  it('legal vertex click sends the intent and returns to idle (voluntary main-phase build)', () => {
    const sent: unknown[] = []
    const v = topo.vertices[0]!
    const e = topo.vertexEdges[v]![0]!
    const view = makeView({ turn: { phase: 'main', current: 0 }, roads: { [e]: 0 } })
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    useCatanStore.getState().setMode({ kind: 'placeSettlement' })

    useCatanStore.getState().clickVertex(v, (intent) => sent.push(intent))

    expect(sent).toEqual([{ type: 'build', piece: 'settlement', location: v }])
    expect(useCatanStore.getState().mode).toEqual({ kind: 'idle' })
  })

  it('illegal-target click sends nothing and leaves the mode untouched', () => {
    const sent: unknown[] = []
    const v = topo.vertices[0]!
    const view = makeView({ turn: { phase: 'main', current: 0 } }) // no road reaches v
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    useCatanStore.getState().setMode({ kind: 'placeSettlement' })

    useCatanStore.getState().clickVertex(v, (intent) => sent.push(intent))

    expect(sent).toEqual([])
    expect(useCatanStore.getState().mode).toEqual({ kind: 'placeSettlement' })
  })

  it('a forced setup click stays forced after sending (next snapshot resolves it)', () => {
    const sent: unknown[] = []
    const v = topo.vertices[0]!
    const view = makeView({
      turn: { phase: 'setup', current: 0, setup: { expect: 'settlement', lastSettlement: null } },
    })
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    expect(useCatanStore.getState().mode).toEqual({ kind: 'placeSettlement', forced: true })

    useCatanStore.getState().clickVertex(v, (intent) => sent.push(intent))

    expect(sent).toEqual([{ type: 'placeSetupSettlement', vertex: v }])
    expect(useCatanStore.getState().mode).toEqual({ kind: 'placeSettlement', forced: true })
  })

  it('Esc cancels a voluntary placement mode but never a forced one', () => {
    useCatanStore.getState().setMode({ kind: 'placeRoad' })
    useCatanStore.getState().cancelMode()
    expect(useCatanStore.getState().mode).toEqual({ kind: 'idle' })

    const view = makeView({
      turn: { phase: 'setup', current: 0, setup: { expect: 'settlement', lastSettlement: null } },
    })
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    expect(useCatanStore.getState().mode).toEqual({ kind: 'placeSettlement', forced: true })

    useCatanStore.getState().cancelMode()
    expect(useCatanStore.getState().mode).toEqual({ kind: 'placeSettlement', forced: true })
  })

  it('clickHex enters steal mode with victims, or sends moveRobber directly with none', () => {
    const state = createCatanGame({ playerCount: 4 }, createRng(3))
    const base = redactCatanState(state, 0)
    const targetHex = base.board.hexes.find((h) => coordKey(h.coord) !== base.board.robber)!.coord
    const victimVertex = topo.hexVertices[coordKey(targetHex)]![0]!
    const withVictim: CatanClientState = {
      ...base,
      turn: { ...base.turn, phase: 'robber', current: 0 },
      buildings: { [victimVertex]: { owner: 1, kind: 'settlement' } },
      players: base.players.map((p, i) => (i === 1 ? { ...p, resourceCount: 2 } : p)),
    }
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view: withVictim })
    expect(useCatanStore.getState().mode).toEqual({ kind: 'robber' })

    const sentWithVictim: unknown[] = []
    useCatanStore.getState().clickHex(targetHex, (intent) => sentWithVictim.push(intent))
    expect(sentWithVictim).toEqual([])
    expect(useCatanStore.getState().mode).toEqual({ kind: 'steal', hex: targetHex, victims: [1] })

    useCatanStore.getState().reset()
    const noVictim: CatanClientState = { ...base, turn: { ...base.turn, phase: 'robber', current: 0 } }
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view: noVictim })

    const sentNoVictim: unknown[] = []
    useCatanStore.getState().clickHex(targetHex, (intent) => sentNoVictim.push(intent))
    expect(sentNoVictim).toEqual([{ type: 'moveRobber', hex: targetHex, stealFrom: null }])
    expect(useCatanStore.getState().mode).toEqual({ kind: 'robber' })
  })
})
