/**
 * Health payload for GET /healthz (Fly http check, CI smoke, humans). Pure so
 * it is trivially testable; app.config.ts wires it to express.
 */
export interface HealthDeps {
  env: NodeJS.ProcessEnv
  uptimeSeconds: () => number
  roomCount?: () => number
}

export interface HealthBody {
  ok: true
  version: string
  region: string
  uptime: number
  rooms?: number
}

/** Fly stamps every machine with its image ref; fall back to a build arg / dev. */
export function versionFrom(env: NodeJS.ProcessEnv): string {
  return env.GIT_SHA?.slice(0, 7) ?? env.FLY_IMAGE_REF?.split(':').pop()?.slice(0, 12) ?? 'dev'
}

export function healthBody(deps: HealthDeps): HealthBody {
  const body: HealthBody = {
    ok: true,
    version: versionFrom(deps.env),
    region: deps.env.FLY_REGION ?? 'local',
    uptime: Math.round(deps.uptimeSeconds()),
  }
  if (deps.roomCount) body.rooms = deps.roomCount()
  return body
}
