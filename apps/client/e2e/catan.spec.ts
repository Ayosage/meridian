import { expect, test, type Page } from '@playwright/test'
import { clickFirstClearTarget, driveDiscard, isEnabled, isVisible, tryClick } from './driver.mjs'

/**
 * Seed pinned by a headless search (apps/client/e2e/seedsearch.local.mjs,
 * deleted after use — see task-12-report.md for the transcript): 3 players,
 * the EXACT greedy policy this spec's `tick()` drives through the UI (city >
 * settlement > road > end; discard/robber/steal greedy — NO dev-card
 * actions, since the UI exposes none), reaches a win in 1134 engine intents
 * (464 end turns). Seeds 1-8 stall past a 2500-intent budget without dev
 * cards (max non-dev VP is 4 cities + 1 settlement + longest road = 11, so
 * it's board-luck-dependent whether enough legal spots ever open up).
 * NOTE: this differs from apps/server/test/catan-full-match.test.ts's pinned
 * seed 3 — that suite's bot DOES use dev cards (buyDevCard/playDevCard), so
 * its move sequence (and therefore which seed converges) is different from
 * this dev-card-free UI driver's.
 *
 * IN PRACTICE the live 3-browser run cannot replicate the search's exact
 * intent order (concurrent discards land in racy order, robber steals draw
 * rng at different points), so the 10-VP convergence above does NOT transfer
 * — a real run of this seed plateaued at 2 cities/4 VP per player for 500+
 * end-turns. The test therefore creates the room with a 4-VP target (?vp=,
 * TEST-ONLY room option) — see the goto below.
 */
const SEED = 9

// Global `window.__meridianDebug` typing (incl. CatanScene's catanRenderInfo
// / legalTargetsOnScreen extensions) lives in src/dev/debugHooks.tsx.
// isEnabled/isVisible/tryClick/driveDiscard/clickFirstClearTarget — the
// driver helpers this spec, trade-devcards.spec.ts, and tools/bots.mjs all
// share — live in e2e/driver.mjs.

/**
 * One decision for one page, mirroring the engine's greedy bot priorities
 * (city > settlement > road > end turn; discard/robber/steal greedy — see
 * @meridian/rules' botIntent and apps/server/test/catan-full-match.test.ts's
 * viewIntent) but driven entirely through real UI clicks: BuildBar buttons
 * to enter a voluntary placement mode, then a canvas click on the first
 * legal target (via the CatanScene dev hook) to complete it. No dev-card
 * actions — the UI exposes none.
 *
 * Returns the action taken this tick ('' if none — caller waits before repolling).
 */
async function tick(page: Page, trace: { step: string }): Promise<string> {
  trace.step = 'win-check'
  if (await isVisible(page.getByTestId('win-overlay'))) return '' // match over — nothing to drive

  trace.step = 'discard-check'
  if (await isVisible(page.getByTestId('discard-submit'))) {
    trace.step = 'discard-drive'
    await driveDiscard(page)
    return 'discard'
  }

  trace.step = 'steal-check'
  const stealBtn = page.locator('[data-testid^="steal-victim-"]').first()
  if (await isVisible(stealBtn)) {
    trace.step = 'steal-click'
    return (await tryClick(stealBtn)) ? 'steal' : ''
  }

  trace.step = 'targets-evaluate+click'
  const { mode, targets } = await clickFirstClearTarget(page)
  if (targets.length > 0) return `target:${mode}`
  if (mode === 'placeCity' || mode === 'placeSettlement' || mode === 'placeRoad') {
    // A placement mode with nothing legal in it — untoggle via the same
    // BuildBar button if it's clickable and retry next tick. If the button is
    // disabled the mode is a leftover forced one (setup) that the next
    // snapshot clears by itself (catanStore.deriveMode) — just wait; clicking
    // would hang Playwright's actionability retries on a disabled element.
    const testId = mode === 'placeCity' ? 'build-city' : mode === 'placeSettlement' ? 'build-settlement' : 'build-road'
    trace.step = `untoggle:${testId}`
    const btn = page.getByTestId(testId)
    if ((await isEnabled(btn)) && (await tryClick(btn))) return `untoggle:${mode}`
    return ''
  }

  trace.step = 'roll'
  const roll = page.getByTestId('roll-button')
  if (await isEnabled(roll)) {
    return (await tryClick(roll)) ? 'roll' : ''
  }

  for (const testId of ['build-city', 'build-settlement', 'build-road'] as const) {
    trace.step = `build:${testId}`
    const btn = page.getByTestId(testId)
    if (!(await isEnabled(btn))) continue
    if (!(await tryClick(btn))) continue // enter the voluntary placement mode
    trace.step = `probe:${testId}`
    const probe = await page.evaluate(() => window.__meridianDebug!.legalTargetsOnScreen!())
    if (probe.targets.length > 0) return `enter:${testId}` // next tick clicks one
    // Affordable but nowhere legal to put it (enclosed road network, no
    // settlement to upgrade, …) — untoggle and fall through to the next
    // piece / end turn, else this loop re-enters the dead mode every tick
    // and the turn never ends.
    await tryClick(btn)
  }

  trace.step = 'end-turn'
  const endTurn = page.getByTestId('end-turn')
  if (await isEnabled(endTurn)) {
    return (await tryClick(endTurn)) ? 'end-turn' : ''
  }

  return ''
}

/** Dump one page's decision state — diagnosing which page a stalled match is waiting on. */
async function logStallState(page: Page, label: string): Promise<void> {
  const s = await page
    .evaluate(() => {
      const probe = window.__meridianDebug?.legalTargetsOnScreen
      return probe ? { mode: probe().mode, targets: probe().targets.length } : { mode: 'no-hook', targets: 0 }
    })
    .catch(() => ({ mode: 'evaluate-failed', targets: 0 }))
  const buttons: string[] = []
  for (const id of ['roll-button', 'end-turn', 'build-road', 'build-settlement', 'build-city'] as const) {
    if (await isEnabled(page.getByTestId(id))) buttons.push(id)
  }
  const banner = (await page.getByTestId('turn-banner').textContent().catch(() => null)) ?? '?'
  console.log(`STALL ${label}: mode=${s.mode} targets=${s.targets} enabled=[${buttons.join(', ')}] banner=${JSON.stringify(banner)}`)
}

/** Drive one page's ticks until any page reports the match over (shared `done` flag) or the budget runs out. */
async function driveUntilDone(page: Page, label: string, done: { over: boolean }, budget: { remaining: number }): Promise<void> {
  let idleStreak = 0
  let actions = 0
  const tally: Record<string, number> = {}
  const trace = { step: '' }
  // A frozen page hangs page.evaluate indefinitely with no error — surface
  // which tick step a driver is wedged in.
  const watchdog = setInterval(() => console.log(`WEDGE ${label}: stuck in step "${trace.step}"`), 45_000)
  const rearm = () => {
    watchdog.refresh()
  }
  try {
  while (!done.over && budget.remaining > 0) {
    rearm()
    trace.step = 'win-overlay-loop-check'
    if (await isVisible(page.getByTestId('win-overlay'))) {
      done.over = true
      return
    }
    const acted = await tick(page, trace)
    if (acted) {
      budget.remaining--
      idleStreak = 0
      tally[acted] = (tally[acted] ?? 0) + 1
      actions++
      if (actions <= 5 || actions % 50 === 0) console.log(`ACT ${label} ${actions}: ${actions <= 5 ? acted : JSON.stringify(tally)}`)
    } else {
      // ~15s of consecutive no-ops usually means the whole match is waiting
      // on some page's stuck state — dump it for the failure log.
      idleStreak++
      if (idleStreak % 300 === 0) await logStallState(page, label)
      await page.waitForTimeout(50)
    }
  }
  } finally {
    clearInterval(watchdog)
  }
}

test.describe('3-browser Catan match', () => {
  test('plays a full 3-player match to a win overlay', async ({ browser }) => {
    // ~1134 engine intents driven through real UI clicks — measured ~27
    // end-turns/min across three contending pages, so the 464-end-turn game
    // needs ~17 minutes.
    test.setTimeout(1_800_000)

    const host = await (await browser.newContext()).newPage()
    const p2 = await (await browser.newContext()).newPage()
    const p3 = await (await browser.newContext()).newPage()

    // A crashed/erroring page wedges its driver silently — surface it.
    for (const [i, page] of [host, p2, p3].entries()) {
      page.on('crash', () => console.log(`CRASH P${i + 1}`))
      page.on('pageerror', (e) => console.log(`PAGEERROR P${i + 1}: ${e.message}`))
      page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning')
          console.log(`CONSOLE P${i + 1} ${msg.type()}: ${msg.text().slice(0, 160)}`)
      })
    }

    // tier=low on every page: three full boards with N8AO saturate one GPU,
    // starving each page's main thread until every driver click/evaluate takes
    // seconds (the match crawled at ~10 turns per 10 minutes at high tier).
    // vp=4: the three racing UI drivers can't replicate the engine seed
    // search's exact intent order, so the 10-VP guarantee doesn't transfer —
    // and without the (phase-5) trade/dev-card UX this seed's drifted game
    // plateaus at 2 cities per player (4 VP; no settlement spots open up and
    // longest road never reaches 5). A 4-VP target makes the win fire at the
    // second city upgrade (~turn 90) while still exercising the full loop:
    // setup draft, production, discards, robber, steals, builds, win overlay.
    await host.goto(`/?seed=${SEED}&vp=4&tier=low`)
    await host.getByTestId('players-3').click()
    await host.getByTestId('create-button').click()
    await expect(host.getByTestId('join-code')).toBeVisible()
    const code = (await host.getByTestId('join-code').textContent())!.trim()
    expect(code).toMatch(/^[A-Z]{4}$/)

    await p2.goto('/?tier=low')
    await p2.getByTestId('join-input').fill(code)
    await p2.getByTestId('join-button').click()

    await p3.goto('/?tier=low')
    await p3.getByTestId('join-input').fill(code)
    await p3.getByTestId('join-button').click()

    // Game auto-starts once all 3 seats fill (CatanRoom.onJoin) — wait for
    // the HUD (turn-banner) rather than any lobby text, since who goes first
    // in setup varies by seed.
    await expect(host.getByTestId('turn-banner')).toBeVisible({ timeout: 15_000 })
    await expect(p2.getByTestId('turn-banner')).toBeVisible({ timeout: 15_000 })
    await expect(p3.getByTestId('turn-banner')).toBeVisible({ timeout: 15_000 })

    // turn-banner (CatanHud, plain DOM) can paint before CatanScene's <Canvas>
    // has finished its own async WebGL mount and run CatanDebugHooks' effect
    // — wait for the dev hook itself before the drive loop starts polling it.
    for (const page of [host, p2, p3]) {
      await page.waitForFunction(() => typeof window.__meridianDebug?.legalTargetsOnScreen === 'function')
    }

    const done = { over: false }
    // Empirically 1134 engine intents to a win at this seed (see SEED
    // comment); budget well above that per page to absorb the extra idle
    // ticks (opponent's-turn no-ops) this UI-polling loop takes that a pure
    // headless intent count doesn't.
    const budget = { remaining: 4000 }
    await Promise.all([
      driveUntilDone(host, 'P1(host)', done, budget),
      driveUntilDone(p2, 'P2', done, budget),
      driveUntilDone(p3, 'P3', done, budget),
    ])

    await expect(host.getByTestId('win-overlay')).toBeVisible()
    const overlayText = (await host.getByTestId('win-overlay').textContent())!
    expect(overlayText).toMatch(/(you win|player \d+ wins)/i)
  })
})

test.describe('perf snapshot: /board tiers', () => {
  async function samplePerf(page: Page, url: string): Promise<{ fps: number; drawCalls: number; triangles: number }> {
    await page.goto(url)
    await page.waitForFunction(() => typeof window.__meridianDebug?.catanRenderInfo === 'function')
    const fps = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0
          const start = performance.now()
          function loop() {
            frames++
            const elapsed = performance.now() - start
            if (elapsed < 3000) requestAnimationFrame(loop)
            else resolve((frames * 1000) / elapsed)
          }
          requestAnimationFrame(loop)
        }),
    )
    const info = await page.evaluate(() => window.__meridianDebug!.catanRenderInfo!())
    return { fps, drawCalls: info.calls, triangles: info.triangles }
  }

  test('sample high and low tier fps + draw calls', async ({ page }) => {
    test.setTimeout(60_000)
    const high = await samplePerf(page, '/board?tier=high')
    console.log('PERF /board?tier=high', JSON.stringify(high))
    const low = await samplePerf(page, '/board?tier=low')
    console.log('PERF /board?tier=low', JSON.stringify(low))
    expect(high.drawCalls).toBeGreaterThan(0)
    expect(low.drawCalls).toBeGreaterThan(0)
  })
})
