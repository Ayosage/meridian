import { z } from 'zod'

/**
 * Transport envelope between a client and a match object. Game payloads
 * (`intent`, `view`, `events`) are opaque here; the object validates intents
 * with its adapter's schema and views are whatever the adapter redacts.
 */
export const clientEnvelopeSchema = z.discriminatedUnion('t', [
  z
    .object({
      t: z.literal('hello'),
      /** Reconnect token from a previous welcome. */
      token: z.string().min(1).optional(),
      /** Steward per-player seat token from the personal join link. */
      seatToken: z.string().min(1).max(128).optional(),
      displayName: z.string().min(1).max(64).optional(),
    })
    .strict(),
  z.object({ t: z.literal('intent'), intent: z.unknown() }).strict(),
  /** Host only, while waiting: start now; bots fill the empty seats. */
  z.object({ t: z.literal('start') }).strict(),
  /** Host only, while waiting: set the table size and how many seats bots take. */
  z
    .object({ t: z.literal('configure'), players: z.number().int().min(2), bots: z.number().int().nonnegative() })
    .strict(),
])
export type ClientEnvelope = z.infer<typeof clientEnvelopeSchema>

export const lobbyPayloadSchema = z
  .object({
    phase: z.enum(['waiting', 'playing', 'ended']),
    seats: z.array(z.string()),
    connected: z.array(z.boolean()),
    targetPlayers: z.number().int().min(2),
    botCount: z.number().int().nonnegative(),
    seatNames: z.array(z.string()),
  })
  .strict()
export type LobbyPayload = z.infer<typeof lobbyPayloadSchema>

export const serverEnvelopeSchema = z.discriminatedUnion('t', [
  z
    .object({ t: z.literal('welcome'), seat: z.number().int().nonnegative(), token: z.string().min(1) })
    .strict(),
  lobbyPayloadSchema.extend({ t: z.literal('lobby') }).strict(),
  z
    .object({
      t: z.literal('snapshot'),
      seq: z.number().int().nonnegative(),
      view: z.unknown(),
      events: z.array(z.unknown()).optional(),
    })
    .strict(),
  z.object({ t: z.literal('error'), code: z.string().min(1), message: z.string() }).strict(),
  z
    .object({
      t: z.literal('ended'),
      reason: z.enum(['win', 'forfeit', 'abandoned']),
      winner: z.number().int().nonnegative().nullable(),
    })
    .strict(),
])
export type ServerEnvelope = z.infer<typeof serverEnvelopeSchema>
