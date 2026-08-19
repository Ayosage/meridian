import { describe, expect, it } from 'vitest'
import { redactCatanState, type CatanState } from '../../src/index'
import { setupComplete, withResources } from './helpers'

const PUBLIC_PLAYER_KEYS = [
  'citiesLeft',
  'devCardCount',
  'knightsPlayed',
  'resourceCount',
  'roadsLeft',
  'settlementsLeft',
]

/** Structural no-leak check reused by the replay property test. */
export function expectNoLeaks(view: unknown, seat: number, state: CatanState): void {
  const v = view as ReturnType<typeof redactCatanState>
  // own hand, in full
  expect(v.you.seat).toBe(seat)
  expect(v.you.resources).toEqual(state.players[seat]!.resources)
  expect(v.you.devCards).toEqual(state.players[seat]!.devCards)
  // every player entry has ONLY the public summary keys
  for (const p of v.players) {
    expect(Object.keys(p).sort()).toEqual(PUBLIC_PLAYER_KEYS)
  }
  // deck reduced to a count; the array never appears anywhere
  expect(v.devDeckCount).toBe(state.devDeck.length)
  expect(JSON.stringify(v)).not.toContain('"devDeck"')
  // public pass-through stays intact
  expect(v.board).toEqual(state.board)
  expect(v.buildings).toEqual(state.buildings)
  expect(v.roads).toEqual(state.roads)
  expect(v.bank).toEqual(state.bank)
  expect(v.turn).toEqual(state.turn)
  expect(v.seq).toBe(state.seq)
}

describe('redactCatanState', () => {
  it('gives each seat its own hand and only public summaries of others', () => {
    const state = withResources(setupComplete(), 1, { wood: 3, ore: 2 })
    for (let seat = 0; seat < state.playerCount; seat++) {
      expectNoLeaks(redactCatanState(state, seat), seat, state)
    }
    const v0 = redactCatanState(state, 0)
    expect(v0.players[1]!.resourceCount).toBe(
      Object.values(state.players[1]!.resources).reduce((a, b) => a + b, 0),
    )
    expect((v0.players[1] as unknown as Record<string, unknown>)['resources']).toBeUndefined()
  })

  it('reveals winnerVpCards only when the game is won', () => {
    const state = setupComplete()
    expect(redactCatanState(state, 0).winnerVpCards).toBeNull()
    const won: CatanState = {
      ...state,
      winner: 2,
      players: state.players.map((p, i) =>
        i === 2
          ? {
              ...p,
              devCards: [
                { card: 'vp' as const, boughtOnTurn: 1 },
                { card: 'knight' as const, boughtOnTurn: 1 },
              ],
            }
          : p,
      ),
    }
    expect(redactCatanState(won, 0).winnerVpCards).toBe(1)
  })
})
