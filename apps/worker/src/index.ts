import { matchFetch, type MatchEnv } from '@ayosage/match-core/worker'
import type { CatanMatch } from './match'
export { CatanMatch } from './match'

export interface Env extends MatchEnv {
  MATCH: DurableObjectNamespace<CatanMatch>
}

export default {
  fetch: (request: Request, env: Env) => matchFetch(request, env),
} satisfies ExportedHandler<Env>
