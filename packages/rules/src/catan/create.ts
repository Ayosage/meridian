import type { PlayerId } from '../state'
import { generateBoard } from './board'
import { BOARD_SIZES, PIECE_LIMITS } from './data'
import { shuffle, type Rng } from './rng'
import type { CatanPlayer, CatanState } from './state'
import { emptyResources, type DevCard } from './types'

export type CatanPlayerCount = 3 | 4 | 5 | 6 | 7 | 8

export function boardRadiusFor(playerCount: CatanPlayerCount): 2 | 3 {
  return playerCount <= 4 ? 2 : 3
}

export interface CatanGameOptions {
  playerCount: CatanPlayerCount
  layout?: 'beginner' | 'random'
  /** Victory-point target override; omit for the standard 10. */
  targetVp?: number
}

export function createCatanGame(options: CatanGameOptions, rng: Rng): CatanState {
  const radius = boardRadiusFor(options.playerCount)
  const size = BOARD_SIZES[radius]
  const board = generateBoard(rng, options.layout ?? 'random', radius)
  const deck = shuffle(
    rng,
    (Object.entries(size.devDeck) as [DevCard, number][]).flatMap(([card, n]) =>
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
      wood: size.bankPerResource,
      brick: size.bankPerResource,
      sheep: size.bankPerResource,
      wheat: size.bankPerResource,
      ore: size.bankPerResource,
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
