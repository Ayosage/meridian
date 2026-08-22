import type { CatanClientState } from '@meridian/rules'

/**
 * Public VP for one seat, computed straight from the redacted view: hidden
 * VP dev cards never appear here by construction (CatanClientState doesn't
 * carry other seats' dev cards) — this is deliberately the *public* subset
 * of `@meridian/rules`' `victoryPoints`, not a reimplementation of it: that
 * helper is typed over the full `CatanState` (server-side, with real
 * `players[].devCards`), which a `CatanClientState` view doesn't structurally
 * match, so it can't be called here.
 */
export function publicVictoryPoints(view: CatanClientState, seat: number): number {
  let vp = 0
  for (const b of Object.values(view.buildings)) {
    if (b.owner === seat) vp += b.kind === 'city' ? 2 : 1
  }
  if (view.awards.longestRoad === seat) vp += 2
  if (view.awards.largestArmy === seat) vp += 2
  return vp
}

export interface PlayerCardModel {
  seat: number
  isYou: boolean
  /** Public VP for opponents; TRUE VP (hidden VP dev cards included) for you. */
  vp: number
  resourceCount: number
  devCardCount: number
  knightsPlayed: number
  autopilot: boolean
}

/**
 * One card per seat, in seat order, for the HUD player strip. The local
 * seat's card may show more than the public view: it's the self view, so
 * its VP includes the hidden VP dev cards from `view.you.devCards`.
 */
export function playerCards(
  view: CatanClientState,
  seat: number | null,
  connected: readonly boolean[],
): PlayerCardModel[] {
  return view.players.map((p, i) => {
    const isYou = i === seat
    let vp = publicVictoryPoints(view, i)
    if (isYou) vp += view.you.devCards.filter((d) => d.card === 'vp').length
    return {
      seat: i,
      isYou,
      vp,
      resourceCount: p.resourceCount,
      devCardCount: p.devCardCount,
      knightsPlayed: p.knightsPlayed,
      autopilot: connected[i] === false,
    }
  })
}
