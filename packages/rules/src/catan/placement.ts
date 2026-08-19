import type { CatanState } from './state'
import { standardTopology, type VertexId } from './topology'

/** Distance rule: the vertex is empty and no building sits on an adjacent vertex. */
export function settlementDistanceOk(state: CatanState, vertex: VertexId): boolean {
  const topo = standardTopology()
  if (state.buildings[vertex]) return false
  return (topo.vertexVertices[vertex] ?? []).every((n) => !state.buildings[n])
}
