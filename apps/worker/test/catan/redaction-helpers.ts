import { expect } from 'vitest'
import type { CatanSnapshotPayload } from '@meridian/protocol'

const PUBLIC_PLAYER_KEYS = [
  'citiesLeft',
  'devCardCount',
  'knightsPlayed',
  'resourceCount',
  'roadsLeft',
  'settlementsLeft',
]

/** Structural no-leak check on a received snapshot, keyed to the seat that received it. */
export function expectRedactedFor(payload: CatanSnapshotPayload, seat: number): void {
  expect(payload.view.you.seat).toBe(seat)
  for (const p of payload.view.players) expect(Object.keys(p).sort()).toEqual(PUBLIC_PLAYER_KEYS)
  expect(JSON.stringify(payload)).not.toContain('"devDeck"')
  expect(typeof payload.view.devDeckCount).toBe('number')
}
