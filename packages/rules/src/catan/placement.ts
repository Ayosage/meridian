import type { CatanState } from './state'
import { topologyFor, type VertexId } from './topology'

/** Distance rule: the vertex is empty and no building sits on an adjacent vertex. */
export function settlementDistanceOk(state: Pick<CatanState, 'board' | 'buildings'>, vertex: VertexId): boolean {
  const topo = topologyFor(state.board)
  if (state.buildings[vertex]) return false
  return (topo.vertexVertices[vertex] ?? []).every((n) => !state.buildings[n])
}
