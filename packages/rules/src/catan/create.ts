import type { PlayerId } from '../state'
import { generateBoard } from './board'
import { BANK_PER_RESOURCE, DEV_DECK_COMPOSITION, PIECE_LIMITS } from './data'
import { shuffle, type Rng } from './rng'
import type { CatanPlayer, CatanState } from './state'
import { emptyResources, type DevCard } from './types'

export interface CatanGameOptions {
  playerCount: 3 | 4
  layout?: 'beginner' | 'random'
  /** Victory-point target override; omit for the standard 10. */
  targetVp?: number
}

export function createCatanGame(options: CatanGameOptions, rng: Rng): CatanState {
  const board = generateBoard(rng, options.layout ?? 'random')
  const deck = shuffle(
    rng,
    (Object.entries(DEV_DECK_COMPOSITION) as [DevCard, number][]).flatMap(([card, n]) =>
      Array.from({ length: n }, () => card),
    ),
  )
  const players: CatanPlayer[] = Array.from({ length: options.playerCount }, () => ({
    resources: emptyResources(),
    devCards: [],
    knightsPlayed: 0,
    roadsLeft: PIECE_LIMITS.roads,
    settlementsLeft: PIECE_LIMITS.settlements,
    citiesLeft: PIECE_LIMITS.cities,
  }))
  return {
    seq: 0,
    playerCount: options.playerCount,
    board,
    players,
    buildings: {},
    roads: {},
    bank: {
      wood: BANK_PER_RESOURCE,
      brick: BANK_PER_RESOURCE,
      sheep: BANK_PER_RESOURCE,
      wheat: BANK_PER_RESOURCE,
      ore: BANK_PER_RESOURCE,
    },
    devDeck: deck,
    turn: {
      current: 0 as PlayerId,
      number: 0,
      phase: 'setup',
      dice: null,
      devPlayed: false,
      setup: { expect: 'settlement', lastSettlement: null },
      pendingDiscards: {},
      robberReturn: null,
      openTrade: null,
    },
    awards: { longestRoad: null, largestArmy: null },
    winner: null,
    ...(options.targetVp !== undefined ? { targetVp: options.targetVp } : {}),
  }
}
