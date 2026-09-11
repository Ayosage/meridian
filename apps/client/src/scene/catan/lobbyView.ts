import {
  createCatanGame,
  createRng,
  edgeId,
  redactCatanState,
  vertexId,
  type Building,
  type CatanClientState,
} from '@meridian/rules'

/**
 * A finished-looking beginner board for the lobby backdrop: no server, no
 * room, a scattering of pieces from all four seats so the island reads as a
 * game in progress. Deterministic (seeded) so every visit shows the same board.
 */
export function lobbyBoardView(seed = 7): CatanClientState {
  const state = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(seed))
  const view = redactCatanState(state, 0)

  const spots = [
    { q: 0, r: 0 },
    { q: 1, r: -1 },
    { q: -1, r: 1 },
    { q: 1, r: 0 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
    { q: 0, r: 1 },
    { q: 2, r: -1 },
  ]
  const buildings: Record<string, Building> = { ...view.buildings }
  const roads: Record<string, number> = { ...view.roads }
  spots.forEach((c, i) => {
    const owner = i % 4
    buildings[vertexId(c, (i * 2) % 6)] = { owner, kind: i % 3 === 2 ? 'city' : 'settlement' }
    roads[edgeId(c, (i * 2) % 6)] = owner
    roads[edgeId(c, (i * 2 + 1) % 6)] = owner
  })

  return {
    ...view,
    buildings,
    roads,
    turn: { ...view.turn, phase: 'main', current: 0 },
  }
}
