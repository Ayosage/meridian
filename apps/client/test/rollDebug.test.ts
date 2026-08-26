import { describe, expect, it } from 'vitest'
import {
  coordKey,
  createCatanGame,
  createRng,
  redactCatanState,
  topologyFor,
  type CatanClientState,
} from '@meridian/rules'
import type { CatanEvent } from '@meridian/protocol'
import { rollConsoleReport } from '../src/scene/catan/rollDebug'

/**
 * Real beginner board; graft buildings onto a known 6-token hex so demand is
 * exact: one city (2) + one settlement (1) for seat 0, one settlement (1)
 * for seat 1 -> demand 4, claimants 2.
 */
function makeView(bank: number, paid: { seat: number; n: number }[]): {
  view: CatanClientState
  resource: string
  total: number
} {
  const state = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(1))
  const hex = state.board.hexes.find((h) => h.token === 6 && coordKey(h.coord) !== state.board.robber)!
  const verts = topologyFor(state.board).hexVertices[coordKey(hex.coord)]!
  const buildings = {
    [verts[0]!]: { owner: 0, kind: 'city' as const },
    [verts[2]!]: { owner: 0, kind: 'settlement' as const },
    [verts[4]!]: { owner: 1, kind: 'settlement' as const },
  }
  const resource = { forest: 'wood', pasture: 'sheep', fields: 'wheat', hills: 'brick', mountains: 'ore' }[
    hex.terrain as 'forest'
  ]!
  const withPieces = { ...state, buildings, bank: { ...state.bank, [resource]: bank } }
  const view = redactCatanState(withPieces, 0)
  // hand the view a rolled turn
  const rolled: CatanClientState = { ...view, turn: { ...view.turn, dice: [2, 4] as [number, number] } }
  void paid
  return { view: rolled, resource, total: 6 }
}

describe('rollConsoleReport', () => {
  it('reports demand, claimants, and reconstructed pre-roll bank for a paid roll', () => {
    // bank shown post-roll: 10 after paying 4 -> before was 14
    const { view, resource } = makeView(10, [])
    const event: CatanEvent = {
      kind: 'roll',
      player: 2,
      dice: [2, 4],
      total: 6,
      gains: { 0: { [resource]: 3 }, 1: { [resource]: 1 } },
    }
    const report = rollConsoleReport(view, event)!
    const line = report.resources.find((r) => r.resource === resource)!
    expect(line.demand).toBe(4)
    expect(line.claimants).toEqual([0, 1])
    expect(line.perSeatDemand).toEqual({ 0: 3, 1: 1 })
    expect(line.paid).toEqual({ 0: 3, 1: 1 })
    expect(line.bankAfter).toBe(10)
    expect(line.bankBefore).toBe(14)
    expect(line.denied).toBe(false)
    expect(report.summary).toContain('rolled 6')
  })

  it('reports a denial with the demand > stock arithmetic visible', () => {
    // bank 3 with demand 4 from two claimants -> denied, nothing paid
    const { view, resource } = makeView(3, [])
    const event: CatanEvent = {
      kind: 'roll',
      player: 2,
      dice: [2, 4],
      total: 6,
      gains: {},
      denied: [resource as 'wood'],
    }
    const report = rollConsoleReport(view, event)!
    const line = report.resources.find((r) => r.resource === resource)!
    expect(line.demand).toBe(4)
    expect(line.denied).toBe(true)
    expect(line.bankBefore).toBe(3) // nothing paid: before == after
    expect(line.bankAfter).toBe(3)
    expect(report.summary).toContain(`${resource} DENIED`)
    expect(report.summary).toContain('demand 4 > stock 3')
  })

  it('returns null for a 7 (no production)', () => {
    const { view } = makeView(10, [])
    const seven: CatanEvent = { kind: 'roll', player: 2, dice: [3, 4], total: 7, gains: {} }
    expect(rollConsoleReport(view, seven)).toBeNull()
  })

  it('ignores non-roll events', () => {
    const { view } = makeView(10, [])
    expect(rollConsoleReport(view, { kind: 'buyDev', player: 0 })).toBeNull()
  })
})
