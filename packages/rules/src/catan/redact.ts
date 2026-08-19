import type { PlayerId } from '../state'
import type { CatanBoard } from './board'
import type { Building, CatanState, OwnedDevCard, TurnState } from './state'
import type { EdgeId, VertexId } from './topology'
import { totalResources, type ResourceCount } from './types'

/** Public per-seat summary — composition of hands never appears. */
export interface CatanPublicPlayer {
  resourceCount: number
  devCardCount: number
  knightsPlayed: number
  roadsLeft: number
  settlementsLeft: number
  citiesLeft: number
}

export interface CatanYou {
  seat: PlayerId
  resources: ResourceCount
  devCards: readonly OwnedDevCard[]
}

/**
 * What one seat is allowed to see (server design spec §2). This is the ONLY
 * shape the server ever sends to a client.
 */
export interface CatanClientState {
  seq: number
  playerCount: number
  board: CatanBoard
  buildings: Readonly<Record<VertexId, Building>>
  roads: Readonly<Record<EdgeId, PlayerId>>
  bank: ResourceCount
  turn: TurnState
  awards: { longestRoad: PlayerId | null; largestArmy: PlayerId | null }
  winner: PlayerId | null
  devDeckCount: number
  players: readonly CatanPublicPlayer[]
  you: CatanYou
  /** VP-card count revealed by the winner; null until the game is won. */
  winnerVpCards: number | null
}

/**
 * Fail-closed by construction (server design spec §8): the view is built
 * field-by-field. NEVER spread `state` or `state.players[i]` here — a future
 * secret field must not leak by default.
 */
export function redactCatanState(state: CatanState, seat: PlayerId): CatanClientState {
  const me = state.players[seat]!
  return {
    seq: state.seq,
    playerCount: state.playerCount,
    board: state.board,
    buildings: state.buildings,
    roads: state.roads,
    bank: state.bank,
    turn: state.turn,
    awards: state.awards,
    winner: state.winner,
    devDeckCount: state.devDeck.length,
    players: state.players.map((p) => ({
      resourceCount: totalResources(p.resources),
      devCardCount: p.devCards.length,
      knightsPlayed: p.knightsPlayed,
      roadsLeft: p.roadsLeft,
      settlementsLeft: p.settlementsLeft,
      citiesLeft: p.citiesLeft,
    })),
    you: { seat, resources: me.resources, devCards: me.devCards },
    winnerVpCards:
      state.winner === null
        ? null
        : state.players[state.winner]!.devCards.filter((c) => c.card === 'vp').length,
  }
}
