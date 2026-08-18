import { z } from 'zod'
import { coordKey, inRadius } from './coord'

const coordSchema = z.object({ q: z.number().int(), r: z.number().int() })

const pieceDefSchema = z.object({
  type: z.string().min(1),
  movement: z.object({
    pattern: z.literal('step'),
    range: z.number().int().positive(),
  }),
  capture: z.object({ rule: z.literal('displace') }),
})

export const rulesetSchema = z.object({
  name: z.string().min(1),
  board: z.object({ shape: z.literal('hex'), radius: z.number().int().positive() }),
  playerCount: z.number().int().min(2),
  pieces: z.array(pieceDefSchema).min(1),
  setup: z
    .array(z.object({ player: z.number().int().nonnegative(), type: z.string().min(1), at: coordSchema }))
    .min(1),
  win: z.object({ rule: z.literal('lastPlayerStanding') }),
})

export type Ruleset = z.infer<typeof rulesetSchema>
export type PieceDef = Ruleset['pieces'][number]

/** Parse + cross-validate a ruleset. Throws Error with a descriptive message. */
export function loadRuleset(data: unknown): Ruleset {
  const rs = rulesetSchema.parse(data)
  const types = new Set(rs.pieces.map((p) => p.type))
  const seen = new Set<string>()
  for (const [i, entry] of rs.setup.entries()) {
    if (!inRadius(entry.at, rs.board.radius))
      throw new Error(`setup[${i}] is off the board: ${coordKey(entry.at)}`)
    if (!types.has(entry.type))
      throw new Error(`setup[${i}] has unknown piece type "${entry.type}"`)
    if (entry.player >= rs.playerCount)
      throw new Error(`setup[${i}] player index ${entry.player} >= playerCount ${rs.playerCount}`)
    const key = coordKey(entry.at)
    if (seen.has(key)) throw new Error(`duplicate setup coordinate ${key}`)
    seen.add(key)
  }
  return rs
}
