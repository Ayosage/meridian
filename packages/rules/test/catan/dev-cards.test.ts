import { describe, expect, it } from 'vitest'
import { edgeId, type CatanState, type DevCard } from '../../src/index'
import { apply, expectError, inMain, setupComplete, withResources } from './helpers'

const DEV_COST = { ore: 1, wheat: 1, sheep: 1 }

/** Test surgery: put a card in a player's hand as if bought on an earlier turn. */
function withCard(state: CatanState, player: number, card: DevCard, boughtOnTurn = 0): CatanState {
  const players = state.players.map((p, i) =>
    i === player ? { ...p, devCards: [...p.devCards, { card, boughtOnTurn }] } : p,
  )
  return { ...state, players }
}

describe('buyDevCard', () => {
  it('pays the cost and draws the top of the deck', () => {
    let state = withResources(inMain(), 0, DEV_COST)
    const top = state.devDeck[0]!
    const deckSize = state.devDeck.length
    state = apply(state, { type: 'buyDevCard', player: 0 })
    expect(state.players[0]!.devCards).toEqual([{ card: top, boughtOnTurn: 1 }])
    expect(state.devDeck).toHaveLength(deckSize - 1)
    expect(state.players[0]!.resources.sheep).toBe(0)
  })

  it('rejects when broke, when the deck is empty, and outside main', () => {
    expectError(inMain(), { type: 'buyDevCard', player: 0 }, 'CANT_AFFORD')
    const state = withResources(inMain(), 0, DEV_COST)
    expectError({ ...state, devDeck: [] }, { type: 'buyDevCard', player: 0 }, 'DECK_EMPTY')
    expectError(withResources(setupComplete(), 0, DEV_COST), { type: 'buyDevCard', player: 0 }, 'BAD_PHASE')
  })

  it('a card bought this turn is not playable until next turn', () => {
    let state = withResources(inMain(), 0, DEV_COST)
    state = apply(state, { type: 'buyDevCard', player: 0 })
    const card = state.players[0]!.devCards[0]!.card
    if (card !== 'vp') {
      const intent =
        card === 'knight'
          ? ({ type: 'playDevCard', player: 0, card } as const)
          : card === 'roadBuilding'
            ? ({ type: 'playDevCard', player: 0, card, edges: [] } as const)
            : card === 'yearOfPlenty'
              ? ({ type: 'playDevCard', player: 0, card, take: ['wood', 'wood'] } as const)
              : ({ type: 'playDevCard', player: 0, card, resource: 'wood' } as const)
      expectError(state, intent, 'NO_CARD')
    }
  })
})

describe('playDevCard', () => {
  it('knight: playable before the roll, moves play into the robber phase and back', () => {
    let state = withCard(setupComplete(), 0, 'knight')
    state = apply(state, { type: 'playDevCard', player: 0, card: 'knight' })
    expect(state.turn.phase).toBe('robber')
    expect(state.turn.robberReturn).toBe('preRoll')
    expect(state.players[0]!.knightsPlayed).toBe(1)
    expect(state.players[0]!.devCards).toHaveLength(0)
    state = apply(state, { type: 'moveRobber', player: 0, hex: { q: 1, r: 0 }, stealFrom: null })
    expect(state.turn.phase).toBe('preRoll')
    // dice still to roll; and no second dev card this turn
    state = withCard(state, 0, 'knight')
    expectError(state, { type: 'playDevCard', player: 0, card: 'knight' }, 'DEV_LIMIT')
  })

  it('vp cards are never played; unplayable cards are NO_CARD', () => {
    const state = withCard(inMain(), 0, 'vp')
    expectError(state, { type: 'playDevCard', player: 0, card: 'monopoly', resource: 'ore' }, 'NO_CARD')
  })

  it('roadBuilding: two free roads, sequential legality', () => {
    let state = withCard(inMain(), 0, 'roadBuilding')
    const e1 = edgeId({ q: 2, r: 0 }, 5)
    const e2 = edgeId({ q: 2, r: 0 }, 4) // only legal once e1 exists
    const roadsBefore = state.players[0]!.roadsLeft
    const handBefore = state.players[0]!.resources
    expectError(state, { type: 'playDevCard', player: 0, card: 'roadBuilding', edges: [e2, e1] }, 'ILLEGAL_PLACEMENT')
    expectError(state, { type: 'playDevCard', player: 0, card: 'roadBuilding', edges: [e1] }, 'BAD_INTENT') // must place 2 while stock allows
    state = apply(state, { type: 'playDevCard', player: 0, card: 'roadBuilding', edges: [e1, e2] })
    expect(state.roads[e1]).toBe(0)
    expect(state.roads[e2]).toBe(0)
    expect(state.players[0]!.roadsLeft).toBe(roadsBefore - 2)
    expect(state.players[0]!.resources).toEqual(handBefore) // free
  })

  it('yearOfPlenty: takes two from the bank, both must exist', () => {
    let state = withCard(inMain(), 0, 'yearOfPlenty')
    state = apply(state, { type: 'playDevCard', player: 0, card: 'yearOfPlenty', take: ['ore', 'ore'] })
    expect(state.players[0]!.resources.ore).toBe(3) // 1 setup + 2
    const drained = { ...withCard(inMain(), 0, 'yearOfPlenty'), bank: { ...state.bank, wood: 1 } }
    expectError(drained, { type: 'playDevCard', player: 0, card: 'yearOfPlenty', take: ['wood', 'wood'] }, 'BANK_SHORT')
  })

  it('monopoly: strips the named resource from every other player', () => {
    let state = withCard(inMain(), 0, 'monopoly')
    state = withResources(state, 1, { wheat: 3 })
    state = withResources(state, 2, { wheat: 2 })
    state = apply(state, { type: 'playDevCard', player: 0, card: 'monopoly', resource: 'wheat' })
    // P1 had 1 setup wheat + 3 = 4; P2 had 2; P3 had 0
    expect(state.players[0]!.resources.wheat).toBe(6)
    expect(state.players[1]!.resources.wheat).toBe(0)
    expect(state.players[2]!.resources.wheat).toBe(0)
  })

  it('non-knight cards are main-phase only', () => {
    const state = withCard(setupComplete(), 0, 'monopoly')
    expectError(state, { type: 'playDevCard', player: 0, card: 'monopoly', resource: 'ore' }, 'BAD_PHASE')
  })
})
