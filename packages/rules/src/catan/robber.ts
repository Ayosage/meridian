import { coordKey, type Coord } from '../coord'
import type { PlayerId } from '../state'
import { catanError as err, type CatanRuleError } from './intent'
import { pick, type Rng } from './rng'
import type { CatanState } from './state'
import { topologyFor } from './topology'
import {
  addResources,
  hasResources,
  RESOURCES,
  subtractResources,
  totalResources,
  type ResourceCount,
} from './types'

export function applyDiscard(
  state: CatanState,
  intent: { player: PlayerId; resources: Partial<ResourceCount> },
): CatanState | CatanRuleError {
  if (state.turn.phase !== 'discard') return err('BAD_PHASE', 'no discards are pending')
  const owed = state.turn.pendingDiscards[intent.player]
  if (!owed) return err('BAD_DISCARD', 'you have nothing to discard')
  if (totalResources(intent.resources) !== owed)
    return err('BAD_DISCARD', `you must discard exactly ${owed} cards`)
  const hand = state.players[intent.player]!.resources
  if (!hasResources(hand, intent.resources)) return err('BAD_DISCARD', 'you do not hold those cards')

  const players = state.players.map((p, i) =>
    i === intent.player ? { ...p, resources: subtractResources(p.resources, intent.resources) } : p,
  )
  const pendingDiscards: Record<number, number> = { ...state.turn.pendingDiscards }
  delete pendingDiscards[intent.player]
  const done = Object.keys(pendingDiscards).length === 0
  return {
    ...state,
    players,
    bank: addResources(state.bank, intent.resources),
    turn: { ...state.turn, pendingDiscards, phase: done ? 'robber' : 'discard' },
  }
}

export function applyMoveRobber(
  state: CatanState,
  intent: { player: PlayerId; hex: Coord; stealFrom: PlayerId | null },
  rng: Rng,
): CatanState | CatanRuleError {
  if (state.turn.phase !== 'robber') return err('BAD_PHASE', 'the robber does not move now')
  const key = coordKey(intent.hex)
  if (!state.board.hexes.some((h) => coordKey(h.coord) === key))
    return err('BAD_ROBBER', `${key} is not a board hex`)
  if (key === state.board.robber) return err('BAD_ROBBER', 'the robber must move to a new hex')

  const topo = topologyFor(state.board)
  const victims = state.players
    .map((_, i) => i)
    .filter(
      (i) =>
        i !== intent.player &&
        totalResources(state.players[i]!.resources) > 0 &&
        (topo.hexVertices[key] ?? []).some((v) => state.buildings[v]?.owner === i),
    )

  let players = state.players
  if (intent.stealFrom === null) {
    if (victims.length > 0) return err('BAD_STEAL', 'you must steal from an adjacent player')
  } else {
    if (!victims.includes(intent.stealFrom))
      return err('BAD_STEAL', `player ${intent.stealFrom} cannot be robbed on that hex`)
    const hand = state.players[intent.stealFrom]!.resources
    const cards = RESOURCES.flatMap((r) => Array.from({ length: hand[r] }, () => r))
    const stolen = pick(rng, cards)
    const delta = { [stolen]: 1 } as Partial<ResourceCount>
    players = state.players.map((p, i) => {
      if (i === intent.stealFrom) return { ...p, resources: subtractResources(p.resources, delta) }
      if (i === intent.player) return { ...p, resources: addResources(p.resources, delta) }
      return p
    })
  }

  return {
    ...state,
    players,
    board: { ...state.board, robber: key },
    turn: { ...state.turn, phase: state.turn.robberReturn ?? 'main', robberReturn: null },
  }
}
