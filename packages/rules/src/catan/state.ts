import type { PlayerId } from '../state'
import type { CatanBoard } from './board'
import type { EdgeId, VertexId } from './topology'
import type { DevCard, ResourceCount } from './types'

export type CatanPhase = 'setup' | 'preRoll' | 'discard' | 'robber' | 'main' | 'ended'

export interface Building {
  owner: PlayerId
  kind: 'settlement' | 'city'
}

export interface OwnedDevCard {
  card: DevCard
  boughtOnTurn: number
}

export interface CatanPlayer {
  resources: ResourceCount
  devCards: readonly OwnedDevCard[]
  knightsPlayed: number
  roadsLeft: number
  settlementsLeft: number
  citiesLeft: number
}

export type TradeResponse =
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'counter'; give: Partial<ResourceCount>; get: Partial<ResourceCount> }

export interface TradeOffer {
  give: Partial<ResourceCount>
  get: Partial<ResourceCount>
  responses: Readonly<Record<number, TradeResponse>>
}

export interface TurnState {
  current: PlayerId
  /** 0 during setup; 1 on the first real turn; +1 every endTurn. */
  number: number
  phase: CatanPhase
  dice: readonly [number, number] | null
  devPlayed: boolean
  setup: { expect: 'settlement' | 'road'; lastSettlement: VertexId | null } | null
  pendingDiscards: Readonly<Record<number, number>>
  robberReturn: 'preRoll' | 'main' | null
  openTrade: TradeOffer | null
}

export interface CatanState {
  seq: number
  playerCount: number
  board: CatanBoard
  players: readonly CatanPlayer[]
  buildings: Readonly<Record<VertexId, Building>>
  roads: Readonly<Record<EdgeId, PlayerId>>
  bank: ResourceCount
  /** Secret draw order; drawn from index 0. Server redacts (phase 3). */
  devDeck: readonly DevCard[]
  turn: TurnState
  awards: { longestRoad: PlayerId | null; largestArmy: PlayerId | null }
  winner: PlayerId | null
  /** Victory-point target; absent = the standard VP_TARGET (10). Short matches (E2E) set it lower. */
  targetVp?: number
}
