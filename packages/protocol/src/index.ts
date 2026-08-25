import { z } from 'zod'
import type { CatanClientState } from '@meridian/rules'

/** Message-type names shared by client and server. */
export const MSG = {
  INTENT: 'intent',
  RULE_ERROR: 'ruleError',
  SNAPSHOT: 'snapshot',
  MATCH_ENDED: 'matchEnded',
  /** Lobby: host starts a 4-room early at 3 seated players (no payload). */
  START: 'start',
} as const

const coordSchema = z.object({ q: z.number().int(), r: z.number().int() }).strict()

/**
 * Client -> server intents. Deliberately has NO player field: the server
 * derives the seat from the connection. Strict: unknown keys are rejected.
 */
export const clientIntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), pieceId: z.string().min(1), to: coordSchema }).strict(),
  z.object({ type: z.literal('endTurn') }).strict(),
])
export type ClientIntent = z.infer<typeof clientIntentSchema>

export const ruleErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
})
export type RuleErrorPayload = z.infer<typeof ruleErrorPayloadSchema>

export const matchEndedPayloadSchema = z.object({
  reason: z.enum(['win', 'forfeit']),
  winner: z.number().int().nonnegative(),
})
export type MatchEndedPayload = z.infer<typeof matchEndedPayloadSchema>

// ---------------------------------------------------------------------------
// Catan (phase 3)

const resourceNames = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const
const resourceSchema = z.enum(resourceNames)
/** Strict partial resource map; positive integer counts only. */
const resourceMapSchema = z
  .object(
    Object.fromEntries(
      resourceNames.map((r) => [r, z.number().int().positive().optional()]),
    ) as Record<(typeof resourceNames)[number], z.ZodOptional<z.ZodNumber>>,
  )
  .strict()

const boardId = z.string().min(1).max(64)
const seatSchema = z.number().int().nonnegative().max(3)

/**
 * Client -> server Catan intents. NO player field — the server derives the
 * seat from the connection. Strict: unknown keys are rejected. The engine
 * remains the authority on legality; this only rejects malformed shapes.
 */
const playDevCardSchema = z.discriminatedUnion('card', [
  z.object({ type: z.literal('playDevCard'), card: z.literal('knight') }).strict(),
  z
    .object({
      type: z.literal('playDevCard'),
      card: z.literal('roadBuilding'),
      // the engine allows 1 edge when only 1 road remains in stock
      edges: z.array(boardId).min(1).max(2),
    })
    .strict(),
  z
    .object({
      type: z.literal('playDevCard'),
      card: z.literal('yearOfPlenty'),
      take: z.tuple([resourceSchema, resourceSchema]),
    })
    .strict(),
  z
    .object({ type: z.literal('playDevCard'), card: z.literal('monopoly'), resource: resourceSchema })
    .strict(),
])

const catanIntentWithoutDevSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('placeSetupSettlement'), vertex: boardId }).strict(),
  z.object({ type: z.literal('placeSetupRoad'), edge: boardId }).strict(),
  z.object({ type: z.literal('rollDice') }).strict(),
  z.object({ type: z.literal('discard'), resources: resourceMapSchema }).strict(),
  z
    .object({ type: z.literal('moveRobber'), hex: coordSchema, stealFrom: seatSchema.nullable() })
    .strict(),
  z
    .object({
      type: z.literal('build'),
      piece: z.enum(['road', 'settlement', 'city']),
      location: boardId,
    })
    .strict(),
  z.object({ type: z.literal('buyDevCard') }).strict(),
  z.object({ type: z.literal('bankTrade'), give: resourceSchema, get: resourceSchema }).strict(),
  z.object({ type: z.literal('offerTrade'), give: resourceMapSchema, get: resourceMapSchema }).strict(),
  z
    .object({
      type: z.literal('respondTrade'),
      response: z.union([
        z.literal('accept'),
        z.literal('reject'),
        z.object({ give: resourceMapSchema, get: resourceMapSchema }).strict(),
      ]),
    })
    .strict(),
  z.object({ type: z.literal('confirmTrade'), partner: seatSchema }).strict(),
  z.object({ type: z.literal('cancelTrade') }).strict(),
  z.object({ type: z.literal('endTurn') }).strict(),
])

export const catanIntentSchema = z.union([catanIntentWithoutDevSchema, playDevCardSchema])
export type CatanClientIntent = z.infer<typeof catanIntentSchema>

// ---------------------------------------------------------------------------
// Game events (action log)

type Resource = (typeof resourceNames)[number]
type ResourceMap = Partial<Record<Resource, number>>

/**
 * One game happening, derived server-side from (state-before, intent,
 * state-after) at the room's single apply choke point and shipped with the
 * snapshot broadcast. Events are PRE-REDACTED per seat before sending: the
 * optional secret fields (`discard.resources`, `robber.stolen`) are present
 * only for the seats allowed to know them — an event never says more than
 * the seat's own snapshot could reveal.
 */
export type CatanEvent =
  | { kind: 'roll'; player: number; dice: readonly [number, number]; total: number; gains: Readonly<Record<number, ResourceMap>>; robbed?: readonly Resource[] }
  | { kind: 'discard'; player: number; count: number; resources?: ResourceMap }
  | { kind: 'robber'; player: number; victim: number | null; stolen?: Resource }
  | { kind: 'monopoly'; player: number; resource: Resource; taken: Readonly<Record<number, number>> }
  | { kind: 'yearOfPlenty'; player: number; take: readonly [Resource, Resource] }
  | { kind: 'roadBuilding'; player: number; edges: number }
  | { kind: 'knight'; player: number }
  | { kind: 'buyDev'; player: number }
  | { kind: 'build'; player: number; piece: 'road' | 'settlement' | 'city' }
  | { kind: 'bankTrade'; player: number; give: Resource; giveCount: number; get: Resource }
  | { kind: 'offer'; player: number; give: ResourceMap; get: ResourceMap }
  | { kind: 'tradeResponse'; player: number; response: 'accept' | 'reject' | 'counter' }
  | { kind: 'tradeSettled'; player: number; partner: number; gave: ResourceMap; got: ResourceMap }
  | { kind: 'offerCancelled'; player: number }
  | { kind: 'turnEnded'; player: number; turn: number }
  | { kind: 'win'; player: number }

/** Server -> client per-seat snapshot (server design spec §2/§5). */
export interface CatanSnapshotPayload {
  seq: number
  view: CatanClientState
  /** What the applied intent did, pre-redacted for this seat. Absent on resync/initial snapshots. */
  events?: readonly CatanEvent[]
}
