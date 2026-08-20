import type { PlayerId } from '../state'
import { MIN_LARGEST_ARMY, VP_TARGET } from './data'
import type { CatanState } from './state'

export function victoryPoints(
  state: CatanState,
  player: PlayerId,
  opts: { includeHidden?: boolean } = {},
): number {
  let vp = 0
  for (const b of Object.values(state.buildings)) {
    if (b.owner === player) vp += b.kind === 'city' ? 2 : 1
  }
  if (state.awards.longestRoad === player) vp += 2
  if (state.awards.largestArmy === player) vp += 2
  if (opts.includeHidden) vp += state.players[player]!.devCards.filter((c) => c.card === 'vp').length
  return vp
}

/** Ties keep the holder; the just-played player takes the card only when strictly ahead and >=3. */
export function updateLargestArmy(state: CatanState, justPlayed: PlayerId): CatanState {
  const holder = state.awards.largestArmy
  if (holder === justPlayed) return state
  const count = state.players[justPlayed]!.knightsPlayed
  if (count < MIN_LARGEST_ARMY) return state
  if (holder !== null && count <= state.players[holder]!.knightsPlayed) return state
  return { ...state, awards: { ...state.awards, largestArmy: justPlayed } }
}

/** Wins fire only for the current player (spec §2: "10 VP on their own turn"). */
export function checkWin(state: CatanState): CatanState {
  if (state.turn.phase === 'setup' || state.turn.phase === 'ended') return state
  const p = state.turn.current
  if (victoryPoints(state, p, { includeHidden: true }) >= (state.targetVp ?? VP_TARGET))
    return { ...state, winner: p, turn: { ...state.turn, phase: 'ended' } }
  return state
}
