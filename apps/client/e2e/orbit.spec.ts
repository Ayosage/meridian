import { expect, test } from '@playwright/test'

// Global `window.__meridianDebug` typing (legalTargetsOnScreen, catanView)
// lives in src/dev/debugHooks.tsx / scene/catan/CatanScene.tsx's
// CatanDebugHooks — see bots.spec.ts's header comment. `catanView()` types
// its `view` as `unknown` (the hook is shared with non-Catan routes), so the
// reads below cast it locally to just the shape they use.
type ViewShape = { buildings: Readonly<Record<string, unknown>> }

type Page = import('@playwright/test').Page
type ScreenTarget = { kind: string; id: string; x: number; y: number }

test.use({ viewport: { width: 1280, height: 720 } })

/** The element actually hit at (x,y) — 'canvas' means the click would reach the board. */
async function hitTest(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.tagName.toLowerCase() ?? 'none', [x, y] as [number, number])
}

/**
 * drei's <OrbitControls> applies accumulated pointer deltas to the camera
 * once per rendered frame (its `update()` runs inside a `useFrame`), while
 * Playwright's `steps`-interpolated drag fires every intermediate mousemove
 * essentially back-to-back — faster than the display's frame cadence. Read
 * immediately after `mouse.up()`, the live camera (and therefore every
 * projected screen coordinate from `legalTargetsOnScreen`) can lag a few
 * frames behind the final pointer position. Poll until a target's projection
 * stops moving between two samples, i.e. the controls have caught up, rather
 * than betting on a fixed sleep.
 */
async function waitForCameraSettle(page: Page, id: string): Promise<ScreenTarget[]> {
  let prev: ScreenTarget | null = null
  let targets: ScreenTarget[] = []
  for (let i = 0; i < 30; i++) {
    targets = await page.evaluate(() => window.__meridianDebug!.legalTargetsOnScreen!().targets)
    const t = targets.find((x) => x.id === id) ?? null
    if (t && prev && Math.abs(t.x - prev.x) < 0.5 && Math.abs(t.y - prev.y) < 0.5) return targets
    prev = t
    await page.waitForTimeout(30)
  }
  return targets
}

test('a vertex under a HUD panel becomes clickable after a drag-orbit', async ({ page }) => {
  await page.goto('/?seed=42&vp=4&tier=low')
  await page.getByTestId('players-4').click()
  await page.getByTestId('bots-3').click()
  await page.getByTestId('create-button').click()
  await page.getByTestId('start-now').click()
  await page.waitForFunction(() => (window.__meridianDebug?.legalTargetsOnScreen?.().targets.length ?? 0) > 0)

  // Real click-blocking panels here (BuildBar, CatanHud's opponent-strip,
  // TradePanel, DevCardStrip) render as fixed-position elements over the
  // canvas — no toggling needed to manufacture occlusion during initial
  // setup placement.
  const targets = await page.evaluate(() => window.__meridianDebug!.legalTargetsOnScreen!().targets)
  let occluded: ScreenTarget | null = null
  for (const t of targets) {
    if ((await hitTest(page, t.x, t.y)) !== 'canvas') {
      occluded = t
      break
    }
  }
  test.skip(occluded === null, 'no target occluded on this seed/viewport — rerun after seed change')

  // Probe sequentially for a clear drag-origin point (not the occluded
  // target itself) rather than assuming the board center is unoccluded.
  let dragOrigin: { x: number; y: number } | null = null
  for (const t of targets) {
    if (occluded && t.id === occluded.id) continue
    if ((await hitTest(page, t.x, t.y)) === 'canvas') {
      dragOrigin = { x: t.x, y: t.y }
      break
    }
  }
  expect(dragOrigin, 'expected at least one unoccluded legal target to drag-orbit from').not.toBeNull()

  // Drag-orbit from the clear point.
  await page.mouse.move(dragOrigin!.x, dragOrigin!.y)
  await page.mouse.down()
  await page.mouse.move(dragOrigin!.x - 200, dragOrigin!.y, { steps: 10 })
  await page.mouse.up()

  // Let OrbitControls' per-frame update() catch up to the drag before
  // trusting any projected coordinate (see waitForCameraSettle above).
  const after = await waitForCameraSettle(page, occluded!.id)

  // Projections must have moved (camera actually orbited).
  const same = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1
  expect(after.some((t) => t.id === occluded!.id && !same(t, occluded!))).toBe(true)

  // The previously occluded vertex is now clear — click it and see the building land.
  const moved = after.find((t) => t.id === occluded!.id)!
  expect(await hitTest(page, moved.x, moved.y)).toBe('canvas')
  const before = await page.evaluate(
    () => Object.keys((window.__meridianDebug!.catanView!() as { view: ViewShape }).view.buildings).length,
  )
  await page.mouse.click(moved.x, moved.y)
  await page.waitForFunction(
    (n) => Object.keys((window.__meridianDebug!.catanView!() as { view: ViewShape }).view.buildings).length > n,
    before,
  )
})

test('the HUD advertises drag-to-orbit as a discoverability hint', async ({ page }) => {
  await page.goto('/?seed=42&vp=4&tier=low')
  await page.getByTestId('players-4').click()
  await page.getByTestId('bots-3').click()
  await page.getByTestId('create-button').click()
  await page.getByTestId('start-now').click()
  await expect(page.getByTestId('orbit-hint')).toHaveText('drag to rotate · scroll to zoom')
})
