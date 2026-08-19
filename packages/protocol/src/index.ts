import { z } from 'zod'

/** Message-type names shared by client and server. */
export const MSG = {
  INTENT: 'intent',
  RULE_ERROR: 'ruleError',
  SNAPSHOT: 'snapshot',
  MATCH_ENDED: 'matchEnded',
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
