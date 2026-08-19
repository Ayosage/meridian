import { beforeEach, describe, expect, it } from 'vitest'
import { createCatanGame, createRng, redactCatanState, type CatanClientState } from '@meridian/rules'
import { deriveMode, useCatanStore, type Mode } from '../src/scene/catan/catanStore'

/** A minimal valid view built from the real engine; `turn`/`seq`/`winner` overridable per test. */
function makeView(overrides: {
  seq?: number
  seat?: number
  turn?: Partial<CatanClientState['turn']>
  winner?: number | null
} = {}): CatanClientState {
  const state = createCatanGame({ playerCount: 4 }, createRng(1))
  const base = redactCatanState(state, overrides.seat ?? 0)
  return {
    ...base,
    seq: overrides.seq ?? base.seq,
    winner: overrides.winner === undefined ? base.winner : overrides.winner,
    turn: { ...base.turn, ...overrides.turn },
  }
}

const IDLE: Mode = { kind: 'idle' }

describe('deriveMode (pure)', () => {
  it('forces placeSettlement when setup expects a settlement on our turn', () => {
    const view = makeView({ turn: { current: 0, phase: 'setup', setup: { expect: 'settlement', lastSettlement: null } } })
    expect(deriveMode(view, 0, IDLE)).toEqual({ kind: 'placeSettlement' })
  })

  it('forces placeRoad when setup expects a road on our turn', () => {
    const view = makeView({ turn: { current: 0, phase: 'setup', setup: { expect: 'road', lastSettlement: 'v' } } })
    expect(deriveMode(view, 0, IDLE)).toEqual({ kind: 'placeRoad' })
  })

  it('does not force setup placement for a seat that is not the current turn', () => {
    const view = makeView({ turn: { current: 1, phase: 'setup', setup: { expect: 'settlement', lastSettlement: null } } })
    expect(deriveMode(view, 0, IDLE)).toEqual(IDLE)
  })

  it('forces discard when the seat has pending discards, regardless of whose turn it is', () => {
    const view = makeView({ turn: { current: 2, phase: 'discard', pendingDiscards: { 0: 3 } } })
    expect(deriveMode(view, 0, IDLE)).toEqual({ kind: 'discard' })
  })

  it('forces robber when it is our robber phase', () => {
    const view = makeView({ turn: { current: 0, phase: 'robber' } })
    expect(deriveMode(view, 0, IDLE)).toEqual({ kind: 'robber' })
  })

  it('does not force robber for a seat that is not the mover', () => {
    const view = makeView({ turn: { current: 1, phase: 'robber' } })
    expect(deriveMode(view, 0, IDLE)).toEqual(IDLE)
  })

  it('preserves an in-progress steal selection across re-derivation during robber phase', () => {
    const view = makeView({ turn: { current: 0, phase: 'robber' } })
    const steal: Mode = { kind: 'steal', hex: { q: 0, r: 0 }, victims: [1, 2] }
    expect(deriveMode(view, 0, steal)).toEqual(steal)
  })

  it('drops a stale discard/robber/steal mode once nothing forces it anymore', () => {
    const view = makeView({ turn: { current: 1, phase: 'main', pendingDiscards: {} } })
    expect(deriveMode(view, 0, { kind: 'discard' })).toEqual(IDLE)
    expect(deriveMode(view, 0, { kind: 'robber' })).toEqual(IDLE)
    expect(deriveMode(view, 0, { kind: 'steal', hex: { q: 0, r: 0 }, victims: [1] })).toEqual(IDLE)
  })

  it('preserves a voluntary placement mode across unrelated snapshots', () => {
    const view = makeView({ turn: { current: 1, phase: 'main' } })
    expect(deriveMode(view, 0, { kind: 'placeRoad' })).toEqual({ kind: 'placeRoad' })
  })

  it('returns the current mode unchanged when seat is null', () => {
    const view = makeView()
    expect(deriveMode(view, null, { kind: 'placeCity' })).toEqual({ kind: 'placeCity' })
  })
})

describe('useCatanStore', () => {
  beforeEach(() => {
    useCatanStore.getState().reset()
  })

  it('ingestSnapshot accepts the first snapshot regardless of seq', () => {
    const view = makeView({ seq: 5 })
    useCatanStore.getState().ingestSnapshot({ seq: 5, view })
    expect(useCatanStore.getState().view?.seq).toBe(5)
    expect(useCatanStore.getState().status).toBe('playing')
  })

  it('ingestSnapshot drops a snapshot whose seq did not advance', () => {
    const first = makeView({ seq: 5 })
    useCatanStore.getState().ingestSnapshot({ seq: 5, view: first })

    const stale = makeView({ seq: 5 })
    useCatanStore.getState().ingestSnapshot({ seq: 5, view: stale })
    expect(useCatanStore.getState().view).toBe(first)

    const older = makeView({ seq: 4 })
    useCatanStore.getState().ingestSnapshot({ seq: 4, view: older })
    expect(useCatanStore.getState().view).toBe(first)
  })

  it('ingestSnapshot replaces the view when seq advances', () => {
    useCatanStore.getState().ingestSnapshot({ seq: 5, view: makeView({ seq: 5 }) })
    const next = makeView({ seq: 6 })
    useCatanStore.getState().ingestSnapshot({ seq: 6, view: next })
    expect(useCatanStore.getState().view).toBe(next)
  })

  it('ingestSnapshot forces placeSettlement mode from our setup turn', () => {
    useCatanStore.getState().setSeat(0)
    const view = makeView({
      seq: 1,
      turn: { current: 0, phase: 'setup', setup: { expect: 'settlement', lastSettlement: null } },
    })
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    expect(useCatanStore.getState().mode).toEqual({ kind: 'placeSettlement' })
  })

  it('ingestSnapshot forces discard mode from our pending discard', () => {
    useCatanStore.getState().setSeat(2)
    const view = makeView({ seq: 1, seat: 2, turn: { phase: 'discard', pendingDiscards: { 2: 4 } } })
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    expect(useCatanStore.getState().mode).toEqual({ kind: 'discard' })
  })

  it('ingestSnapshot forces robber mode when it is our robber phase', () => {
    useCatanStore.getState().setSeat(1)
    const view = makeView({ seq: 1, seat: 1, turn: { current: 1, phase: 'robber' } })
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    expect(useCatanStore.getState().mode).toEqual({ kind: 'robber' })
  })

  it('ingestSnapshot marks status ended once the view reports a winner', () => {
    useCatanStore.getState().ingestSnapshot({ seq: 1, view: makeView({ seq: 1, winner: 0 }) })
    expect(useCatanStore.getState().status).toBe('ended')
  })

  it('ruleError resets a voluntary placement mode to idle', () => {
    useCatanStore.getState().setMode({ kind: 'placeRoad' })
    useCatanStore.getState().ruleError('ILLEGAL_ROAD: not connected')
    const s = useCatanStore.getState()
    expect(s.mode).toEqual(IDLE)
    expect(s.toast).toContain('ILLEGAL_ROAD')
  })

  it('ruleError does NOT reset a forced mode', () => {
    useCatanStore.getState().setSeat(0)
    const view = makeView({ seq: 1, turn: { current: 0, phase: 'robber' } })
    useCatanStore.getState().ingestSnapshot({ seq: 1, view })
    expect(useCatanStore.getState().mode).toEqual({ kind: 'robber' })

    useCatanStore.getState().ruleError('BAD_ROBBER: hex has no adjacent players')
    const s = useCatanStore.getState()
    expect(s.mode).toEqual({ kind: 'robber' })
    expect(s.toast).toContain('BAD_ROBBER')
  })

  it('ruleError leaves a non-placement idle mode toast-only', () => {
    useCatanStore.getState().ruleError('NOT_PLAYING: match is not in progress')
    expect(useCatanStore.getState().mode).toEqual(IDLE)
    expect(useCatanStore.getState().toast).toContain('NOT_PLAYING')
  })

  it('setWinner marks status ended and records the result', () => {
    useCatanStore.getState().setWinner({ reason: 'win', winner: 3 })
    const s = useCatanStore.getState()
    expect(s.status).toBe('ended')
    expect(s.winner).toEqual({ reason: 'win', winner: 3 })
  })

  it('reset returns to the idle baseline', () => {
    useCatanStore.getState().setSeat(2)
    useCatanStore.getState().setMode({ kind: 'placeCity' })
    useCatanStore.getState().reset()
    const s = useCatanStore.getState()
    expect(s.seat).toBeNull()
    expect(s.mode).toEqual(IDLE)
    expect(s.status).toBe('idle')
  })
})
