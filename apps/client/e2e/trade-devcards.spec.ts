import { expect, test, type Locator, type Page } from '@playwright/test'

// Same inlined enum as catan.spec.ts — see the long comment there for why the
// E2E specs don't `import { RESOURCES } from '@meridian/rules'` (Playwright's
// native-ESM loader chokes on an unrelated module in that package's barrel).
const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const
type Res = (typeof RESOURCES)[number]

/**
 * Unlike catan.spec.ts's SEED, this one needs no convergence guarantee: that
 * spec pins a seed whose whole match reaches a win, this one drives short,
 * bounded scenarios (one player trade, one bank trade, one dev-card buy and
 * play) that any board can supply. Seeds 2-8 and 11-22 all pass; 11 is
 * preferred because it exercises the most spec paths — its board never
 * produces wheat or ore for these placements, so the bank-stocking route to
 * a dev card runs too.
 */
const SEED = 11

type Target = { kind: 'vertex' | 'edge' | 'hex'; id: string; x: number; y: number }

// Global `window.__meridianDebug` typing (incl. CatanScene's catanRenderInfo
// / legalTargetsOnScreen extensions) lives in src/dev/debugHooks.tsx.

// --- driver helpers ---------------------------------------------------------
// isEnabled/isVisible/tryClick/driveDiscard below are verbatim copies of
// catan.spec.ts's, deliberately duplicated rather than extracted into a shared
// e2e/driver.ts: that spec is a pinned-seed soak whose timing must not change
// in this phase, and extracting would mean editing it. clickFirstClearTarget
// is its clickFirstLegalTarget with one documented change (see its comment).

/**
 * Bounded isEnabled: bare locator.isEnabled() AUTO-WAITS for the element to
 * attach with NO time limit (default actionTimeout is 0 = unlimited), so
 * probing a button whose modal just unmounted (discard plus/submit, steal
 * victims) freezes that driver forever — this wedged the 3-browser match on
 * rotating pages until the whole test timed out. A detached element is simply
 * "not enabled" for this driver: answer false after 1s.
 */
async function isEnabled(locator: Locator): Promise<boolean> {
  return locator.isEnabled({ timeout: 1000 }).catch(() => false)
}
async function isVisible(locator: Locator): Promise<boolean> {
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
 */
async function tryClick(locator: Locator): Promise<boolean> {
  try {
    await locator.click({ timeout: 1000 })
    return true
  } catch (e) {
    console.log(`FAILCLICK ${String(locator)}: ${String((e as Error).message).split('\n')[0]}`)
    return false
  }
}

/** Discard greedily, RESOURCES order, until the staged total matches what's owed, then submit. */
async function driveDiscard(page: Page): Promise<void> {
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
 * Click the first legal canvas target for the current mode (hexes — robber
 * picks — take priority), skipping any target a fixed HUD panel covers.
 *
 * That last clause is the one change from catan.spec.ts's
 * clickFirstLegalTarget: that spec never buys a dev card or opens the trade
 * panel, so nothing but the canvas is ever under its click coordinates. This
 * one leaves a page holding dev cards for all of section (c), and the
 * dev-card strip (fixed, bottom-left) and docked trade panel (fixed,
 * bottom-right) sit ON the board. page.mouse.click hits whatever is topmost,
 * so a legal target under a panel would swallow every click while the driver
 * kept reporting "acted" — a permanent wedge. document.elementFromPoint
 * answers what would actually receive the click (it honours
 * pointer-events: none, so the HUD's own full-screen wrapper doesn't count).
 * If nothing is clear we still click the first target, i.e. the worst case is
 * exactly catan.spec.ts's behaviour, never worse.
 */
async function clickFirstClearTarget(page: Page): Promise<{ mode: string; targets: Target[] }> {
  const state = await page.evaluate(() => window.__meridianDebug!.legalTargetsOnScreen!())
  const ordered = [...state.targets].sort((a, b) => Number(b.kind === 'hex') - Number(a.kind === 'hex'))
  if (ordered.length > 0) {
    const clearIdx = await page.evaluate(
      (points: { x: number; y: number }[]) =>
        points.findIndex((p) => document.elementFromPoint(p.x, p.y) instanceof HTMLCanvasElement),
      ordered.map((t) => ({ x: t.x, y: t.y })),
    )
    const t = ordered[clearIdx >= 0 ? clearIdx : 0]!
    await page.mouse.click(t.x, t.y)
  }
  return state
}

// --- reading the HUD --------------------------------------------------------

/** Read the five hand counts off a page's hand strip. */
async function readHand(page: Page): Promise<Record<Res, number>> {
  const out = {} as Record<Res, number>
  for (const r of RESOURCES) {
    const text = await page.getByTestId(`hand-${r}`).textContent()
    out[r] = Number(text!.replace(/\D+/g, ''))
  }
  return out
}

function handTotal(hand: Record<Res, number>): number {
  return RESOURCES.reduce((n, r) => n + hand[r], 0)
}

/** Which seat a page holds: the one opponent card its HUD does NOT render. */
async function seatOf(page: Page): Promise<number> {
  for (const seat of [0, 1, 2]) {
    if ((await page.getByTestId(`opponent-${seat}`).count()) === 0) return seat
  }
  throw new Error('seatOf: every opponent card rendered — no seat left for this page')
}

/**
 * One public opponent stat as another page sees it — the cross-page witness
 * for effects a player's own HUD can't prove (dev cards bought, knights
 * played). Only `dev`/`knights`: "N cards" abuts the "Player N" heading in the
 * concatenated text, so its digits aren't safely separable.
 */
async function readOpponentStat(page: Page, seat: number, label: 'dev' | 'knights'): Promise<number> {
  const text = (await page.getByTestId(`opponent-${seat}`).textContent()) ?? ''
  const m = text.match(new RegExp(`(\\d+) ${label}`))
  if (!m) throw new Error(`readOpponentStat: no "${label}" in ${JSON.stringify(text)}`)
  return Number(m[1])
}

/** "Dev cards · 24 in deck" off the strip header. */
async function readDeckCount(page: Page): Promise<number> {
  const text = (await page.getByTestId('dev-strip').textContent()) ?? ''
  const m = text.match(/(\d+) in deck/)
  if (!m) throw new Error(`readDeckCount: no deck count in ${JSON.stringify(text)}`)
  return Number(m[1])
}

/** Copies of one dev card the strip shows ("×2"), or 0 once the tile is gone. */
async function devTileCount(page: Page, card: string): Promise<number> {
  const tile = page.getByTestId(`dev-tile-${card}`)
  if ((await tile.count()) === 0) return 0
  const m = ((await tile.textContent()) ?? '').match(/×(\d+)/)
  return m ? Number(m[1]) : 0
}

/** The local board mode (idle/robber/roadBuilding/…) straight off the dev hook. */
async function modeOf(page: Page): Promise<string> {
  return page.evaluate(() => window.__meridianDebug!.legalTargetsOnScreen!().mode)
}

/** The first of `ids` whose button is enabled, or null if none are. */
async function firstEnabledTestId(page: Page, ids: string[]): Promise<string | null> {
  for (const id of ids) if (await isEnabled(page.getByTestId(id))) return id
  return null
}

// --- passive driving --------------------------------------------------------

/**
 * Passive tick: setup placements, roll, discard, robber, steal, end turn —
 * never builds. catan.spec.ts's `tick()` minus its build-bar section, so
 * resources pile up instead of turning into roads and cities, which is what
 * makes trades and dev-card buys reachable within a few rounds.
 */
async function passiveTick(page: Page): Promise<boolean> {
  if (await isVisible(page.getByTestId('discard-submit'))) {
    await driveDiscard(page)
    return true
  }
  const steal = page.locator('[data-testid^="steal-victim-"]').first()
  if (await isVisible(steal)) return tryClick(steal)
  const { mode, targets } = await clickFirstClearTarget(page)
  if (targets.length > 0) return true
  if (mode !== 'idle') return false // forced placement resolving; wait
  if (await isEnabled(page.getByTestId('roll-button'))) return tryClick(page.getByTestId('roll-button'))
  if (await isEnabled(page.getByTestId('end-turn'))) return tryClick(page.getByTestId('end-turn'))
  return false
}

/**
 * Drive all pages passively until `ready` answers a non-negative number (its
 * meaning is the caller's — usually the page index the scenario will script),
 * or the budget runs out, answering -1. `ready` is polled BEFORE each round of
 * ticks, so the state it reports is still current when this returns: nothing
 * moves between the answer and the caller's first click.
 */
async function drive(pages: Page[], ready: () => Promise<number>, budget = 600): Promise<number> {
  for (let i = 0; i < budget; i++) {
    const hit = await ready()
    if (hit >= 0) return hit
    for (const p of pages) await passiveTick(p)
    if (i > 0 && i % 100 === 0) {
      console.log(`DRIVE ${i}/${budget} iterations`)
      for (const [n, p] of pages.entries()) await logDriveState(p, `P${n + 1}`)
    }
    await pages[0]!.waitForTimeout(30)
  }
  return -1
}

/** Dump one page's decision state — diagnosing which page a stalled drive waits on. */
async function logDriveState(page: Page, label: string): Promise<void> {
  const mode = await modeOf(page).catch(() => 'evaluate-failed')
  const buttons: string[] = []
  for (const id of ['roll-button', 'end-turn', 'build-dev', 'trade-toggle'] as const) {
    if (await isEnabled(page.getByTestId(id))) buttons.push(id)
  }
  const banner = (await page.getByTestId('turn-banner').textContent().catch(() => null)) ?? '?'
  const hand = await readHand(page).catch(() => null)
  console.log(
    `STALL ${label}: mode=${mode} enabled=[${buttons.join(', ')}] banner=${JSON.stringify(banner)} hand=${JSON.stringify(hand)}`,
  )
}

/** `drive`, but a budget that runs out is a test failure rather than a -1. */
async function driveUntil(pages: Page[], ready: () => Promise<number>, budget = 600): Promise<number> {
  const hit = await drive(pages, ready, budget)
  if (hit < 0) throw new Error('driveUntil: budget exhausted before the condition held')
  return hit
}

/** Open the docked trade panel on a page (idempotent) and select one of its tabs. */
async function openTradePanel(page: Page, tab: 'players' | 'bank'): Promise<void> {
  if (!(await isVisible(page.getByTestId('trade-panel')))) await page.getByTestId('trade-toggle').click()
  await expect(page.getByTestId('trade-panel')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId(`trade-tab-${tab}`).click()
}

/**
 * Close the composer if it's up. `tradeOpen` survives the trade that closed
 * it, so the panel would reappear on this page's next turn — and being fixed
 * over the board's bottom-right corner, it can cover legal targets the
 * driver needs to click.
 */
async function closeTradePanel(page: Page): Promise<void> {
  if (await isVisible(page.getByTestId('trade-close'))) await tryClick(page.getByTestId('trade-close'))
}

/**
 * One bank trade on a page whose turn it is, self-verifying: the rate comes
 * off the chip (the seat may own a port), and this returns only once the hand
 * shows the give side paid. Reports that rate and the pre-trade hand so
 * callers can assert the rest of the delta.
 */
async function bankTradeFor(page: Page, give: Res, want: Res): Promise<{ rate: number; before: Record<Res, number> }> {
  await openTradePanel(page, 'bank')
  const giveChip = page.getByTestId(`bank-give-${give}`)
  const wantChip = page.getByTestId(`bank-get-${want}`)
  await expect(giveChip).toBeEnabled()
  await expect(wantChip, `the bank still stocks ${want}`).toBeEnabled()
  const rate = Number(((await giveChip.textContent()) ?? '').match(/(\d+):1/)![1])
  const before = await readHand(page)
  await giveChip.click()
  await wantChip.click()
  await page.getByTestId('bank-trade-submit').click()
  await expect.poll(async () => (await readHand(page))[give], { timeout: 10_000 }).toBe(before[give] - rate)
  await closeTradePanel(page)
  return { rate, before }
}

/** What a dev card costs, in the order this spec reasons about it. */
const DEV_COST = ['sheep', 'wheat', 'ore'] as const

/**
 * A pile this hand can spare 4 of (the worst bank rate) while keeping one of
 * anything the dev-card cost still needs, or null.
 */
function sparePile(hand: Record<Res, number>, want: Res): Res | null {
  const keep = (r: Res): number => (DEV_COST.includes(r as (typeof DEV_COST)[number]) ? 1 : 0)
  return RESOURCES.find((r) => r !== want && hand[r] >= 4 + keep(r)) ?? null
}

/**
 * Drive until some page can buy a dev card, buying the missing resources off
 * the bank when production alone won't get there.
 *
 * It usually won't: every page's setup placements go to the first legal
 * vertex the dev hook reports, which clusters all three players on one side
 * of the board, and a colour none of those hexes carry then never reaches
 * anyone (at this seed neither wheat nor ore ever does). The pile that grows
 * instead is exactly what the bank tab is for.
 */
async function driveUntilDevCardAffordable(pages: Page[]): Promise<number> {
  for (let round = 0; round < 6; round++) {
    let want: Res = 'wheat'
    let give: Res = 'sheep'
    const idx = await driveUntil(pages, async () => {
      for (let i = 0; i < pages.length; i++) {
        if (await isEnabled(pages[i]!.getByTestId('build-dev'))) return i
        if (!(await isEnabled(pages[i]!.getByTestId('trade-toggle')))) continue
        const hand = await readHand(pages[i]!)
        const missing = DEV_COST.find((r) => hand[r] === 0)
        if (missing === undefined) continue
        const spare = sparePile(hand, missing)
        if (spare === null) continue
        want = missing
        give = spare
        return i
      }
      return -1
    }, 400)
    if (await isEnabled(pages[idx]!.getByTestId('build-dev'))) return idx
    const { rate } = await bankTradeFor(pages[idx]!, give, want)
    console.log(`STOCK P${idx + 1}: ${rate} ${give} → 1 ${want}`)
  }
  throw new Error('driveUntilDevCardAffordable: nobody could afford a dev card after 6 bank trades')
}

test.describe('trade + dev cards', () => {
  test('player trade, bank trade, dev-card buy and play', async ({ browser }) => {
    test.setTimeout(600_000)

    const host = await (await browser.newContext()).newPage()
    const p2 = await (await browser.newContext()).newPage()
    const p3 = await (await browser.newContext()).newPage()
    const pages = [host, p2, p3]

    // A crashed/erroring page wedges its driver silently — surface it.
    for (const [i, page] of pages.entries()) {
      page.on('crash', () => console.log(`CRASH P${i + 1}`))
      page.on('pageerror', (e) => console.log(`PAGEERROR P${i + 1}: ${e.message}`))
      page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning')
          console.log(`CONSOLE P${i + 1} ${msg.type()}: ${msg.text().slice(0, 160)}`)
      })
    }

    // tier=low everywhere: three full boards with N8AO saturate one GPU and
    // starve every page's main thread (see catan.spec.ts). vp=10 is the
    // standard target rather than that spec's fast-finish 4 — these drivers
    // never build, so nobody approaches a win and no accidental win overlay
    // can cut a scenario short.
    await host.goto(`/?seed=${SEED}&vp=10&tier=low`)
    await host.getByTestId('players-3').click()
    await host.getByTestId('create-button').click()
    await expect(host.getByTestId('join-code')).toBeVisible()
    const code = (await host.getByTestId('join-code').textContent())!.trim()
    expect(code).toMatch(/^[A-Z]{4}$/)

    for (const page of [p2, p3]) {
      await page.goto('/?tier=low')
      await page.getByTestId('join-input').fill(code)
      await page.getByTestId('join-button').click()
    }

    // Game auto-starts once all 3 seats fill (CatanRoom.onJoin) — wait for the
    // HUD rather than any lobby text, then for CatanScene's dev hook, which
    // mounts after the <Canvas>'s async WebGL init and so lands later than the
    // plain-DOM turn banner.
    for (const page of pages) {
      await expect(page.getByTestId('turn-banner')).toBeVisible({ timeout: 15_000 })
    }
    for (const page of pages) {
      await page.waitForFunction(() => typeof window.__meridianDebug?.legalTargetsOnScreen === 'function')
    }
    const seats = [await seatOf(host), await seatOf(p2), await seatOf(p3)]
    expect(new Set(seats).size).toBe(3)

    // --- (a) PLAYER TRADE ---------------------------------------------------
    // Wait until the page whose turn it is holds something, and one of the
    // others holds a DIFFERENT resource to trade back (same-for-same is legal
    // but would make the hand deltas cancel out and assert nothing).
    let responderIdx = -1
    let giveR: Res = 'wood'
    let getR: Res = 'brick'
    const offererIdx = await driveUntil(pages, async () => {
      for (let i = 0; i < pages.length; i++) {
        if (!(await isEnabled(pages[i]!.getByTestId('trade-toggle')))) continue
        const oHand = await readHand(pages[i]!)
        const mine = RESOURCES.filter((r) => oHand[r] > 0)
        if (mine.length === 0) continue
        for (let j = 1; j < pages.length; j++) {
          const cand = pages[(i + j) % pages.length]!
          // IncomingOffer hides itself while a forced mode owns the seat, and
          // a responder still owing discards would never see the banner.
          if (await isVisible(cand.getByTestId('discard-submit'))) continue
          const cHand = await readHand(cand)
          const give = mine.find((r) => RESOURCES.some((o) => o !== r && cHand[o] > 0))
          if (give === undefined) continue
          giveR = give
          getR = RESOURCES.find((r) => r !== give && cHand[r] > 0)!
          responderIdx = (i + j) % pages.length
          return i
        }
      }
      return -1
    })
    const offerer = pages[offererIdx]!
    const responder = pages[responderIdx]!
    const oHand = await readHand(offerer)
    const rHand = await readHand(responder)
    console.log(`TRADE offerer=P${offererIdx + 1} gives ${giveR}, responder=P${responderIdx + 1} gives ${getR}`)

    await openTradePanel(offerer, 'players')
    await offerer.getByTestId(`trade-give-plus-${giveR}`).click()
    await offerer.getByTestId(`trade-get-plus-${getR}`).click()
    await offerer.getByTestId('trade-offer-submit').click()

    await expect(responder.getByTestId('offer-banner')).toBeVisible({ timeout: 10_000 })
    await responder.getByTestId('offer-accept').click()
    await expect(offerer.getByTestId('offer-review')).toBeVisible({ timeout: 10_000 })
    // The responder's seat index isn't its page index — click whichever
    // confirm button the accepted response puts on the review panel.
    const confirm = offerer.locator('[data-testid^="confirm-trade-"]').first()
    await expect(confirm).toBeVisible({ timeout: 10_000 })
    await confirm.click()

    // Safe to assert the traded resources exactly: no page ticks between the
    // confirm and here, and the offerer is mid-turn, so no roll can pay
    // anyone out underneath the assertion.
    await expect
      .poll(async () => (await readHand(offerer))[giveR], { timeout: 10_000 })
      .toBe(oHand[giveR] - 1)
    const oAfter = await readHand(offerer)
    expect(oAfter[getR]).toBe(oHand[getR] + 1)
    const rAfter = await readHand(responder)
    expect(rAfter[getR]).toBe(rHand[getR] - 1)
    expect(rAfter[giveR]).toBe(rHand[giveR] + 1)
    await expect(offerer.getByTestId('offer-review')).toBeHidden({ timeout: 10_000 })
    await expect(responder.getByTestId('offer-banner')).toBeHidden({ timeout: 10_000 })
    await closeTradePanel(offerer)

    // --- (b) BANK TRADE -----------------------------------------------------
    // Wait for a current page holding 4 of something: 4 covers every rate the
    // bank tab can offer (4:1, or 3:1/2:1 on a port), so the give button is
    // guaranteed enabled.
    let bankGiveR: Res = 'wood'
    const bankIdx = await driveUntil(pages, async () => {
      for (let i = 0; i < pages.length; i++) {
        if (!(await isEnabled(pages[i]!.getByTestId('trade-toggle')))) continue
        const hand = await readHand(pages[i]!)
        const r = RESOURCES.find((x) => hand[x] >= 4)
        if (r === undefined) continue
        bankGiveR = r
        return i
      }
      return -1
    })
    const trader = pages[bankIdx]!
    await openTradePanel(trader, 'bank')
    const getChip = await firstEnabledTestId(
      trader,
      RESOURCES.filter((r) => r !== bankGiveR).map((r) => `bank-get-${r}`),
    )
    expect(getChip, 'the bank still stocks some other resource').not.toBeNull()
    const bankGetR = getChip!.slice('bank-get-'.length) as Res

    // bankTradeFor asserts the give side (at the rate the chip advertises,
    // which the seat's ports may have discounted) came out of the hand.
    const { rate, before: tBefore } = await bankTradeFor(trader, bankGiveR, bankGetR)
    console.log(`BANK P${bankIdx + 1} traded ${rate} ${bankGiveR} for 1 ${bankGetR}`)
    expect(rate).toBeGreaterThanOrEqual(2)
    expect((await readHand(trader))[bankGetR]).toBe(tBefore[bankGetR] + 1)

    // --- (c) DEV CARD -------------------------------------------------------
    // Buy one, then play it on a later turn. A VP card can never be played, so
    // a first draw of one is retried with a second buy; two VP draws running
    // (the deck holds 5 of 25) settles for having asserted the buys.
    let played = false
    let lastDeck = Number.POSITIVE_INFINITY
    for (let attempt = 1; attempt <= 2 && !played; attempt++) {
      const buyerIdx = await driveUntilDevCardAffordable(pages)
      const buyer = pages[buyerIdx]!
      const witness = pages[(buyerIdx + 1) % pages.length]!
      const buyerSeat = seats[buyerIdx]!
      await closeTradePanel(buyer)
      const buyHand = await readHand(buyer)
      const devBefore = await readOpponentStat(witness, buyerSeat, 'dev')

      await buyer.getByTestId('build-dev').click()

      await expect
        .poll(() => readOpponentStat(witness, buyerSeat, 'dev'), { timeout: 10_000 })
        .toBe(devBefore + 1)
      await expect(buyer.getByTestId('dev-strip')).toBeVisible({ timeout: 10_000 })
      await expect(buyer.getByTestId('dev-strip').locator('.badge-new').first()).toBeVisible()
      const paid = await readHand(buyer)
      for (const r of ['sheep', 'wheat', 'ore'] as const) expect(paid[r]).toBe(buyHand[r] - 1)
      const deck = await readDeckCount(buyer)
      expect(deck).toBeLessThan(lastDeck)
      lastDeck = deck
      console.log(`DEVBUY attempt ${attempt}: P${buyerIdx + 1} bought, ${deck} left in deck`)

      // A card bought this turn is still NEW, so drive on — the buyer's own
      // tick ends its turn — until this page is back on turn in main phase
      // (`end-turn` enabled), by which point every card it holds has matured.
      const endTurnEnabled = async (): Promise<boolean> => isEnabled(buyer.getByTestId('end-turn'))
      await driveUntil(pages, async () => ((await endTurnEnabled()) ? -1 : 0), 50) // this turn ends
      await driveUntil(pages, async () => ((await endTurnEnabled()) ? 0 : -1), 300) // …and comes back round

      const btns = buyer.locator('[data-testid^="dev-play-"]')
      let k = -1
      for (let i = 0, n = await btns.count(); i < n && k < 0; i++) if (await isEnabled(btns.nth(i))) k = i
      if (k < 0) {
        // Same snapshot that enabled END TURN would have enabled any matured
        // non-VP card, so nothing playable means the draw was a VP card.
        const tiles = await buyer
          .locator('[data-testid^="dev-tile-"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
        console.log(`DEVPLAY attempt ${attempt}: nothing playable, strip=${JSON.stringify(tiles)} — buying again`)
        expect(
          tiles.every((t) => t === 'dev-tile-vp'),
          'a non-VP card would have been playable on the buyer’s returning turn',
        ).toBe(true)
        continue
      }

      const playBtn = buyer.locator('[data-testid^="dev-play-"]').nth(k)
      const card = (await playBtn.getAttribute('data-testid'))!.slice('dev-play-'.length)
      const tileBefore = await devTileCount(buyer, card)
      const playHand = await readHand(buyer)
      const knightsBefore = await readOpponentStat(witness, buyerSeat, 'knights')
      const others = pages.filter((_, i) => i !== buyerIdx)
      const otherHands = await Promise.all(others.map((p) => readHand(p)))
      console.log(`DEVPLAY P${buyerIdx + 1} plays ${card}`)
      await playBtn.click()

      if (card === 'knight') {
        await expect
          .poll(() => readOpponentStat(witness, buyerSeat, 'knights'), { timeout: 10_000 })
          .toBe(knightsBefore + 1)
        // The snapshot forces robber mode; resolve it (hex pick, then a steal
        // victim if the hex has any) the same way passiveTick would.
        await expect.poll(() => modeOf(buyer), { timeout: 10_000 }).toBe('robber')
        const backToMain = await drive(
          [buyer],
          async () => ((await isEnabled(buyer.getByTestId('end-turn'))) ? 0 : -1),
          60,
        )
        expect(backToMain, 'the knight robber flow returned to the main phase').toBeGreaterThanOrEqual(0)
      } else if (card === 'roadBuilding') {
        // Staged board mode: each canvas edge click stages a road, the last
        // one sends the play.
        const placed = await drive([buyer], async () => ((await modeOf(buyer)) === 'roadBuilding' ? -1 : 0), 40)
        if (placed < 0) await buyer.keyboard.press('Escape') // leave no page wedged in the mode
        expect(placed, 'both road-building roads went down').toBeGreaterThanOrEqual(0)
      } else if (card === 'yearOfPlenty') {
        await expect(buyer.getByTestId('plenty-submit')).toBeVisible({ timeout: 10_000 })
        for (let pick = 0; pick < 2; pick++) {
          const plus = await firstEnabledTestId(buyer, RESOURCES.map((r) => `plenty-plus-${r}`))
          expect(plus, 'the bank can cover a Year of Plenty pick').not.toBeNull()
          await buyer.getByTestId(plus!).click()
        }
        await buyer.getByTestId('plenty-submit').click()
        await expect
          .poll(async () => handTotal(await readHand(buyer)), { timeout: 10_000 })
          .toBe(handTotal(playHand) + 2)
      } else if (card === 'monopoly') {
        // Name whatever the other two hold most of, so the haul is worth
        // asserting: every copy of it must cross the table.
        const held = (r: Res): number => otherHands.reduce((n, h) => n + h[r], 0)
        const pick = RESOURCES.reduce((best, r) => (held(r) > held(best) ? r : best), RESOURCES[0])
        const hauled = held(pick)
        await expect(buyer.getByTestId(`monopoly-pick-${pick}`)).toBeVisible({ timeout: 10_000 })
        await buyer.getByTestId(`monopoly-pick-${pick}`).click()
        await expect(buyer.getByTestId(`monopoly-pick-${pick}`)).toBeHidden({ timeout: 10_000 })
        await expect
          .poll(async () => (await readHand(buyer))[pick], { timeout: 10_000 })
          .toBe(playHand[pick] + hauled)
        for (const other of others) expect((await readHand(other))[pick]).toBe(0)
      } else {
        throw new Error(`unexpected playable dev card: ${card}`)
      }

      // Whatever it was, the server took the copy out of the hand.
      await expect.poll(() => devTileCount(buyer, card), { timeout: 15_000 }).toBe(tileBefore - 1)
      played = true
    }
    if (!played) console.log('DEVPLAY: no card became playable across two buys — asserted the buys only')
  })
})
