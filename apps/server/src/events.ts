import {
  coordKey,
  RESOURCES,
  TERRAIN_RESOURCE,
  totalResources,
  type CatanIntent,
  type CatanState,
  type Resource,
  type ResourceCount,
} from '@meridian/rules'
import type { CatanEvent } from '@meridian/protocol'

/**
 * Action-log events (Task 15 design): pure derivation from the apply choke
 * point's (before, intent, after) triple. Where the engine's rng decided the
 * outcome (production, steal), the event reads the HAND DIFF rather than
 * re-simulating. `deriveCatanEvents` yields the full-information event;
 * `redactEventForSeat` strips the secret channels for seats that may not
 * know them — the same fail-closed posture as redactCatanState.
 */

function handDiff(before: ResourceCount, after: ResourceCount): Partial<ResourceCount> {
  const out: Partial<ResourceCount> = {}
  for (const r of RESOURCES) {
    const d = after[r] - before[r]
    if (d !== 0) out[r] = d
  }
  return out
}

/** Positive-only hand delta (what a player gained). */
function gains(before: CatanState, after: CatanState): Record<number, Partial<ResourceCount>> {
  const out: Record<number, Partial<ResourceCount>> = {}
  before.players.forEach((p, i) => {
    const diff = handDiff(p.resources, after.players[i]!.resources)
    if (Object.keys(diff).length > 0) out[i] = diff
  })
  return out
}

export function deriveCatanEvents(
  before: CatanState,
  intent: CatanIntent,
  after: CatanState,
): CatanEvent[] {
  const events: CatanEvent[] = []
  const p = intent.player

  switch (intent.type) {
    case 'rollDice': {
      const dice = after.turn.dice!
      const total = dice[0] + dice[1]
      // Why-nothing context: hexes matching the roll that the robber blocked,
      // and resources denied by the bank-shortage rule (multi-claimant short
      // bank pays nobody) — the two silent payout-eaters players ask about.
      const robbedHexes: Resource[] = []
      if (total !== 7) {
        for (const hex of before.board.hexes) {
          if (hex.token !== total) continue
          if (coordKey(hex.coord) !== before.board.robber) continue
          const res = TERRAIN_RESOURCE[hex.terrain]
          if (res) robbedHexes.push(res)
        }
      }
      events.push({
        kind: 'roll',
        player: p,
        dice,
        total,
        gains: gains(before, after),
        ...(robbedHexes.length > 0 ? { robbed: robbedHexes } : {}),
      })
      break
    }
    case 'discard': {
      const shed = handDiff(after.players[p]!.resources, before.players[p]!.resources)
      events.push({ kind: 'discard', player: p, count: totalResources(shed), resources: shed })
      break
    }
    case 'moveRobber': {
      let stolen: Resource | undefined
      if (intent.stealFrom !== null) {
        const took = handDiff(before.players[p]!.resources, after.players[p]!.resources)
        stolen = (Object.keys(took) as Resource[])[0]
      }
      events.push({ kind: 'robber', player: p, victim: intent.stealFrom, ...(stolen ? { stolen } : {}) })
      break
    }
    case 'playDevCard': {
      if (intent.card === 'knight') events.push({ kind: 'knight', player: p })
      else if (intent.card === 'roadBuilding')
        events.push({ kind: 'roadBuilding', player: p, edges: intent.edges.length })
      else if (intent.card === 'yearOfPlenty')
        events.push({ kind: 'yearOfPlenty', player: p, take: intent.take })
      else {
        // monopoly: per-victim amounts are public by rule — everyone watches the cards move
        const taken: Record<number, number> = {}
        before.players.forEach((pl, i) => {
          if (i === p) return
          const lost = pl.resources[intent.resource] - after.players[i]!.resources[intent.resource]
          if (lost > 0) taken[i] = lost
        })
        events.push({ kind: 'monopoly', player: p, resource: intent.resource, taken })
      }
      break
    }
    case 'buyDevCard':
      events.push({ kind: 'buyDev', player: p })
      break
    case 'build':
      events.push({ kind: 'build', player: p, piece: intent.piece })
      break
    case 'placeSetupSettlement':
      events.push({ kind: 'build', player: p, piece: 'settlement' })
      break
    case 'placeSetupRoad':
      events.push({ kind: 'build', player: p, piece: 'road' })
      break
    case 'bankTrade': {
      const rate = before.players[p]!.resources[intent.give] - after.players[p]!.resources[intent.give]
      events.push({ kind: 'bankTrade', player: p, give: intent.give, giveCount: rate, get: intent.get })
      break
    }
    case 'offerTrade':
      events.push({ kind: 'offer', player: p, give: intent.give, get: intent.get })
      break
    case 'respondTrade':
      events.push({
        kind: 'tradeResponse',
        player: p,
        response: intent.response === 'accept' || intent.response === 'reject' ? intent.response : 'counter',
      })
      break
    case 'confirmTrade': {
      // terms come from the offer the engine just settled (accept -> posted
      // terms; counter -> countered terms) — same dispatch applyConfirmTrade used
      const offer = before.turn.openTrade!
      const response = offer.responses[intent.partner]!
      const gave = response.kind === 'accept' ? offer.give : response.kind === 'counter' ? response.get : offer.give
      const got = response.kind === 'accept' ? offer.get : response.kind === 'counter' ? response.give : offer.get
      events.push({ kind: 'tradeSettled', player: p, partner: intent.partner, gave, got })
      break
    }
    case 'cancelTrade':
      events.push({ kind: 'offerCancelled', player: p })
      break
    case 'endTurn':
      events.push({ kind: 'turnEnded', player: p, turn: before.turn.number })
      break
  }

  if (before.winner === null && after.winner !== null) events.push({ kind: 'win', player: after.winner })
  return events
}

/**
 * Strip the secret channels for seats not allowed to know them: a discard's
 * composition belongs to the discarder alone; a stolen card's identity to
 * thief and victim. Everything else in an event is public information.
 */
export function redactEventForSeat(event: CatanEvent, seat: number): CatanEvent {
  if (event.kind === 'discard' && event.player !== seat) {
    const { resources: _resources, ...rest } = event
    return rest
  }
  if (event.kind === 'robber' && event.player !== seat && event.victim !== seat && event.stolen) {
    const { stolen: _stolen, ...rest } = event
    return rest
  }
  return event
}
