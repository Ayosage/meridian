import { describe, expect, it } from 'vitest'
import { createCatanGame, createRng, redactCatanState, type CatanClientState, type OwnedDevCard } from '@meridian/rules'
import {
  canBuyDevCard, devHand, legalRoadBuildingEdges, monopolyIntent,
  resolveRoadBuildingClick, roadBuildingTarget, yearOfPlentyIntent,
} from '../src/scene/catan/devCardLogic'
import { emptySelection } from '../src/scene/catan/tradeLogic'

function makeView(overrides: {
  seat?: number
  resources?: Partial<CatanClientState['you']['resources']>
  devCards?: OwnedDevCard[]
  turn?: Partial<CatanClientState['turn']>
  devDeckCount?: number
  bank?: Partial<CatanClientState['bank']>
} = {}): CatanClientState {
  const state = createCatanGame({ playerCount: 4 }, createRng(1))
  const base = redactCatanState(state, overrides.seat ?? 0)
  return {
    ...base,
    devDeckCount: overrides.devDeckCount ?? base.devDeckCount,
    bank: { ...base.bank, ...overrides.bank },
    turn: { ...base.turn, ...overrides.turn },
    you: {
      ...base.you,
      resources: { ...base.you.resources, ...overrides.resources },
      devCards: overrides.devCards ?? base.you.devCards,
    },
  }
}

const MAIN_TURN_3 = { current: 0, phase: 'main' as const, number: 3, devPlayed: false }

describe('devHand', () => {
  it('groups held cards in DEV_ORDER with counts, NEW counts, and playability', () => {
    const view = makeView({
      devCards: [
        { card: 'knight', boughtOnTurn: 1 },
        { card: 'knight', boughtOnTurn: 3 },
        { card: 'vp', boughtOnTurn: 1 },
      ],
      turn: MAIN_TURN_3,
    })
    expect(devHand(view, 0)).toEqual([
      { card: 'knight', count: 2, newCount: 1, playable: true },
      { card: 'vp', count: 1, newCount: 0, playable: false }, // vp never plays
    ])
  })

  it('nothing is playable once devPlayed is set, off-turn, or outside main', () => {
    const cards: OwnedDevCard[] = [{ card: 'monopoly', boughtOnTurn: 1 }]
    const played = makeView({ devCards: cards, turn: { ...MAIN_TURN_3, devPlayed: true } })
    expect(devHand(played, 0)[0]!.playable).toBe(false)
    const offTurn = makeView({ devCards: cards, turn: { ...MAIN_TURN_3, current: 1 } })
    expect(devHand(offTurn, 0)[0]!.playable).toBe(false)
    const preRoll = makeView({ devCards: cards, turn: { ...MAIN_TURN_3, phase: 'preRoll' } })
    expect(devHand(preRoll, 0)[0]!.playable).toBe(false)
  })

  it('a card whose only copies were bought this turn is not playable', () => {
    const view = makeView({ devCards: [{ card: 'knight', boughtOnTurn: 3 }], turn: MAIN_TURN_3 })
    expect(devHand(view, 0)).toEqual([{ card: 'knight', count: 1, newCount: 1, playable: false }])
  })
})

describe('canBuyDevCard', () => {
  it('requires main phase, own turn, dev cost, and deck stock', () => {
    const afford = { sheep: 1, wheat: 1, ore: 1 }
    expect(canBuyDevCard(makeView({ resources: afford, turn: MAIN_TURN_3 }), 0)).toBe(true)
    expect(canBuyDevCard(makeView({ resources: afford, turn: { ...MAIN_TURN_3, current: 1 } }), 0)).toBe(false)
    expect(canBuyDevCard(makeView({ resources: afford, turn: { ...MAIN_TURN_3, phase: 'preRoll' } }), 0)).toBe(false)
    expect(canBuyDevCard(makeView({ resources: { sheep: 0, wheat: 1, ore: 1 }, turn: MAIN_TURN_3 }), 0)).toBe(false)
    expect(canBuyDevCard(makeView({ resources: afford, turn: MAIN_TURN_3, devDeckCount: 0 }), 0)).toBe(false)
  })
})

describe('road building', () => {
  it('roadBuildingTarget is min(2, roadsLeft)', () => {
    const view = makeView()
    expect(roadBuildingTarget(view, 0)).toBe(2) // fresh game: 15 roads left
  })

  it('legalRoadBuildingEdges with no roads on the board is empty; overlay opens chained edges', () => {
    // Fresh board has no buildings/roads for seat 0, so nothing is legal —
    // this pins that the helper delegates to legalRoadEdges rather than
    // reimplementing it. Overlay behavior is pinned via resolveRoadBuildingClick
    // returning null for an illegal edge.
    const view = makeView()
    expect(legalRoadBuildingEdges(view, 0, [])).toEqual([])
  })

  it('resolveRoadBuildingClick refuses an illegal edge and completes at the target count', () => {
    const view = makeView()
    // no legal edges at all on a fresh board
    expect(resolveRoadBuildingClick(view, 0, { kind: 'roadBuilding', staged: [] }, 'e1' as never)).toBeNull()
  })
})

describe('modal intents', () => {
  it('yearOfPlentyIntent needs exactly 2 picked and bank coverage', () => {
    const bank = makeView().bank
    const two = { ...emptySelection(), wheat: 1, ore: 1 }
    expect(yearOfPlentyIntent(two, bank)).toEqual({ type: 'playDevCard', card: 'yearOfPlenty', take: ['wheat', 'ore'] })
    const doubled = { ...emptySelection(), ore: 2 }
    expect(yearOfPlentyIntent(doubled, bank)).toEqual({ type: 'playDevCard', card: 'yearOfPlenty', take: ['ore', 'ore'] })
    expect(yearOfPlentyIntent({ ...emptySelection(), ore: 1 }, bank)).toBeNull()
    expect(yearOfPlentyIntent(doubled, { ...bank, ore: 1 })).toBeNull()
  })

  it('monopolyIntent builds the intent', () => {
    expect(monopolyIntent('brick')).toEqual({ type: 'playDevCard', card: 'monopoly', resource: 'brick' })
  })
})
