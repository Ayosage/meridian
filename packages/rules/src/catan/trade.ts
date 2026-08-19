import type { PlayerId } from '../state'
import { catanError as err, type CatanRuleError } from './intent'
import { bankTradeRate } from './queries'
import type { CatanState, TradeResponse } from './state'
import {
  addResources,
  hasResources,
  subtractResources,
  totalResources,
  type Resource,
  type ResourceCount,
} from './types'

export function applyBankTrade(
  state: CatanState,
  intent: { player: PlayerId; give: Resource; get: Resource },
): CatanState | CatanRuleError {
  if (state.turn.phase !== 'main') return err('BAD_PHASE', 'trading happens in the main phase')
  if (intent.give === intent.get) return err('BAD_TRADE', 'cannot trade a resource for itself')
  const rate = bankTradeRate(state, intent.player, intent.give)
  const me = state.players[intent.player]!
  if (me.resources[intent.give] < rate)
    return err('CANT_AFFORD', `a ${rate}:1 trade needs ${rate} ${intent.give}`)
  if (state.bank[intent.get] < 1) return err('BANK_SHORT', `the bank has no ${intent.get}`)

  const gives = { [intent.give]: rate } as Partial<ResourceCount>
  const gets = { [intent.get]: 1 } as Partial<ResourceCount>
  const players = state.players.map((p, i) =>
    i === intent.player
      ? { ...p, resources: addResources(subtractResources(p.resources, gives), gets) }
      : p,
  )
  const bank = subtractResources(addResources(state.bank, gives), gets)
  return { ...state, players, bank }
}

export function applyOfferTrade(
  state: CatanState,
  intent: { player: PlayerId; give: Partial<ResourceCount>; get: Partial<ResourceCount> },
): CatanState | CatanRuleError {
  if (state.turn.phase !== 'main') return err('BAD_PHASE', 'trading happens in the main phase')
  if (state.turn.openTrade) return err('BAD_TRADE', 'cancel the open offer first')
  if (totalResources(intent.give) === 0 || totalResources(intent.get) === 0)
    return err('BAD_TRADE', 'offers must give and get something')
  if (!hasResources(state.players[intent.player]!.resources, intent.give))
    return err('CANT_AFFORD', 'you do not hold what you are offering')
  return {
    ...state,
    turn: { ...state.turn, openTrade: { give: intent.give, get: intent.get, responses: {} } },
  }
}

export function applyRespondTrade(
  state: CatanState,
  intent: {
    player: PlayerId
    response: 'accept' | 'reject' | { give: Partial<ResourceCount>; get: Partial<ResourceCount> }
  },
): CatanState | CatanRuleError {
  const offer = state.turn.openTrade
  if (state.turn.phase !== 'main' || !offer) return err('NO_TRADE', 'no open trade offer')
  if (intent.player === state.turn.current) return err('BAD_TRADE', 'you cannot respond to your own offer')

  let response: TradeResponse
  if (intent.response === 'accept') {
    response = { kind: 'accept' }
  } else if (intent.response === 'reject') {
    response = { kind: 'reject' }
  } else {
    if (totalResources(intent.response.give) === 0 || totalResources(intent.response.get) === 0)
      return err('BAD_TRADE', 'counters must give and get something')
    if (!hasResources(state.players[intent.player]!.resources, intent.response.give))
      return err('CANT_AFFORD', 'you do not hold what you are countering with')
    response = { kind: 'counter', give: intent.response.give, get: intent.response.get }
  }
  return {
    ...state,
    turn: {
      ...state.turn,
      openTrade: { ...offer, responses: { ...offer.responses, [intent.player]: response } },
    },
  }
}

export function applyConfirmTrade(
  state: CatanState,
  intent: { player: PlayerId; partner: PlayerId },
): CatanState | CatanRuleError {
  const offer = state.turn.openTrade
  if (state.turn.phase !== 'main' || !offer) return err('NO_TRADE', 'no open trade offer')
  const response = offer.responses[intent.partner]
  if (!response || response.kind === 'reject')
    return err('BAD_TRADE', `player ${intent.partner} has not agreed to this trade`)

  // accept -> posted terms; counter -> the countered terms
  const currentGives = response.kind === 'accept' ? offer.give : response.get
  const currentGets = response.kind === 'accept' ? offer.get : response.give
  if (!hasResources(state.players[intent.player]!.resources, currentGives))
    return err('CANT_AFFORD', 'you no longer hold your side of the trade')
  if (!hasResources(state.players[intent.partner]!.resources, currentGets))
    return err('CANT_AFFORD', `player ${intent.partner} no longer holds their side of the trade`)

  const players = state.players.map((p, i) => {
    if (i === intent.player)
      return { ...p, resources: addResources(subtractResources(p.resources, currentGives), currentGets) }
    if (i === intent.partner)
      return { ...p, resources: addResources(subtractResources(p.resources, currentGets), currentGives) }
    return p
  })
  return { ...state, players, turn: { ...state.turn, openTrade: null } }
}

export function applyCancelTrade(
  state: CatanState,
  _intent: { player: PlayerId },
): CatanState | CatanRuleError {
  if (!state.turn.openTrade) return err('NO_TRADE', 'no open trade offer')
  return { ...state, turn: { ...state.turn, openTrade: null } }
}
