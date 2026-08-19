import type { PlayerId } from '../state'
import { catanError as err, type CatanRuleError } from './intent'
import { bankTradeRate } from './queries'
import type { CatanState } from './state'
import { addResources, subtractResources, type Resource, type ResourceCount } from './types'

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
