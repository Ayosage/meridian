import {
  applyCatanIntent,
  companionIntent,
  createCatanGame,
  isCatanRuleError,
  redactCatanState,
  victoryPoints,
  type CatanIntent,
  type CatanPlayerCount,
  type CatanState,
  type CatanClientState,
  type CompanionOpts,
} from '@meridian/rules'
import { catanIntentSchema, type CatanClientIntent, type CatanEvent } from '@meridian/protocol'
import type { GameAdapter, Placement } from '@meridian/match-core'
import { deriveCatanEvents, redactEventForSeat } from './events'
import { pilotIntent } from './pilot'

/** Per-bot-seat turn memory (server design spec §2): reset when turn.number moves. */
interface BotMemory {
  turn: number
  proposed: boolean
  bankTrades: number
  /** Set by the object while its offer window has expired; read-only here. */
  offerDeadlineHit?: boolean
}

function memoryFor(state: CatanState, memory: unknown): BotMemory {
  const turn = state.turn.number
  const m = memory as BotMemory | undefined
  const offerDeadlineHit = m?.offerDeadlineHit ?? false
  return m && m.turn === turn ? { ...m, offerDeadlineHit } : { turn, proposed: false, bankTrades: 0, offerDeadlineHit }
}

export const catanAdapter: GameAdapter<CatanState, CatanClientIntent, CatanClientState, CatanEvent> = {
  slug: 'catan',
  players: { min: 3, max: 8 },
  intentSchema: catanIntentSchema,
  create(opts, rng) {
    const layout = opts.layout === 'beginner' ? 'beginner' : 'random'
    const targetVp = typeof opts.targetVp === 'number' ? opts.targetVp : undefined
    return createCatanGame({ playerCount: opts.playerCount as CatanPlayerCount, layout, targetVp }, rng)
  },
  apply(state, intent, rng) {
    const result = applyCatanIntent(state, intent as CatanIntent, rng)
    return isCatanRuleError(result) ? { code: result.code, message: result.message } : result
  },
  view: (state, seat) => redactCatanState(state, seat),
  events: (before, intent, after) => deriveCatanEvents(before, intent as CatanIntent, after),
  redactEvent: redactEventForSeat,
  drive(state, seat, kind, rng, memory) {
    // The engine's CatanIntent has readonly arrays; the wire schema infers mutable ones. Same shapes.
    type Driven = (CatanClientIntent & { player: number }) | null
    if (kind === 'pilot') return { intent: pilotIntent(state, seat, rng) as unknown as Driven, memory }
    const mem = memoryFor(state, memory)
    const opts: CompanionOpts = {
      proposedThisTurn: mem.proposed,
      resolveOfferNow: mem.offerDeadlineHit ?? false,
      bankTradesThisTurn: mem.bankTrades,
    }
    const intent = companionIntent(state, seat, rng, opts)
    if (intent?.type === 'offerTrade') mem.proposed = true
    if (intent?.type === 'bankTrade') mem.bankTrades++
    return { intent: intent as unknown as Driven, memory: mem }
  },
  driveDelayMs: (kind) => (kind === 'bot' ? 900 : 600),
  offerWindow(state) {
    const offer = state.turn.openTrade
    if (!offer) return { open: false, everyoneAnswered: false }
    const everyoneAnswered = state.players.every(
      (_, seat) => seat === state.turn.current || offer.responses[seat] !== undefined,
    )
    return { open: true, everyoneAnswered }
  },
  offerWindowMs: 10_000,
  canStartEarly: (seated, target, bots) => bots === 0 && seated >= 3 && seated === target - 1,
  isEnded: (state) => state.winner !== null,
  winner: (state) => state.winner,
  result(state): Placement[] {
    const vp = state.players.map((_, seat) => victoryPoints(state, seat, { includeHidden: true }))
    const order = vp.map((v, seat) => ({ v, seat })).sort((a, b) => b.v - a.v || a.seat - b.seat)
    return order.map(({ seat, v }, i) => ({
      seat,
      placement: i + 1,
      winner: state.winner === seat,
      stats: {
        vp: v,
        longestRoad: state.awards.longestRoad === seat,
        largestArmy: state.awards.largestArmy === seat,
      },
    }))
  },
  turnNumber: (state) => state.turn.number,
  currentSeat: (state) => state.turn.current,
}
