import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCatanGame,
  createRng,
  redactCatanState,
  standardTopology,
  type CatanClientState,
  type OwnedDevCard,
} from '@meridian/rules'
import { deriveMode, legalEdgesForMode, useCatanStore, type Mode } from '../src/scene/catan/catanStore'

function makeView(overrides: {
  seq?: number
  seat?: number
  turn?: Partial<CatanClientState['turn']>
  buildings?: CatanClientState['buildings']
  roads?: CatanClientState['roads']
  devCards?: OwnedDevCard[]
  bank?: Partial<CatanClientState['bank']>
} = {}): CatanClientState {
  const state = createCatanGame({ playerCount: 4 }, createRng(1))
  const base = redactCatanState(state, overrides.seat ?? 0)
  return {
    ...base,
    seq: overrides.seq ?? base.seq,
    buildings: overrides.buildings ?? base.buildings,
    roads: overrides.roads ?? base.roads,
    turn: { ...base.turn, ...overrides.turn },
    bank: { ...base.bank, ...overrides.bank },
    you: {
      ...base.you,
      devCards: overrides.devCards ?? base.you.devCards,
    },
  }
}

const ROAD_BUILDING_CARD: OwnedDevCard = { card: 'roadBuilding', boughtOnTurn: 1 }

const MAIN = { current: 0, phase: 'main' as const, number: 2 }

beforeEach(() => useCatanStore.getState().reset())

describe('roadBuilding mode lifecycle', () => {
  it('deriveMode clears roadBuilding when the turn/phase moves on', () => {
    const rb: Mode = { kind: 'roadBuilding', staged: [] }
    expect(deriveMode(makeView({ turn: { ...MAIN, current: 1 } }), 0, rb)).toEqual({ kind: 'idle' })
    expect(deriveMode(makeView({ turn: { ...MAIN, phase: 'robber' } }), 0, rb)).toEqual({ kind: 'robber' })
    expect(deriveMode(makeView({ turn: MAIN }), 0, rb)).toEqual(rb) // still our main turn: survives
  })

  it('deriveMode clears roadBuilding when still our turn but phase leaves main', () => {
    // Distinct from the 'robber' case above: this hits the roadBuilding-specific
    // clause directly rather than returning early at the robber branch.
    const rb: Mode = { kind: 'roadBuilding', staged: [] }
    expect(deriveMode(makeView({ turn: { ...MAIN, phase: 'ended' } }), 0, rb)).toEqual({ kind: 'idle' })
  })

  it('Esc cancels roadBuilding', () => {
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view: makeView({ seq: 1, turn: MAIN }) })
    useCatanStore.getState().setMode({ kind: 'roadBuilding', staged: [] })
    useCatanStore.getState().cancelMode()
    expect(useCatanStore.getState().mode).toEqual({ kind: 'idle' })
  })

  it('ruleError keeps roadBuilding but clears the staged picks', () => {
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view: makeView({ seq: 1, turn: MAIN }) })
    useCatanStore.getState().setMode({ kind: 'roadBuilding', staged: ['someEdge' as never] })
    useCatanStore.getState().ruleError('ILLEGAL_PLACEMENT: not a legal road edge')
    expect(useCatanStore.getState().mode).toEqual({ kind: 'roadBuilding', staged: [] })
  })

  it('clickEdge stages the first legal edge then sends the completed intent', () => {
    // Give seat 0 a settlement so it has legal road edges: pick any vertex,
    // then its edges are legal.
    const topo = standardTopology()
    const vertex = topo.vertices[0]!
    const edges = topo.vertexEdges[vertex]!
    const view = makeView({ seq: 1, turn: MAIN, buildings: { [vertex]: { owner: 0, kind: 'settlement' } } })
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    useCatanStore.getState().setMode({ kind: 'roadBuilding', staged: [] })

    const send = vi.fn()
    useCatanStore.getState().clickEdge(edges[0]!, send)
    expect(send).not.toHaveBeenCalled()
    expect(useCatanStore.getState().mode).toEqual({ kind: 'roadBuilding', staged: [edges[0]] })

    // second pick: an edge legal AFTER the overlay (any edge off the same vertex works)
    const second = legalEdgesForMode(view, 0, useCatanStore.getState().mode)[0]!
    useCatanStore.getState().clickEdge(second, send)
    expect(send).toHaveBeenCalledWith({ type: 'playDevCard', card: 'roadBuilding', edges: [edges[0], second] })
    expect(useCatanStore.getState().mode).toEqual({ kind: 'idle' })
  })
})

describe('startRoadBuilding', () => {
  it('enters roadBuilding mode and closes the trade panel when the seat has a playable card', () => {
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({
      seq: 1,
      view: makeView({ seq: 1, turn: MAIN, devCards: [ROAD_BUILDING_CARD] }),
    })
    useCatanStore.getState().toggleTrade()
    expect(useCatanStore.getState().tradeOpen).toBe(true)

    useCatanStore.getState().startRoadBuilding()
    expect(useCatanStore.getState().mode).toEqual({ kind: 'roadBuilding', staged: [] })
    expect(useCatanStore.getState().tradeOpen).toBe(false)
  })

  it('no-ops without a playable roadBuilding card in hand', () => {
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view: makeView({ seq: 1, turn: MAIN, devCards: [] }) })
    useCatanStore.getState().startRoadBuilding()
    expect(useCatanStore.getState().mode).toEqual({ kind: 'idle' })
  })

  it('no-ops while a forced mode (discard) is active', () => {
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({
      seq: 1,
      view: makeView({ seq: 1, turn: { current: 0, phase: 'main', number: 2, pendingDiscards: { 0: 3 } }, devCards: [ROAD_BUILDING_CARD] }),
    })
    expect(useCatanStore.getState().mode).toEqual({ kind: 'discard' })
    useCatanStore.getState().startRoadBuilding()
    expect(useCatanStore.getState().mode).toEqual({ kind: 'discard' })
  })
})

describe('dev modals', () => {
  it('plenty selection caps the total at 2 and submits via the intent builder', () => {
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view: makeView({ seq: 1, turn: MAIN }) })
    const s = useCatanStore.getState()
    s.openDevModal('yearOfPlenty')
    s.incPlenty('wheat'); s.incPlenty('ore'); s.incPlenty('wood') // third pick refused
    const sel = useCatanStore.getState().plentySelection
    expect(sel.wheat + sel.ore + sel.wood).toBe(2)
    const send = vi.fn()
    useCatanStore.getState().submitPlenty(send)
    expect(send).toHaveBeenCalledWith({ type: 'playDevCard', card: 'yearOfPlenty', take: ['wheat', 'ore'] })
    expect(useCatanStore.getState().devModal).toBeNull()
  })

  it('incPlenty refuses a pick on a resource the bank has none of, even under the total cap', () => {
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({
      seq: 1,
      view: makeView({ seq: 1, turn: MAIN, bank: { ore: 0 } }),
    })
    useCatanStore.getState().openDevModal('yearOfPlenty')
    useCatanStore.getState().incPlenty('ore')
    expect(useCatanStore.getState().plentySelection.ore).toBe(0)
  })

  it('decPlenty floors at 0', () => {
    useCatanStore.getState().openDevModal('yearOfPlenty')
    useCatanStore.getState().decPlenty('wheat')
    expect(useCatanStore.getState().plentySelection.wheat).toBe(0)
  })

  it('closeDevModal clears devModal', () => {
    useCatanStore.getState().openDevModal('monopoly')
    expect(useCatanStore.getState().devModal).toBe('monopoly')
    useCatanStore.getState().closeDevModal()
    expect(useCatanStore.getState().devModal).toBeNull()
  })

  it('submitMonopoly sends and closes', () => {
    useCatanStore.getState().openDevModal('monopoly')
    const send = vi.fn()
    useCatanStore.getState().submitMonopoly('brick', send)
    expect(send).toHaveBeenCalledWith({ type: 'playDevCard', card: 'monopoly', resource: 'brick' })
    expect(useCatanStore.getState().devModal).toBeNull()
  })
})
