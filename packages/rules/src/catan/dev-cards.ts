import type { PlayerId } from '../state'
import { COSTS } from './data'
import { catanError as err, type CatanIntent, type CatanRuleError } from './intent'
import { updateLongestRoad } from './longest-road'
import { legalRoadEdges } from './queries'
import { updateLargestArmy } from './score'
import type { CatanState } from './state'
import {
  addResources,
  hasResources,
  subtractResources,
  toResourceCount,
  type ResourceCount,
} from './types'

export function applyBuyDevCard(
  state: CatanState,
  intent: { player: PlayerId },
): CatanState | CatanRuleError {
  if (state.turn.phase !== 'main') return err('BAD_PHASE', 'dev cards are bought in the main phase')
  const me = state.players[intent.player]!
  if (!hasResources(me.resources, COSTS.devCard)) return err('CANT_AFFORD', 'cannot afford a dev card')
  if (state.devDeck.length === 0) return err('DECK_EMPTY', 'the dev deck is exhausted')
  const [card, ...rest] = state.devDeck
  const players = state.players.map((p, i) =>
    i === intent.player
      ? {
          ...p,
          resources: subtractResources(p.resources, COSTS.devCard),
          devCards: [...p.devCards, { card: card!, boughtOnTurn: state.turn.number }],
        }
      : p,
  )
  return { ...state, players, bank: addResources(state.bank, COSTS.devCard), devDeck: rest }
}

type PlayIntent = Extract<CatanIntent, { type: 'playDevCard' }>

export function applyPlayDevCard(state: CatanState, intent: PlayIntent): CatanState | CatanRuleError {
  const phase = state.turn.phase
  const phaseOk = intent.card === 'knight' ? phase === 'preRoll' || phase === 'main' : phase === 'main'
  if (!phaseOk) return err('BAD_PHASE', `${intent.card} cannot be played now`)
  if (state.turn.devPlayed) return err('DEV_LIMIT', 'only one dev card per turn')

  const me = state.players[intent.player]!
  const idx = me.devCards.findIndex((c) => c.card === intent.card && c.boughtOnTurn < state.turn.number)
  if (idx === -1) return err('NO_CARD', `no playable ${intent.card}`)

  const spend = (s: CatanState): CatanState => ({
    ...s,
    players: s.players.map((p, i) =>
      i === intent.player ? { ...p, devCards: p.devCards.filter((_, j) => j !== idx) } : p,
    ),
    turn: { ...s.turn, devPlayed: true },
  })

  switch (intent.card) {
    case 'knight': {
      const spent = spend(state)
      const players = spent.players.map((p, i) =>
        i === intent.player ? { ...p, knightsPlayed: p.knightsPlayed + 1 } : p,
      )
      return updateLargestArmy(
        {
          ...spent,
          players,
          turn: { ...spent.turn, phase: 'robber', robberReturn: phase as 'preRoll' | 'main' },
        },
        intent.player,
      )
    }
    case 'roadBuilding': {
      if (me.roadsLeft === 0) return err('NO_STOCK', 'no road pieces left')
      const required = Math.min(2, me.roadsLeft)
      if (intent.edges.length !== required)
        return err('BAD_INTENT', `road building places exactly ${required} roads`)
      let next = spend(state)
      for (const edge of intent.edges) {
        if (!legalRoadEdges(next, intent.player).includes(edge))
          return err('ILLEGAL_PLACEMENT', `${edge} is not a legal road edge`)
        next = {
          ...next,
          roads: { ...next.roads, [edge]: intent.player },
          players: next.players.map((p, i) =>
            i === intent.player ? { ...p, roadsLeft: p.roadsLeft - 1 } : p,
          ),
        }
      }
      return updateLongestRoad(next)
    }
    case 'yearOfPlenty': {
      const take = toResourceCount(
        intent.take.reduce<Partial<ResourceCount>>((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {}),
      )
      if (!hasResources(state.bank, take)) return err('BANK_SHORT', 'the bank cannot cover that')
      const spent = spend(state)
      return {
        ...spent,
        bank: subtractResources(spent.bank, take),
        players: spent.players.map((p, i) =>
          i === intent.player ? { ...p, resources: addResources(p.resources, take) } : p,
        ),
      }
    }
    case 'monopoly': {
      const spent = spend(state)
      let hauled = 0
      const stripped = spent.players.map((p, i) => {
        if (i === intent.player) return p
        hauled += p.resources[intent.resource]
        return { ...p, resources: { ...p.resources, [intent.resource]: 0 } }
      })
      const players = stripped.map((p, i) =>
        i === intent.player
          ? { ...p, resources: addResources(p.resources, { [intent.resource]: hauled } as Partial<ResourceCount>) }
          : p,
      )
      return { ...spent, players }
    }
  }
}
