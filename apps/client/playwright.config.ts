import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: [
    {
      command: 'pnpm --filter server start',
      cwd: '../..',
      port: 2567,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'pnpm dev',
      port: 5173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
