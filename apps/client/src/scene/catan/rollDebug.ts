import {
  coordKey,
  RESOURCES,
  TERRAIN_RESOURCE,
  topologyFor,
  type CatanClientState,
  type Resource,
} from '@meridian/rules'
import type { CatanEvent } from '@meridian/protocol'

/**
 * Console-side verification report for a production roll (user request after
 * a bank-shortage denial looked wrong from the UI alone): recomputes demand
 * per resource from the visible board + buildings, reconstructs the pre-roll
 * bank from the post-roll bank plus what the event says was paid, and spells
 * out the denial arithmetic. Pure — logged by the store, unit-tested here.
 */
export interface RollResourceReport {
  resource: Resource
  demand: number
  perSeatDemand: Record<number, number>
  claimants: number[]
  paid: Record<number, number>
  bankBefore: number
  bankAfter: number
  denied: boolean
}

export interface RollReport {
  summary: string
  roll: number
  dice: readonly [number, number]
  resources: RollResourceReport[]
}

export function rollConsoleReport(view: CatanClientState, event: CatanEvent): RollReport | null {
  if (event.kind !== 'roll' || event.total === 7) return null
  const topo = topologyFor(view.board)

  // Gross demand from the board the client can see (robber-blocked hexes skipped).
  const perSeat: Record<Resource, Record<number, number>> = {
    wood: {}, brick: {}, sheep: {}, wheat: {}, ore: {},
  }
  for (const hex of view.board.hexes) {
    if (hex.token !== event.total) continue
    const key = coordKey(hex.coord)
    if (key === view.board.robber) continue
    const res = TERRAIN_RESOURCE[hex.terrain]
    if (!res) continue
    for (const v of topo.hexVertices[key] ?? []) {
      const b = view.buildings[v]
      if (b) perSeat[res][b.owner] = (perSeat[res][b.owner] ?? 0) + (b.kind === 'city' ? 2 : 1)
    }
  }

  const resources: RollResourceReport[] = []
  for (const res of RESOURCES) {
    const seatDemand = perSeat[res]
    const demand = Object.values(seatDemand).reduce((a, b) => a + b, 0)
    if (demand === 0) continue
    const paid: Record<number, number> = {}
    for (const [seat, gain] of Object.entries(event.gains)) {
      const n = gain[res]
      if (n) paid[Number(seat)] = n
    }
    const paidTotal = Object.values(paid).reduce((a, b) => a + b, 0)
    resources.push({
      resource: res,
      demand,
      perSeatDemand: seatDemand,
      claimants: Object.keys(seatDemand).map(Number).sort((a, b) => a - b),
      paid,
      bankBefore: view.bank[res] + paidTotal,
      bankAfter: view.bank[res],
      denied: event.denied?.includes(res) ?? false,
    })
  }

  const parts = resources.map((r) => {
    const who = r.claimants.map((s) => `P${s + 1}:${r.perSeatDemand[s]}`).join(' ')
    return r.denied
      ? `${r.resource} DENIED (demand ${r.demand} > stock ${r.bankBefore}, ${r.claimants.length} claimants: ${who}) bank stays ${r.bankAfter}`
      : `${r.resource} demand ${r.demand} (${who}) bank ${r.bankBefore}->${r.bankAfter}`
  })
  const summary = `P${event.player + 1} rolled ${event.total} (${event.dice[0]}+${event.dice[1]})${
    parts.length ? ` — ${parts.join(' | ')}` : ' — no production'
  }`

  return { summary, roll: event.total, dice: event.dice, resources }
}
