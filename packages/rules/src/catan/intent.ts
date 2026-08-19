import type { Coord } from '../coord'
import type { PlayerId } from '../state'
import type { EdgeId, VertexId } from './topology'
import type { Resource, ResourceCount } from './types'

export type CatanIntent =
  | { type: 'placeSetupSettlement'; player: PlayerId; vertex: VertexId }
  | { type: 'placeSetupRoad'; player: PlayerId; edge: EdgeId }
  | { type: 'rollDice'; player: PlayerId }
  | { type: 'discard'; player: PlayerId; resources: Partial<ResourceCount> }
  | { type: 'moveRobber'; player: PlayerId; hex: Coord; stealFrom: PlayerId | null }
  | { type: 'build'; player: PlayerId; piece: 'road' | 'settlement' | 'city'; location: string }
  | { type: 'buyDevCard'; player: PlayerId }
  | { type: 'playDevCard'; player: PlayerId; card: 'knight' }
  | { type: 'playDevCard'; player: PlayerId; card: 'roadBuilding'; edges: readonly EdgeId[] }
  | { type: 'playDevCard'; player: PlayerId; card: 'yearOfPlenty'; take: readonly [Resource, Resource] }
  | { type: 'playDevCard'; player: PlayerId; card: 'monopoly'; resource: Resource }
  | { type: 'offerTrade'; player: PlayerId; give: Partial<ResourceCount>; get: Partial<ResourceCount> }
  | {
      type: 'respondTrade'
      player: PlayerId
      response: 'accept' | 'reject' | { give: Partial<ResourceCount>; get: Partial<ResourceCount> }
    }
  | { type: 'confirmTrade'; player: PlayerId; partner: PlayerId }
  | { type: 'cancelTrade'; player: PlayerId }
  | { type: 'endTurn'; player: PlayerId }

export type CatanErrorCode =
  | 'GAME_OVER'
  | 'NOT_YOUR_TURN'
  | 'BAD_PHASE'
  | 'BAD_INTENT'
  | 'ILLEGAL_PLACEMENT'
  | 'NO_STOCK'
  | 'CANT_AFFORD'
  | 'BANK_SHORT'
  | 'DECK_EMPTY'
  | 'NO_CARD'
  | 'DEV_LIMIT'
  | 'BAD_DISCARD'
  | 'BAD_ROBBER'
  | 'BAD_STEAL'
  | 'NO_TRADE'
  | 'BAD_TRADE'

export interface CatanRuleError {
  error: true
  code: CatanErrorCode
  message: string
}

export function catanError(code: CatanErrorCode, message: string): CatanRuleError {
  return { error: true, code, message }
}
