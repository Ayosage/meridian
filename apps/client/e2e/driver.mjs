// Shared UI-driver helpers for the E2E specs that play Catan through the
// real client (catan.spec.ts, trade-devcards.spec.ts). Plain ESM JavaScript
// (not TS); the specs get types from the hand-maintained declaration next
// door (driver.d.mts — keep it in sync).
//
// Deliberately NOT `import { RESOURCES } from '@meridian/rules'`: Playwright's
// test loader (unlike Vite/Vitest/tsx) resolves that package via Node's
// native ESM loader, which rejects packages/rules/src/placeholder.ts's bare
// `import placeholderJson from './rulesets/placeholder.json'` (no `type:
// "json"` import attribute) — an unrelated, non-Catan ruleset module pulled
// in transitively through the package's barrel export. Inlining this stable,
// small enum sidesteps it without touching @meridian/rules. Order matches
// @meridian/rules' RESOURCES exactly (see packages/rules/src/catan/types.ts).
export const RESOURCES = /** @type {const} */ (['wood', 'brick', 'sheep', 'wheat', 'ore'])

/**
 * Bounded isEnabled: bare locator.isEnabled() AUTO-WAITS for the element to
 * attach with NO time limit (default actionTimeout is 0 = unlimited), so
 * probing a button whose modal just unmounted (discard plus/submit, steal
 * victims) freezes that driver forever — this wedged the 3-browser match on
 * rotating pages until the whole test timed out. A detached element is simply
 * "not enabled" for this driver: answer false after 1s.
 * @param {import('@playwright/test').Locator} locator
 */
export async function isEnabled(locator) {
  return locator.isEnabled({ timeout: 1000 }).catch(() => false)
}

/** @param {import('@playwright/test').Locator} locator */
export async function isVisible(locator) {
  return locator.isVisible().catch(() => false)
}

/**
 * Click that gives up quietly when the element goes non-actionable. Every
 * driver click races snapshot latency: the tick re-checks isEnabled/isVisible
 * BEFORE the previous action's snapshot lands, so double-fires on an element
 * that disables or unmounts mid-click are routine — and a bare locator.click()
 * then retries actionability forever, freezing that page's driver (and with
 * it the whole match). Failing the click is always safe: the next tick
 * re-reads fresh state.
 * @param {import('@playwright/test').Locator} locator
 */
export async function tryClick(locator) {
  try {
    await locator.click({ timeout: 1000 })
    return true
  } catch (e) {
    console.log(`FAILCLICK ${String(locator)}: ${String(/** @type {Error} */ (e).message).split('\n')[0]}`)
    return false
  }
}

/**
 * Discard greedily, RESOURCES order, until the staged total matches what's
 * owed, then submit.
 * @param {import('@playwright/test').Page} page
 */
export async function driveDiscard(page) {
  const submit = page.getByTestId('discard-submit')
  for (const r of RESOURCES) {
    if (await isEnabled(submit)) break
    const plus = page.getByTestId(`discard-plus-${r}`)
    while (await isEnabled(plus)) {
      if (!(await tryClick(plus))) break
      if (await isEnabled(submit)) break
    }
  }
  if (await isEnabled(submit)) await tryClick(submit)
}

/**
 * Current mode + every legal on-screen target, straight from the CatanScene
 * dev hook (real camera projection — see CatanDebugHooks).
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ mode: string, targets: { kind: 'vertex' | 'edge' | 'hex', id: string, x: number, y: number }[] }>}
 */
export async function readLegalTargets(page) {
  return page.evaluate(() => window.__meridianDebug.legalTargetsOnScreen())
}

/**
 * Index of the first point an actual canvas click would reach, or -1 if every
 * point is covered. The fixed HUD panels (build bar, dev-card strip, docked
 * trade panel) sit ON the board; page.mouse.click hits whatever is topmost,
 * so a legal target under a panel would swallow every click while the driver
 * kept reporting "acted" — a permanent wedge. document.elementFromPoint
 * answers what would actually receive the click (it honours pointer-events:
 * none, so the HUD's own full-screen wrapper doesn't count); it also rules
 * out targets that project outside the viewport (null there).
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }[]} points
 */
export async function clearPointIndex(page, points) {
  return page.evaluate(
    (pts) => pts.findIndex((p) => document.elementFromPoint(p.x, p.y) instanceof HTMLCanvasElement),
    points,
  )
}

/**
 * Click the first legal canvas target for the current mode (hexes — robber
 * picks — take priority), preferring one no HUD panel covers. If nothing is
 * clear we still click the first target, i.e. the worst case is the blind
 * pre-occlusion-filter behaviour, never worse.
 * @param {import('@playwright/test').Page} page
 */
export async function clickFirstClearTarget(page) {
  const state = await readLegalTargets(page)
  const ordered = [...state.targets].sort((a, b) => Number(b.kind === 'hex') - Number(a.kind === 'hex'))
  if (ordered.length > 0) {
    const clearIdx = await clearPointIndex(
      page,
      ordered.map((t) => ({ x: t.x, y: t.y })),
    )
    const t = ordered[clearIdx >= 0 ? clearIdx : 0]
    await page.mouse.click(t.x, t.y)
  }
  return state
}
