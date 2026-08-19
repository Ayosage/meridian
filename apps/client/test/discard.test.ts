import { beforeEach, describe, expect, it } from 'vitest'
import { createCatanGame, createRng, redactCatanState, type CatanClientState, type ResourceCount } from '@meridian/rules'
import {
  decrementDiscardSelection,
  discardIntent,
  discardSelectionTotal,
  incrementDiscardSelection,
  useCatanStore,
  type DiscardSelection,
} from '../src/scene/catan/catanStore'

const EMPTY: DiscardSelection = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }

/** A minimal valid view built from the real engine; `turn`/`you` overridable per test. */
function makeView(overrides: {
  seat?: number
  turn?: Partial<CatanClientState['turn']>
  resources?: ResourceCount
} = {}): CatanClientState {
  const state = createCatanGame({ playerCount: 4 }, createRng(1))
  const base = redactCatanState(state, overrides.seat ?? 0)
  return {
    ...base,
    turn: { ...base.turn, ...overrides.turn },
    you: { ...base.you, resources: overrides.resources ?? base.you.resources },
  }
}

describe('discard selection reducer (pure)', () => {
  const hand: ResourceCount = { wood: 2, brick: 0, sheep: 1, wheat: 3, ore: 0 }

  it('increments a resource below its hand count', () => {
    expect(incrementDiscardSelection(hand, EMPTY, 'wood')).toEqual({ ...EMPTY, wood: 1 })
  })

  it('refuses to increment past the hand count', () => {
    const atCap: DiscardSelection = { ...EMPTY, sheep: 1 }
    expect(incrementDiscardSelection(hand, atCap, 'sheep')).toBe(atCap) // unchanged (same ref)
  })

  it('refuses to increment a resource the hand has none of', () => {
    expect(incrementDiscardSelection(hand, EMPTY, 'brick')).toBe(EMPTY)
  })

  it('decrements a positive count', () => {
    const selection: DiscardSelection = { ...EMPTY, wheat: 2 }
    expect(decrementDiscardSelection(selection, 'wheat')).toEqual({ ...EMPTY, wheat: 1 })
  })

  it('refuses to decrement below zero', () => {
    expect(decrementDiscardSelection(EMPTY, 'wheat')).toBe(EMPTY)
  })

  it('discardSelectionTotal sums all resources', () => {
    const selection: DiscardSelection = { wood: 1, brick: 0, sheep: 2, wheat: 1, ore: 0 }
    expect(discardSelectionTotal(selection)).toBe(4)
  })

  it('discardIntent omits zero counts (protocol requires positive-only)', () => {
    const selection: DiscardSelection = { wood: 1, brick: 0, sheep: 2, wheat: 0, ore: 0 }
    expect(discardIntent(selection)).toEqual({ type: 'discard', resources: { wood: 1, sheep: 2 } })
  })

  it('discardIntent with an all-zero selection sends an empty resource map', () => {
    expect(discardIntent(EMPTY)).toEqual({ type: 'discard', resources: {} })
  })
})

describe('store discard flow (mode transitions + injected send spy)', () => {
  beforeEach(() => {
    useCatanStore.getState().reset()
  })

  it('entering discard mode owes the seat its pendingDiscards count', () => {
    const view = makeView({ turn: { pendingDiscards: { 0: 4 }, phase: 'discard' }, resources: { wood: 3, brick: 2, sheep: 2, wheat: 2, ore: 0 } })
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    expect(useCatanStore.getState().mode).toEqual({ kind: 'discard' })
    expect(useCatanStore.getState().discardSelection).toEqual(EMPTY)
  })

  it('increment is capped at the hand count for that resource', () => {
    const view = makeView({ turn: { pendingDiscards: { 0: 1 }, phase: 'discard' }, resources: { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 } })
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })

    useCatanStore.getState().incrementDiscard('wood')
    expect(useCatanStore.getState().discardSelection.wood).toBe(1)
    useCatanStore.getState().incrementDiscard('wood') // hand only has 1
    expect(useCatanStore.getState().discardSelection.wood).toBe(1)

    useCatanStore.getState().incrementDiscard('brick') // hand has 0
    expect(useCatanStore.getState().discardSelection.brick).toBe(0)
  })

  it('decrement never goes below zero', () => {
    useCatanStore.getState().decrementDiscard('wood')
    expect(useCatanStore.getState().discardSelection.wood).toBe(0)
  })

  it('submitDiscard is a no-op below the owed total', () => {
    const sent: unknown[] = []
    const view = makeView({ turn: { pendingDiscards: { 0: 2 }, phase: 'discard' }, resources: { wood: 2, brick: 0, sheep: 0, wheat: 0, ore: 0 } })
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    useCatanStore.getState().incrementDiscard('wood')

    useCatanStore.getState().submitDiscard((intent) => sent.push(intent))

    expect(sent).toEqual([])
    expect(useCatanStore.getState().discardSelection.wood).toBe(1) // untouched
  })

  it('submitDiscard is a no-op above the owed total', () => {
    // exact-N gate: even an over-selection (which the incrementer alone
    // can't produce, since it's capped by hand count, not owed) must not send
    const sent: unknown[] = []
    const view = makeView({ turn: { pendingDiscards: { 0: 1 }, phase: 'discard' }, resources: { wood: 2, brick: 0, sheep: 0, wheat: 0, ore: 0 } })
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    useCatanStore.getState().incrementDiscard('wood')
    useCatanStore.getState().incrementDiscard('wood')
    expect(discardSelectionTotal(useCatanStore.getState().discardSelection)).toBe(2)

    useCatanStore.getState().submitDiscard((intent) => sent.push(intent))

    expect(sent).toEqual([])
  })

  it('submitDiscard sends exactly at the owed total and clears the selection', () => {
    const sent: unknown[] = []
    const view = makeView({ turn: { pendingDiscards: { 0: 2 }, phase: 'discard' }, resources: { wood: 1, brick: 0, sheep: 1, wheat: 0, ore: 0 } })
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    useCatanStore.getState().incrementDiscard('wood')
    useCatanStore.getState().incrementDiscard('sheep')

    useCatanStore.getState().submitDiscard((intent) => sent.push(intent))

    expect(sent).toEqual([{ type: 'discard', resources: { wood: 1, sheep: 1 } }])
    expect(useCatanStore.getState().discardSelection).toEqual(EMPTY)
  })

  it('a selection in progress survives an unrelated snapshot while still in discard mode', () => {
    const view = makeView({ turn: { pendingDiscards: { 0: 2 }, phase: 'discard' }, resources: { wood: 2, brick: 0, sheep: 0, wheat: 0, ore: 0 } })
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    useCatanStore.getState().incrementDiscard('wood')
    expect(useCatanStore.getState().discardSelection.wood).toBe(1)

    // another seat's discard prompts a new snapshot; we're still owed 2 ourselves
    useCatanStore.getState().ingestSnapshot({ seq: 2, view: { ...view, seq: 2 } })

    expect(useCatanStore.getState().mode).toEqual({ kind: 'discard' })
    expect(useCatanStore.getState().discardSelection.wood).toBe(1) // preserved, not reset
  })

  it('the selection resets on freshly entering discard mode again after resolving', () => {
    const owedView = makeView({ turn: { pendingDiscards: { 0: 2 }, phase: 'discard' }, resources: { wood: 2, brick: 0, sheep: 0, wheat: 0, ore: 0 } })
    useCatanStore.getState().setSeat(0)
    useCatanStore.getState().ingestSnapshot({ seq: 1, view: owedView })
    useCatanStore.getState().incrementDiscard('wood')

    // resolved: pendingDiscards clears, mode falls back to idle (main phase, not our turn)
    const resolvedView = makeView({ turn: { pendingDiscards: {}, phase: 'main', current: 1 } })
    useCatanStore.getState().ingestSnapshot({ seq: 2, view: { ...resolvedView, seq: 2 } })
    expect(useCatanStore.getState().mode).toEqual({ kind: 'idle' })

    // forced into discard again later (e.g. next 7 roll)
    const owedAgain = makeView({ turn: { pendingDiscards: { 0: 3 }, phase: 'discard' }, resources: { wood: 3, brick: 0, sheep: 0, wheat: 0, ore: 0 } })
    useCatanStore.getState().ingestSnapshot({ seq: 3, view: { ...owedAgain, seq: 3 } })

    expect(useCatanStore.getState().mode).toEqual({ kind: 'discard' })
    expect(useCatanStore.getState().discardSelection).toEqual(EMPTY)
  })
})

describe('store steal flow (clickStealVictim)', () => {
  beforeEach(() => {
    useCatanStore.getState().reset()
  })

  it('sends moveRobber with the chosen victim as stealFrom', () => {
    const sent: unknown[] = []
    useCatanStore.getState().setMode({ kind: 'steal', hex: { q: 0, r: 0 }, victims: [1, 2] })

    useCatanStore.getState().clickStealVictim(2, (intent) => sent.push(intent))

    expect(sent).toEqual([{ type: 'moveRobber', hex: { q: 0, r: 0 }, stealFrom: 2 }])
  })

  it('is a no-op for a seat not listed as a victim', () => {
    const sent: unknown[] = []
    useCatanStore.getState().setMode({ kind: 'steal', hex: { q: 0, r: 0 }, victims: [1] })

    useCatanStore.getState().clickStealVictim(3, (intent) => sent.push(intent))

    expect(sent).toEqual([])
  })

  it('is a no-op outside steal mode', () => {
    const sent: unknown[] = []
    useCatanStore.getState().setMode({ kind: 'robber' })

    useCatanStore.getState().clickStealVictim(1, (intent) => sent.push(intent))

    expect(sent).toEqual([])
  })
})
