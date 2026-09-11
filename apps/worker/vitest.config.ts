import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { LAUNCH_TOKEN: 'test-token', TEST_KNOBS: '1' } },
    }),
  ],
  test: { include: ['test/**/*.test.ts'] },
})
