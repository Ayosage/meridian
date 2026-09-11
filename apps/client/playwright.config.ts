import { defineConfig } from '@playwright/test'

// Spare-port overrides (README "Ports"): PORT picks the game Worker's port,
// CLIENT_PORT the Vite dev server's. Defaults are the human dev ports, so an
// E2E run alongside a live `pnpm dev` MUST override both, e.g.
//   PORT=8791 CLIENT_PORT=5191 pnpm --filter client test:e2e
// Both values are threaded into the spawned servers below: wrangler dev
// listens on PORT, the client dev server listens on CLIENT_PORT and dials
// http://localhost:$PORT (vite.config.ts), and the launch endpoint's join
// URLs name the client origin.
const serverPort = Number(process.env.PORT ?? 8787)
const clientPort = Number(process.env.CLIENT_PORT ?? 5173)
const clientOrigin = `http://localhost:${clientPort}`

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: clientOrigin,
    // Never let a single locator action auto-wait forever (the default,
    // actionTimeout 0, wedged E2E drivers probing unmounted modal buttons).
    actionTimeout: 15_000,
    // Headless Chromium falls back to SwiftShader (software WebGL) by
    // default — the full Catan board renders at ~3.5fps there, starving the
    // 3-browser E2E until it times out. ANGLE-on-Metal restores the real GPU
    // in new-headless mode (measured 120fps, same as headed).
    launchOptions: { args: ['--use-angle=metal', '--enable-gpu'] },
  },
  // Both servers are started fresh, never reused. Reuse silently hands the
  // suite whatever already listens on the ports — a dev server from another
  // worktree, or one left orphaned by an earlier run with rooms and timers
  // still accumulating — so the suite ends up testing a checkout that isn't
  // this one, and the resulting failures look like flakes. With reuse off, a
  // busy port fails the run immediately and by name; either pick spare ports
  // via PORT/CLIENT_PORT (above) or kill the stale listener
  // (`lsof -ti:5173,2567 | xargs kill -9`) and re-run.
  webServer: [
    {
      // Local Workers runtime with test knobs on (seeded, fast-finishing matches
      // via ?seed=/?vp=) and a throwaway state dir so rooms never leak between runs.
      command: `pnpm --filter worker exec wrangler dev --port ${serverPort} --persist-to .wrangler/e2e-state --var TEST_KNOBS:1 --var LAUNCH_TOKEN:e2e --var CLIENT_ORIGIN:${clientOrigin}`,
      cwd: '../..',
      url: `http://localhost:${serverPort}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm dev',
      port: clientPort,
      env: { PORT: String(serverPort), CLIENT_PORT: String(clientPort) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
