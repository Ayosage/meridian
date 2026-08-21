// Companion bots for a live meridian Catan match: join a room by code and
// play through the real UI (same driver helpers as the E2E specs — see
// e2e/driver.mjs). Competent-greedy, not just legal: pip-weighted setup and
// build placement, dev-card buys and plays, trade responses (the server
// pilot's accept rule as the floor), bank-trading surplus toward the current
// build goal, and robber moves that hunt the score leader.
//
// Usage: node tools/bots.mjs <ROOMCODE> [botCount=2]   (run from apps/client)
// BOT_TICK_MS=150 speeds the pacing up (default 700ms/action so a human can
// follow along).
import { chromium } from '@playwright/test'
import {
  clearPointIndex,
  driveDiscard,
  isEnabled,
  isVisible,
  RESOURCES,
  tryClick,
} from '../e2e/driver.mjs'

const code = process.argv[2]?.toUpperCase()
const botCount = Number(process.argv[3] ?? 2)
if (!code || !/^[A-Z]{4}$/.test(code)) {
  console.error('usage: node tools/bots.mjs <4-letter room code> [botCount]')
  process.exit(1)
}
const TICK_MS = Number(process.env['BOT_TICK_MS'] ?? 700)

// Mirrors @meridian/rules' COSTS (packages/rules/src/catan/data.ts) — not
// imported for the same native-ESM reason driver.mjs inlines RESOURCES.
const COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  devCard: { sheep: 1, wheat: 1, ore: 1 },
}

/** Same target attempted this many times in one mode → treat it as wedged (HUD-occluded, 3D-occluded, …) and move on. */
const STALL_LIMIT = 3

// --- pure heuristics over the redacted view (from the catanView dev hook) ---

/** Production weight of a number token: ways to roll it (6/8 → 5 … 2/12 → 1; desert 0). */
function pips(token) {
  return token == null ? 0 : 6 - Math.abs(7 - token)
}

/** coordKey -> pip weight for every land hex. */
function hexPipMap(view) {
  const map = new Map()
  for (const h of view.board.hexes) map.set(`${h.coord.q},${h.coord.r}`, pips(h.token))
  return map
}

/** Total pips a vertex touches. Vertex ids are the sorted coordKeys of their 3 hexes ('a|b|c') — off-board keys just miss the map. */
function vertexPips(view, vertexId, pipMap = hexPipMap(view)) {
  let sum = 0
  for (const part of vertexId.split('|')) sum += pipMap.get(part) ?? 0
  return sum
}

/** Public victory points (buildings + road/army awards) — what every seat can see. */
function publicVp(view, player) {
  let vp = 0
  for (const b of Object.values(view.buildings)) {
    if (b.owner === player) vp += b.kind === 'city' ? 2 : 1
  }
  if (view.awards.longestRoad === player) vp += 2
  if (view.awards.largestArmy === player) vp += 2
  return vp
}

/**
 * Robber destination score: block the biggest production owned by the seats
 * furthest ahead, never our own. 0 for untouched hexes; heavily negative if
 * we produce there ourselves.
 */
function robberHexScore(view, seat, hexKey, pipMap) {
  let owners = 0
  for (const [vid, b] of Object.entries(view.buildings)) {
    if (!vid.split('|').includes(hexKey)) continue
    if (b.owner === seat) return -1000
    owners += (b.kind === 'city' ? 2 : 1) * (1 + publicVp(view, b.owner))
  }
  return owners * (1 + (pipMap.get(hexKey) ?? 0))
}

function totalOf(partial) {
  return Object.values(partial).reduce((n, v) => n + v, 0)
}

function hasAll(hand, partial) {
  return Object.entries(partial).every(([r, n]) => (hand[r] ?? 0) >= n)
}

/** What to save toward: city upgrade > new settlement > dev card > road. */
function buildGoal(view, seat) {
  const me = view.players[seat]
  const upgradable = Object.values(view.buildings).some((b) => b.owner === seat && b.kind === 'settlement')
  if (me.citiesLeft > 0 && upgradable) return 'city'
  if (me.settlementsLeft > 0) return 'settlement'
  if (view.devDeckCount > 0) return 'devCard'
  return 'road'
}

/** Resources still missing for the goal, biggest deficit first. */
function missingFor(view, seat, goal = buildGoal(view, seat)) {
  const cost = COSTS[goal]
  const hand = view.you.resources
  return RESOURCES.filter((r) => (cost[r] ?? 0) > hand[r]).sort(
    (a, b) => cost[b] - hand[b] - (cost[a] - hand[a]),
  )
}

/**
 * Give 4-of-a-kind surplus (beyond the goal's own cost) for the goal's
 * biggest deficit. 4 is the worst-case bank rate, so the give chip is always
 * enabled; port rates (3:1/2:1) still apply automatically — the UI charges
 * whatever the seat's real rate is.
 */
function bankTradePlan(view, seat) {
  const goal = buildGoal(view, seat)
  const cost = COSTS[goal]
  const hand = view.you.resources
  const get = missingFor(view, seat, goal)[0]
  if (!get || (view.bank[get] ?? 0) < 1) return null
  let give = null
  for (const r of RESOURCES) {
    if (r === get) continue
    const surplus = hand[r] - (cost[r] ?? 0)
    if (surplus >= 4 && (give === null || surplus > hand[give] - (cost[give] ?? 0))) give = r
  }
  return give ? { give, get } : null
}

/**
 * The server pilot's accept rule as the floor (apps/server/src/pilot.ts):
 * accept only a trade we can cover that never loses net cards; anything else
 * is declined (companions don't counter). null when there's nothing to answer.
 */
function offerResponse(view, seat) {
  const offer = view.turn.openTrade
  if (!offer || view.turn.current === seat) return null
  if (offer.responses[seat] !== undefined) return null
  const youGive = offer.get
  const youGet = offer.give
  const favorable = hasAll(view.you.resources, youGive) && totalOf(youGet) >= totalOf(youGive)
  return favorable ? 'accept' : 'decline'
}

/** Two Year-of-Plenty picks: the goal's deficits first, ore as the fallback. */
function plentyPicks(view, seat) {
  const cost = COSTS[buildGoal(view, seat)]
  const hand = view.you.resources
  const picks = []
  for (const r of RESOURCES) {
    for (let n = hand[r]; n < (cost[r] ?? 0) && picks.length < 2; n++) picks.push(r)
  }
  while (picks.length < 2) picks.push('ore')
  return picks
}

// --- driving one page --------------------------------------------------------

/** Per-bot driver state: stall bookkeeping and the per-turn bank-trade cap. */
function newBot(label) {
  return { label, attempts: new Map(), avoidModes: new Set(), lastMode: '', turnNumber: -1, bankTrades: 0 }
}

function log(bot, message) {
  console.log(`${bot.label}: ${message}`)
}

/** The current { view, seat } snapshot, or null before the scene mounts. */
async function readSnap(page) {
  const snap = await page
    .evaluate(() => window.__meridianDebug?.catanView?.())
    .catch(() => undefined)
  return snap && snap.view && snap.seat !== null ? snap : null
}

/**
 * Score + click the best legal target for the mode: pip-weighted vertices for
 * settlements/cities, leader-hunting hexes for the robber, first-legal edges
 * for roads. Prefers a target no HUD panel covers (e2e/driver.mjs's
 * elementFromPoint filter), and skips targets already attempted STALL_LIMIT
 * times — the stall detector for clicks that keep landing on nothing.
 * Returns a description, or null when every target is stalled.
 */
async function clickBestTarget(page, bot, mode, targets, snap) {
  let scored = targets.map((t) => ({ t, score: 0 }))
  let note = ''
  if (snap) {
    const pipMap = hexPipMap(snap.view)
    if (mode === 'placeSettlement' || mode === 'placeCity') {
      scored = targets.map((t) => ({ t, score: vertexPips(snap.view, t.id, pipMap) }))
    } else if (mode === 'robber') {
      scored = targets
        .filter((t) => t.kind === 'hex')
        .map((t) => ({ t, score: robberHexScore(snap.view, snap.seat, t.id, pipMap) }))
    }
  }
  scored.sort((a, b) => b.score - a.score)
  let ordered = scored.map((s) => s.t)
  const fresh = ordered.filter((t) => (bot.attempts.get(`${mode}:${t.id}`) ?? 0) < STALL_LIMIT)
  if (fresh.length === 0) return null
  ordered = fresh
  const clearIdx = await clearPointIndex(
    page,
    ordered.map((t) => ({ x: t.x, y: t.y })),
  )
  const target = ordered[clearIdx >= 0 ? clearIdx : 0]
  const key = `${mode}:${target.id}`
  bot.attempts.set(key, (bot.attempts.get(key) ?? 0) + 1)
  if (mode === 'placeSettlement' || mode === 'placeCity')
    note = ` (${scored.find((s) => s.t === target)?.score ?? 0} pips)`
  if (mode === 'robber') note = ` (${target.id})`
  await page.mouse.click(target.x, target.y)
  return `target:${mode}${note}`
}

/** Drive the Year of Plenty modal: stage the goal's deficits, top up with whatever the bank still has, submit (cancel if the bank is bare). */
async function drivePlenty(page, snap) {
  const submit = page.getByTestId('plenty-submit')
  const picks = snap ? plentyPicks(snap.view, snap.seat) : ['wheat', 'ore']
  for (const r of picks) await tryClick(page.getByTestId(`plenty-plus-${r}`))
  for (const r of RESOURCES) {
    if (await isEnabled(submit)) break
    while (!(await isEnabled(submit)) && (await isEnabled(page.getByTestId(`plenty-plus-${r}`)))) {
      if (!(await tryClick(page.getByTestId(`plenty-plus-${r}`)))) break
    }
  }
  if (await isEnabled(submit)) return (await tryClick(submit)) ? 'plenty' : false
  await tryClick(page.getByTestId('plenty-cancel'))
  return 'plenty-cancel'
}

/** One bank trade through the docked panel; always closes the panel again so it doesn't sit over the board. */
async function driveBankTrade(page, plan) {
  if (!(await isVisible(page.getByTestId('trade-panel')))) {
    const toggle = page.getByTestId('trade-toggle')
    if (!(await isEnabled(toggle)) || !(await tryClick(toggle))) return false
  }
  const ok =
    (await tryClick(page.getByTestId('trade-tab-bank'))) &&
    (await isEnabled(page.getByTestId(`bank-give-${plan.give}`))) &&
    (await tryClick(page.getByTestId(`bank-give-${plan.give}`))) &&
    (await isEnabled(page.getByTestId(`bank-get-${plan.get}`))) &&
    (await tryClick(page.getByTestId(`bank-get-${plan.get}`))) &&
    (await isEnabled(page.getByTestId('bank-trade-submit'))) &&
    (await tryClick(page.getByTestId('bank-trade-submit')))
  await tryClick(page.getByTestId('trade-close'))
  return ok
}

/**
 * One decision for one page. Engine-bot priorities (city > settlement > dev
 * buy > dev play > road > end; see @meridian/rules' botIntent) driven through
 * real UI clicks, plus what that bot never did: answer trade offers, drive
 * the dev-card modals, and bank-trade surplus. Returns the action taken
 * ('over' at the win overlay; false if nothing was actionable this tick).
 */
async function tick(page, bot) {
  if (await isVisible(page.getByTestId('win-overlay'))) return 'over'

  if (await isVisible(page.getByTestId('discard-submit'))) {
    await driveDiscard(page)
    return 'discard'
  }

  const snap = await readSnap(page)

  // per-turn state resets once the turn counter moves
  const turnNumber = snap?.view.turn.number ?? -1
  if (turnNumber !== bot.turnNumber) {
    bot.turnNumber = turnNumber
    bot.avoidModes.clear()
    bot.bankTrades = 0
  }

  // steal chooser: rob the victim with the most public points
  const stealButtons = page.locator('[data-testid^="steal-victim-"]')
  if (await isVisible(stealButtons.first())) {
    let victim = null
    if (snap) {
      const count = await stealButtons.count().catch(() => 0)
      const victims = []
      for (let i = 0; i < count; i++) {
        const id = await stealButtons.nth(i).getAttribute('data-testid').catch(() => null)
        if (id) victims.push(Number(id.slice('steal-victim-'.length)))
      }
      victims.sort((a, b) => publicVp(snap.view, b) - publicVp(snap.view, a))
      victim = victims[0] ?? null
    }
    const button = victim === null ? stealButtons.first() : page.getByTestId(`steal-victim-${victim}`)
    return (await tryClick(button)) ? `steal:${victim ?? 'first'}` : false
  }

  // dev-card modals left open by a play on an earlier tick
  if (await isVisible(page.getByTestId('plenty-submit'))) return drivePlenty(page, snap)
  if (await isVisible(page.getByTestId('monopoly-pick-wheat'))) {
    const pick = snap ? (missingFor(snap.view, snap.seat)[0] ?? 'wheat') : 'wheat'
    return (await tryClick(page.getByTestId(`monopoly-pick-${pick}`))) ? `monopoly:${pick}` : false
  }

  // incoming trade offer: the pilot's accept rule as the floor
  if (snap && (await isVisible(page.getByTestId('offer-accept')))) {
    const response = offerResponse(snap.view, snap.seat)
    if (response) {
      return (await tryClick(page.getByTestId(`offer-${response}`))) ? `offer-${response}` : false
    }
  }

  const state = await page
    .evaluate(() => window.__meridianDebug?.legalTargetsOnScreen?.())
    .catch(() => undefined)
  if (!state) return false
  if (state.mode !== bot.lastMode) {
    bot.lastMode = state.mode
    bot.attempts.clear()
  }

  const placementIds = {
    placeCity: 'build-city',
    placeSettlement: 'build-settlement',
    placeRoad: 'build-road',
  }

  if (state.targets.length > 0) {
    const acted = await clickBestTarget(page, bot, state.mode, state.targets, snap)
    if (acted) return acted
    // Every target stalled out. A voluntary placement gets untoggled and shelved
    // for the rest of the turn; a forced mode has to keep probing — reset the
    // counters and let the clear-filter try again next tick.
    const buildId = placementIds[state.mode]
    const btn = buildId ? page.getByTestId(buildId) : null
    if (btn && (await isEnabled(btn)) && (await tryClick(btn))) {
      bot.avoidModes.add(state.mode)
      bot.attempts.clear()
      return `stalled-untoggle:${state.mode}`
    }
    bot.attempts.clear()
    return false
  }
  if (state.mode in placementIds) {
    // A placement mode with nothing legal in it — untoggle if the button is
    // clickable; a forced setup mode clears itself on the next snapshot.
    const btn = page.getByTestId(placementIds[state.mode])
    if ((await isEnabled(btn)) && (await tryClick(btn))) return `untoggle:${state.mode}`
    return false
  }

  const roll = page.getByTestId('roll-button')
  if (await isEnabled(roll)) return (await tryClick(roll)) ? 'roll' : false

  // main phase, engine-bot order: city > settlement > dev buy > dev play > road
  for (const [modeKind, testId] of [
    ['placeCity', 'build-city'],
    ['placeSettlement', 'build-settlement'],
  ]) {
    if (bot.avoidModes.has(modeKind)) continue
    const btn = page.getByTestId(testId)
    if (!(await isEnabled(btn))) continue
    if (!(await tryClick(btn))) continue
    const probe = await page.evaluate(() => window.__meridianDebug.legalTargetsOnScreen())
    if (probe.targets.length > 0) return `enter:${testId}` // next tick clicks the best one
    await tryClick(btn) // affordable but nowhere legal — untoggle and move on
  }

  if (await isEnabled(page.getByTestId('build-dev'))) {
    return (await tryClick(page.getByTestId('build-dev'))) ? 'buy-dev' : false
  }
  for (const card of ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly']) {
    const btn = page.getByTestId(`dev-play-${card}`)
    if (await isEnabled(btn)) {
      if (await tryClick(btn)) return `play-${card}` // robber/staged mode/modal drives next tick
    }
  }

  if (!bot.avoidModes.has('placeRoad')) {
    const btn = page.getByTestId('build-road')
    if ((await isEnabled(btn)) && (await tryClick(btn))) {
      const probe = await page.evaluate(() => window.__meridianDebug.legalTargetsOnScreen())
      if (probe.targets.length > 0) return 'enter:build-road'
      await tryClick(btn)
    }
  }

  // nothing buildable: bank-trade surplus toward the goal (capped per turn so
  // a shifting goal can't ping-pong trades forever)
  if (snap && bot.bankTrades < 2 && snap.view.turn.phase === 'main' && !snap.view.turn.openTrade) {
    const plan = bankTradePlan(snap.view, snap.seat)
    if (plan && (await driveBankTrade(page, plan))) {
      bot.bankTrades++
      return `bank-trade:${plan.give}->${plan.get}`
    }
  }

  const endTurn = page.getByTestId('end-turn')
  if (await isEnabled(endTurn)) return (await tryClick(endTurn)) ? 'end-turn' : false

  return false
}

// --- join + run --------------------------------------------------------------

const QUIET_ACTIONS = new Set(['roll', 'end-turn', 'discard'])

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] })
const bots = []
for (let i = 0; i < botCount; i++) {
  const page = await (await browser.newContext()).newPage()
  await page.goto('http://localhost:5173/?tier=low')
  await page.getByTestId('join-input').fill(code)
  await page.getByTestId('join-button').click()
  console.log(`bot ${i + 1} joined room ${code}`)
  bots.push({ page, bot: newBot(`bot ${i + 1}`) })
}

console.log('waiting for the match to start (fills when every seat is taken)...')
await Promise.all(
  bots.map(({ page }) =>
    page.waitForFunction(() => typeof window.__meridianDebug?.legalTargetsOnScreen === 'function', null, {
      timeout: 0,
    }),
  ),
)
console.log('match started — bots are playing. Ctrl+C to stop them.')

// Human-ish pacing: one decision per bot every ~700ms (BOT_TICK_MS to change).
await Promise.all(
  bots.map(async ({ page, bot }) => {
    for (;;) {
      const result = await tick(page, bot).catch(() => false)
      if (result === 'over') {
        log(bot, 'match over')
        return
      }
      if (result && !QUIET_ACTIONS.has(result)) log(bot, result)
      await page.waitForTimeout(result ? TICK_MS : Math.max(150, TICK_MS / 3))
    }
  }),
)
await browser.close()
console.log('done — win overlay reached.')
