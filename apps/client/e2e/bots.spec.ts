import { expect, test } from '@playwright/test'
import { clickFirstClearTarget } from './driver.mjs'

// Global `window.__meridianDebug` typing (legalTargetsOnScreen, catanView)
// lives in src/dev/debugHooks.tsx / scene/catan/CatanScene.tsx's
// CatanDebugHooks — see catan.spec.ts's header comment. `catanView()` types
// its `view` as `unknown` (the hook is shared with non-Catan routes), so the
// waits below cast it locally to just the shape they read rather than
// importing `@meridian/rules`' `CatanClientState` — driver.mjs's header notes
// that barrel import breaks under Playwright's Node-native ESM loader for
// plain-JS driver modules, and there's no reason to risk the same package
// from a spec file for two fields.
type ViewShape = { buildings: Readonly<Record<string, unknown>>; turn: { current: number } }

test('lobby clamps bot count when switching 4 -> 3 players', async ({ page }) => {
  await page.goto('/?tier=low')
  await page.getByTestId('players-4').click()
  await page.getByTestId('bots-3').click()
  await page.getByTestId('players-3').click()
  // maxBots is players - 1: switching to 3 players disables the bots-3 option
  // (the radiogroup keeps every option in place so the row never reflows)...
  await expect(page.getByTestId('bots-3')).toBeDisabled()
  // ...and clamps the selection down to bots-2 (Lobby.tsx: setBots(b => Math.min(b, 2))).
  await expect(page.getByTestId('bots-2')).toHaveClass(/selected/)
  await expect(page.getByTestId('bots-2')).toHaveAttribute('aria-checked', 'true')
})

test('solo 4p match vs 3 bots: instant start, bots play setup, a human turn arrives', async ({ page }) => {
  test.setTimeout(90_000)

  await page.goto('/?seed=42&vp=4&tier=low')
  await page.getByTestId('players-4').click()
  await page.getByTestId('bots-3').click()
  await page.getByTestId('create-button').click()

  // A room filled entirely with bots has no one left to wait on — the scene
  // mounts straight away, no waiting room / join-code screen in between.
  await page.waitForFunction(() => typeof window.__meridianDebug?.legalTargetsOnScreen === 'function')

  // Human is seat 0 and acts first in the snake draft: place the opening
  // settlement, then its road (clickFirstClearTarget re-reads legal targets
  // fresh each call, so the second call sees the road-placement mode the
  // engine forces right after the settlement lands).
  for (let i = 0; i < 2; i++) {
    await page.waitForFunction(() => window.__meridianDebug!.legalTargetsOnScreen!().targets.length > 0)
    await clickFirstClearTarget(page)
  }

  // Bots (seats 1-3) take the rest of the first draft leg entirely
  // unattended — with the production default botDelayMs (900ms) this is a
  // few seconds of real time per bot action.
  await page.waitForFunction(
    () => {
      const { view } = window.__meridianDebug!.catanView!() as { view: ViewShape }
      return Object.keys(view.buildings).length >= 4
    },
    null,
    { timeout: 30_000 },
  )

  // The snake draft turns back at the end of the leg: eventually it's the
  // human's (seat 0) second placement, with legal targets on screen again.
  await page.waitForFunction(
    () => {
      const { view } = window.__meridianDebug!.catanView!() as { view: ViewShape }
      return view.turn.current === 0 && window.__meridianDebug!.legalTargetsOnScreen!().targets.length > 0
    },
    null,
    { timeout: 30_000 },
  )
})
