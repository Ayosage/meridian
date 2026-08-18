import type { Presence } from 'colyseus'

const CODE_KEY = 'meridian:roomIds'
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function randomCode(): string {
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return code
}

/**
 * Reserve a unique 4-letter join code via the shared presence set.
 *
 * Deviation from the brief: `Presence#sadd` is typed `any` and the installed
 * `LocalPresence` implementation (used by `@colyseus/testing`'s in-process
 * boot) returns `undefined` rather than a boolean "was newly added" flag, so
 * `if (await presence.sadd(...))` is always falsy there. We check membership
 * with `sismember` (which does return a meaningful 0/1 in `LocalPresence`)
 * before reserving, instead of relying on `sadd`'s return value.
 */
export async function generateRoomId(presence: Presence): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = randomCode()
    const taken = await presence.sismember(CODE_KEY, code)
    if (!taken) {
      await presence.sadd(CODE_KEY, code)
      return code
    }
  }
  throw new Error('could not allocate a unique room code')
}

export async function releaseRoomId(presence: Presence, code: string): Promise<void> {
  await presence.srem(CODE_KEY, code)
}
