import { describe, expect, it } from 'vitest'
import {
  bankTradeRate,
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  redactCatanState,
} from '../../src/index'
import { setupComplete } from './helpers'

describe('queries accept redacted client views', () => {
  it('placement queries give identical answers on state and view', () => {
    const state = setupComplete()
    const view = redactCatanState(state, 0)
    expect(legalRoadEdges(view, 0)).toEqual(legalRoadEdges(state, 0))
    expect(legalSettlementVertices(view, 0)).toEqual(legalSettlementVertices(state, 0))
    expect(legalCityVertices(view, 0)).toEqual(legalCityVertices(state, 0))
    expect(bankTradeRate(view, 0, 'brick')).toBe(bankTradeRate(state, 0, 'brick'))
  })
})
