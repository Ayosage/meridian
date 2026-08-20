import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    // Never let a single locator action auto-wait forever (the default,
    // actionTimeout 0, wedged E2E drivers probing unmounted modal buttons).
    actionTimeout: 15_000,
    // Headless Chromium falls back to SwiftShader (software WebGL) by
    // default — the full Catan board renders at ~3.5fps there, starving the
    // 3-browser E2E until it times out. ANGLE-on-Metal restores the real GPU
    // in new-headless mode (measured 120fps, same as headed).
    launchOptions: { args: ['--use-angle=metal', '--enable-gpu'] },
  },
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
