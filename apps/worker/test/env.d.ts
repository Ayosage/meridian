import type { Env as WorkerEnv } from '../src/index'

// The workers test pool types `env` (and `import { env } from 'cloudflare:workers'`)
// as `Cloudflare.Env`, the namespace `wrangler types` would generate. We keep the
// bindings interface in src/index.ts and point the namespace at it here.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

export {}
