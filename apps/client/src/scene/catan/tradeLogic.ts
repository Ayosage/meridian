import type { CatanClientIntent } from '@meridian/protocol'
import {
  bankTradeRate, RESOURCES,
  type CatanClientState, type Resource, type ResourceCount,
} from '@meridian/rules'

/** Per-resource staged counts for a trade side; always fully populated. */
export type ResourceSelection = Record<Resource, number>

export function emptySelection(): ResourceSelection {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }
}

export function selectionTotal(sel: ResourceSelection): number {
  return RESOURCES.reduce((sum, r) => sum + sel[r], 0)
}

export function incrementSelection(sel: ResourceSelection, r: Resource, cap = Infinity): ResourceSelection {
  if (sel[r] >= cap) return sel
  return { ...sel, [r]: sel[r] + 1 }
}

export function decrementSelection(sel: ResourceSelection, r: Resource): ResourceSelection {
  if (sel[r] <= 0) return sel
  return { ...sel, [r]: sel[r] - 1 }
}

/** Protocol resource maps carry positive counts only — strip zeros. */
export function selectionToPartial(sel: ResourceSelection): Partial<ResourceCount> {
  const out: Partial<ResourceCount> = {}
  for (const r of RESOURCES) if (sel[r] > 0) out[r] = sel[r]
  return out
}

export function offerTradeIntent(give: ResourceSelection, get: ResourceSelection): CatanClientIntent | null {
  if (selectionTotal(give) === 0 || selectionTotal(get) === 0) return null
  return { type: 'offerTrade', give: selectionToPartial(give), get: selectionToPartial(get) }
}

/** `give` = what the responder hands over (mirrors the engine's respondTrade counter shape). */
export function counterTradeIntent(give: ResourceSelection, get: ResourceSelection): CatanClientIntent | null {
  if (selectionTotal(give) === 0 || selectionTotal(get) === 0) return null
  return { type: 'respondTrade', response: { give: selectionToPartial(give), get: selectionToPartial(get) } }
}

export function bankRates(view: CatanClientState, seat: number): Record<Resource, 4 | 3 | 2> {
  const out = {} as Record<Resource, 4 | 3 | 2>
  for (const r of RESOURCES) out[r] = bankTradeRate(view, seat, r)
  return out
}

export function bankTradeIntent(
  view: CatanClientState,
  seat: number,
  give: Resource | null,
  get: Resource | null,
): CatanClientIntent | null {
  if (give === null || get === null || give === get) return null
  if (view.you.resources[give] < bankTradeRate(view, seat, give)) return null
  if (view.bank[get] < 1) return null
  return { type: 'bankTrade', give, get }
}

/** The open offer as one responder seat sees it, or null if this seat isn't a responder. */
export interface IncomingOfferView {
  from: number
  youReceive: Partial<ResourceCount>
  youGive: Partial<ResourceCount>
  responded: boolean
}

export function incomingOfferFor(view: CatanClientState, seat: number): IncomingOfferView | null {
  const offer = view.turn.openTrade
  if (!offer || view.turn.current === seat) return null
  return {
    from: view.turn.current,
    youReceive: offer.give,
    youGive: offer.get,
    responded: offer.responses[seat] !== undefined,
  }
}

export type ResponseSummary = { seat: number } & (
  | { kind: 'waiting' }
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'counter'; youGive: Partial<ResourceCount>; youGet: Partial<ResourceCount> }
)

/**
 * Pure: should the mute-toggle auto-decline effect fire right now? Muted,
 * offer unanswered, and not already pending a decline we sent — that last
 * guard is what stops a spam of rejects while our own `respondTrade` is
 * still in flight to the server (before a snapshot round-trip records it in
 * `responses`); see `autoDeclineIfMuted` in catanStore.ts.
 */
export function shouldAutoDecline(
  view: CatanClientState,
  seat: number,
  muted: boolean,
  declinePending: boolean,
): boolean {
  if (!muted || declinePending) return false
  const offer = incomingOfferFor(view, seat)
  return offer !== null && !offer.responded
}

/** Pure: should IncomingOffer's banner render? Never while muted — those offers auto-decline silently. */
export function shouldShowOfferBanner(view: CatanClientState, seat: number, muted: boolean): boolean {
  return !muted && incomingOfferFor(view, seat) !== null
}

/** Per-opponent response status as the offerer sees it, or null if this seat isn't the offerer. */
export function offerResponsesFor(view: CatanClientState, seat: number): ResponseSummary[] | null {
  const offer = view.turn.openTrade
  if (!offer || view.turn.current !== seat) return null
  const out: ResponseSummary[] = []
  for (let s = 0; s < view.playerCount; s++) {
    if (s === seat) continue
    const r = offer.responses[s]
    if (!r) out.push({ seat: s, kind: 'waiting' })
    else if (r.kind === 'accept') out.push({ seat: s, kind: 'accept' })
    else if (r.kind === 'reject') out.push({ seat: s, kind: 'reject' })
    // applyConfirmTrade: on a counter the offerer gives response.get and gets response.give.
    else out.push({ seat: s, kind: 'counter', youGive: r.get, youGet: r.give })
  }
  return out
}
