import { describe, expect, it } from 'vitest'
import {
  affordable,
  applyCatanIntent,
  botIntent,
  coordKey,
  createCatanGame,
  createRng,
  isCatanRuleError,
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  RESOURCES,
  standardTopology,
  totalResources,
  victoryPoints,
  type CatanIntent,
  type CatanState,
  type Rng,
} from '../../src/index'

const MAX_INTENTS = 5000
const SEEDS = [1, 2, 3, 4, 5]

function assertInvariants(state: CatanState): void {
  for (const r of RESOURCES) {
    const total = state.bank[r] + state.players.reduce((s, p) => s + p.resources[r], 0)
    expect(total).toBe(19)
    expect(state.bank[r]).toBeGreaterThanOrEqual(0)
    for (const p of state.players) expect(p.resources[r]).toBeGreaterThanOrEqual(0)
  }
  for (const p of state.players) {
    expect(p.roadsLeft).toBeGreaterThanOrEqual(0)
    expect(p.settlementsLeft).toBeGreaterThanOrEqual(0)
    expect(p.citiesLeft).toBeGreaterThanOrEqual(0)
  }
  const devTotal =
    state.devDeck.length +
    state.players.reduce((s, p) => s + p.devCards.length, 0) +
    state.players.reduce((s, p) => s + p.knightsPlayed, 0)
  expect(devTotal).toBeLessThanOrEqual(25) // played non-knights leave the game; knights are tracked
}



function playGame(seed: number): CatanState {
  const rng: Rng = createRng(seed)
  let state = createCatanGame({ playerCount: 4, layout: 'random' }, rng)
  let prevSeq = state.seq
  for (let i = 0; i < MAX_INTENTS && state.winner === null; i++) {
    const intent = botIntent(state)
    const result = applyCatanIntent(state, intent, rng)
    if (isCatanRuleError(result))
      throw new Error(`bot generated illegal ${intent.type}: ${result.code} ${result.message}`)
    expect(result.seq).toBe(prevSeq + 1)
    prevSeq = result.seq
    assertInvariants(result)
    state = result
  }
  return state
}

describe('full seeded 4-player games', () => {
  it('bots play complete legal games; at least one seed reaches a 10-VP win', () => {
    let wins = 0
    for (const seed of SEEDS) {
      const state = playGame(seed)
      if (state.winner !== null) {
        wins++
        expect(state.turn.phase).toBe('ended')
        expect(victoryPoints(state, state.winner, { includeHidden: true })).toBeGreaterThanOrEqual(10)
        expect(victoryPoints(state, state.winner, { includeHidden: true })).toBeLessThanOrEqual(12) // sanity: no runaway scoring
      }
    }
    expect(wins).toBeGreaterThanOrEqual(1)
  })

  it('the same seed replays to the identical final state', () => {
    const a = playGame(SEEDS[0]!)
    const b = playGame(SEEDS[0]!)
    expect(a).toEqual(b)
  })
})
