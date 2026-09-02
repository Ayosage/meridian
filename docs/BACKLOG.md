# Backlog

Items from live playtesting (first human 4-player match vs bots, 2026-08-19).
Verified on the `/board` preview where noted.

## Board/asset fixes (phase 6 polish, or earlier if quick)

- **Roll/END TURN button overlap — shipped with phase 5.** Fixed in
  `hud.css` (roll button `right: 132px`); no longer an issue as of the
  trade/dev-card UX merge.
- **Fixed camera + corner HUD panels (build bar, trade panel, dev strip) can
  cover board vertices at 1280x720 — DONE (2026-08-24).** Orbit always
  worked (drei `OrbitControls` was already wired up); the real gap was
  discoverability — nothing told a human player they could drag to rotate
  the camera off an occluded vertex. Added `orbit-hint` HUD text ("drag to
  rotate · scroll to zoom"). Proven by `e2e/orbit.spec.ts` (drag-orbit clears
  an occluded vertex and the click lands) and re-verified live in the native-
  bots sweep below (orbit-then-click exercised on every run, screenshots
  `vp4-run4-final-03-orbit-before.png` / `-04-orbit-after.png`).
- **Roads don't always align with their hex edge — DONE (2026-08-21).**
  Root cause: `edgeWorld()` in `catanLayout.ts` used `atan2(z, x) + π/2`,
  but a three.js Y-rotation maps local +X to `(cos a, −sin a)` — the XZ
  atan2 convention is mirrored, so only one of the three edge orientation
  classes aligned (the one the old unit test happened to check); the others
  sat 30°/60° off. Fixed to `atan2(x, z)`; also corrects the legal-edge
  pulse bars in `Highlights.tsx`. Regression test now asserts the rotated
  road axis is parallel to the true vertex-to-vertex edge for all six
  directions (`test/catanLayout.test.ts`).
- **Number tokens hidden by terrain on mountain (and forest) tiles —
  DONE (2026-08-21).** Every terrain now models two reserved pads on the
  tile's camera-facing apron: `pad_token_*` at local three-space
  `(-0.3, y, 0.42)` and `pad_robber_*` at `(0.3, y, 0.42)` (desert:
  robber pad only). Dressing carved out of both zones; mountains massif
  moved back into a ridge, hills upper tiers shifted behind the pads.
  Client `TOKEN_SPOT`/`ROBBER_SPOT` in `CatanBoard.tsx` carry the measured
  per-terrain pad heights; forest/pasture ground-only cloning now includes
  the pad nodes.
- **Robber placement is invisible after moving — DONE (2026-08-21).**
  Robber re-modeled as a bolder hooded figure (0.18 wide vs the old 0.10
  peg, shoulder + hood silhouette) and placed on the reserved robber pad
  instead of tile center.
- **Token numerals too thin — DONE (2026-08-21).** Numerals regenerated in
  Arial Black, extruded 12mm proud of the disc (≥5mm z-fight constraint
  kept), bolder pips, red ink on 6/8, vertex-colored cream/ink like the
  rest of the set.

## Companion bots (upgrade pass — competent bots to play against)

- **Bots wedge on HUD-occluded board targets.** Observed live (2026-08-21):
  a companion bot stuck re-clicking a legal vertex hidden behind the wider
  5-button build bar — the same occlusion class the phase-5 E2E hit. Port
  the E2E driver's `elementFromPoint` clear-target filter (see
  `e2e/catan.spec.ts` `clickFirstLegalTarget`) into the bot driver, plus a
  stall detector (same target N ticks running → skip it or re-probe).
- **Promote `bots.local.mjs` from untracked local script to a maintained
  tool.** Commit it (e.g. `apps/client/tools/bots.mjs`), share the driver
  helpers with the E2E specs instead of a third hand-rolled copy, and give
  it a README line (`node tools/bots.mjs <CODE> [count]`).
- **Make the bots competent, not just legal.** Today they greedy-click the
  first legal target and ignore phase-5 features entirely. Wishlist:
  placement heuristics (pip-weighted setup instead of first-legal vertex),
  buy + play dev cards, respond to trade offers (reuse the server pilot's
  accept rule as a floor), bank-trade surplus toward what they can build,
  and robber targeting that picks the leader instead of the first hex.
  **Update (2026-08-24):** the brain now lives server-side in `@meridian/
  rules`' `companionIntent` (native bots — no more client-driven
  `bots.local.mjs`/`tools/bots.mjs` puppeteering). It responds to trade
  offers and, per the sweep below, proposes them too. Placement heuristics,
  dev-card play, and leader-targeted robber placement are unverified either
  way this session — still open wishlist items, just narrower ones now that
  the offer/response loop is confirmed working.

## HUD/UX issues (live playtest 2026-08-21, human vs upgraded bots)

- **No incoming-trade UI for the receiving player — RESOLVED (2026-08-22,
  PR #7).** Misdiagnosed: `IncomingOffer.tsx` existed, was mounted, and the
  server sends `openTrade` to every seat. It was unreadable, not missing —
  see the contrast item below — and the bots never *propose* trades, so no
  offer ever reached the human to begin with. The responder flow (banner →
  accept/counter/decline) is E2E- and screenshot-verified working.
- **Own victory points aren't visible anywhere — DONE (2026-08-22, PR #7).**
  `PlayerStrip` (was `OpponentStrip`) renders every seat; the self card
  shows TRUE VP (public + hidden VP dev cards from `view.you.devCards`).
  `hudLogic.ts` `playerCards()` is the tested model builder.
- **Local player should have a card in the top-right player strip — DONE
  (2026-08-22, PR #7).** Visually distinct "You" card, seat order kept;
  E2E `seatOf()` unaffected (self card uses `player-you`, not `opponent-N`).
- **Player cards lack seat colors — DONE (2026-08-22, PR #7).**
  `SEAT_COLORS`/`seatColor` promoted from `Pieces.tsx` to `palette.ts`;
  cards carry a swatch + seat-colored left border.
- **Trade UI renders black text on a black background — DONE (2026-08-22,
  PR #7).** Root cause: no global stylesheet, so fixed panels mounted
  outside `.overlay` inherited browser-default black text. `.trade-panel`,
  `.offer-banner`, and `.dev-strip` (same latent bug) now set their own
  color/font. This was also why the offer banner read as "missing".
- **Bots never propose player trades — DONE (2026-08-24).** Root cause: the
  bots were an external client-side puppeteer (`apps/client/tools/bots.mjs`)
  that only ever responded, never initiated. Superseded by native
  server-side bots (`companionIntent` in `@meridian/rules`) that do propose —
  the `tools/bots.mjs` item is closed as moot (the file itself is still on
  disk, unused by any match now that bots live server-side; candidate for
  deletion, not yet done). The responder UI (offer banner →
  accept/counter/decline) is now exercised in every match, not just an E2E
  fixture: the native-bots sweep below hit live bot-initiated offers and
  drove accept, decline, and counter against real bot responses.
- **Placeholder: more playtest findings expected.** This was one match;
  do a deliberate sweep next session (user: "probably a few other
  things") and extend this list.

## Native-bots sweep (2026-08-24)

Deliberate playtest sweep of the native-bots branch: one real human seat
(seat 0) driven through the actual UI via a scripted Playwright session
(`.superpowers/sdd/2026-08-24-native-bots-orbit/sweep/`, not committed)
against 3 server-side companion bots. Four attempts total — the first two
each hit an infrastructure snag unrelated to the product; the second two
(foreground, `caffeinate -i`, direct binary invocation) completed cleanly.
See task-9-report.md for the full narrative and screenshot inventory.

**Exercised and verified working, no console/page errors in any run:**
lobby → instant solo create (4p/3-bots), full setup placement, roll,
orbit-then-click (drag-orbit clears a HUD-occluded vertex, click lands —
first action taken in three of the four runs, before setup even),
human-initiated trade proposal → live bot response → confirm, and — the
headline result — **bot-initiated trade offers**, arriving as the
`offer-banner` and driven through all three responses against real bot
offers: accept, decline, and counter, each confirmed via the HUD (no
scripted/synthetic offers involved).

**Not exercised this session (budget-limited, not known-broken) — carried
forward as open items:**
- Robber flow (discard on 7, steal chooser) — no natural 7 landed within
  any run's turn budget.
- Dev-card buy/play — hands never accumulated the 3-resource cost within
  budget; the "wishlist" companion-bots item above already tracks whether
  bots themselves buy/play dev cards, still unverified either way.
- Win overlay — no run reached target VP; see the pacing finding below.

**Finding: a bot's turn takes multiple real-world minutes at production
pacing.** In both clean runs, once the human ended a turn the match went
idle (banner frozen on the same bot's name) for the rest of the budget —
150s+ and 190s+ respectively, well past a single `botDelayMs=900` action.
Not diagnosed further this session (could be turn-count, could be a stall);
worth a focused look before this reads as normal pacing to real players —
a human partner would be waiting minutes per bot turn in a real match.
**— RESOLVED (2026-08-25).** Root cause: offer window idle 10s after every seat answered; fix: resolve offer once last seat answers (a37bc21); turn time improved 6.1s→4.4s.

**Finding (blocks a clean "E2E all green"): `e2e/bots.spec.ts`'s solo-match
test is flaky, not just slow — 4 of 5 runs during this session's
verification pass failed the same way.** `solo 4p match vs 3 bots: instant
start, bots play setup, a human turn arrives` waits up to 30s for the 3 bot
seats to each place their first setup settlement
(`Object.keys(view.buildings).length >= 4`); it usually times out. Repro'd
both inside the full `pnpm -C apps/client test:e2e` run (fresh servers,
5 workers) and in total isolation (`--workers=1 -g "solo 4p"`, no other
tests running) — so it's not purely GPU/worker contention from the other
heavy 3-browser specs. Nominal pacing (3 bots × 1 setup action ×
`botDelayMs=900`) is ~2.7s, comfortably inside the 30s budget, so *some*
runs pass quickly — the failures are the anomaly, not the norm-case timing.
Likely related to the pacing finding above (same "bot action fires late"
symptom, different phase). One lead chased and ruled out this session:
`CatanRoom` never calls `room.setSimulationInterval(...)`, so its
`this.clock.setTimeout` bot-delay timers depend on the Colyseus room's
default patch-broadcast loop to tick the clock (`Room.broadcastPatch()` →
`clock.tick()` when no simulation interval is set) — but that loop runs
every `patchRate` (default 50ms), which should keep 900ms timers accurate
to well under a second, not tens of seconds; doesn't explain a 30s stall on
its own. `companionIntent`'s `setup` case (`packages/rules/src/catan/
companion.ts:204-212`) is deterministic and always returns a placement
intent for a bot's own setup turn — no null/no-op path that would stall the
`schedulePilot` timer chain. Needs a dedicated instrumented run (server-side
logging around `schedulePilot`/`drivenIntent` timing) to pin down whether
bot timers are actually firing late or the intent itself is silently
rejected by `applyAndBroadcast`. Not fixed this session — out of scope for
a playtest sweep and too load-bearing to touch right before the whole-branch
review.
**— RESOLVED (2026-08-25).** Root cause: stale dev servers silently reused by Playwright across worktrees; fix: suite starts its own servers, no reuse (dcd95d8); test passes 11/11 on clean runs.

**Finding: a transient `window.__meridianDebug` dropout crashed the first
sweep attempt.** ~15.6 minutes into a `vp=10` run, a `page.evaluate` call
threw `TypeError: Cannot read properties of undefined (reading
'legalTargetsOnScreen')` — the debug hook was briefly gone, most likely a
WebGL context hiccup remounting `CatanScene`'s effect during the long idle
stretch above (see the pacing finding — same conditions). This is sweep
*tooling* fragility, not a product bug: the script now treats a tick
exception as a recovered no-op (matches `driver.mjs`'s own
isEnabled/isVisible/tryClick philosophy) rather than crashing the run. Zero
console or page errors were observed on the client itself across any of the
four attempts.

**New items found during the sweep, not fixed here (final review is next):**
- `apps/client/e2e/match.spec.ts` is a defunct pre-Catan milestone-1 spec —
  it drives a `status`/`winner-banner`/`worldToScreen` UI that no longer
  exists (superseded by the Catan HUD's `turn-banner`/`win-overlay`/
  `legalTargetsOnScreen`). It fails structurally, not from a regression.
  Delete or rewrite as a Catan-era smoke test.
- `apps/client/src/ui/Hud.tsx` has zero importers (`App.tsx` renders
  `CatanHud`, not `Hud`) — dead code, candidate for deletion.
- `apps/client/tools/bots.mjs` (the old client-side puppeteer bot driver) is
  now unused by any real match now that bots run server-side — see the
  "Bots never propose player trades" closure above. Not deleted this
  session; candidate for removal alongside the `match.spec.ts` cleanup.

## Infra / follow-ups from the mute-toggle task (2026-08-25)

- **Dev-server port collision footgun.** Fixed ports (5173 client, 2567
  server) mean an agent's E2E run and a human's own `pnpm dev` fight over
  the same ports (user hit `EADDRINUSE` plus a mid-game server loss on
  2026-08-25). Consider env-var port overrides (`PORT`; client-side
  `VITE_SERVER_URL` already exists) so an E2E run and a human playtester can
  coexist on the same machine. Note `reuseExistingServer: false` (commit
  `dcd95d8`) already turned the collision loud (a failed launch) instead of
  silent (an E2E run quietly reusing, and interfering with, someone else's
  server) — that's progress, but doesn't free up the port itself.
- **Server-side room-state persistence.** Reconnection today survives a
  *client* drop (via `allowReconnection` + in-memory `game` state) but not a
  *server* restart — a deploy or crash mid-match loses every room outright.
  Colyseus has hooks for this (e.g. persisting `CatanState` on an interval
  or on `onLeave`/`onDispose`, replaying it in `onCreate`/reconnect); a
  meaningful future feature, not attempted here.

## Delta-review follow-ups (2026-08-25, pre-merge triage)

- **Event-redaction leak-replay test — DONE (2026-09-02).**
  `redactEventForSeat` is fail-open (strips known secrets, passes the rest);
  `apps/server/test/events-redact-replay.test.ts` is the fail-closed
  backstop: a per-kind bystander whitelist (`BYSTANDER_FIELDS`) is the source
  of truth, so a new event kind or field fails the suite until it is
  consciously ruled public. Replays the scripted-bot 4-seat games (seeds
  1-3) plus companion-brain games at 4 seats (seeds 1-3) and 8 seats (seed
  1, radius-3 board) via `simulateCompanionGame` (promoted from
  `companion.test.ts` into `@meridian/rules`' `test-support.ts`), and
  asserts every whitelisted kind was actually emitted — all 16 are. No leak
  found; a mutation that stops stripping `stolen` fails both tests.
- Action-log entry keys change wholesale as the log grows (cosmetic
  unmount/remount churn); a monotonic event id in the store would fix.
- ~~`events.ts` roll comment overstates coverage~~ (2026-08-26: bank-shortage
  non-payouts now explained via the roll `denied` field; see Bugs below).
- Port boats + sign content rebuild on each robber move (`board` identity
  re-mint); keying Ports on `board.ports` would drop even that.
- Reconnect carries no event backfill — log gaps silently (fine for an
  ephemeral ticker; revisit only if the log gains persistence).
- ~~Companion rules test prints its robber tally table on every suite run~~
  (2026-09-02: already opt-in since `23e7030` — printed only under
  `ROBBER_TALLY=1`; verified silent on a plain `pnpm test`).





### Bugs ###

## no production on roll - wheat - 8 

**DIAGNOSED (2026-08-25): not a bug — the bank-shortage rule, invisibly.**
All three examples are the multi-claimant bank-shortage wipe (spec §2: bank
can't cover a resource + 2+ players owed it → NOBODY gets it). Signature in
every example: the previous 8 pays several players at once (example 3 moves
9 wheat of the 19-card supply in one roll), then the next 8's identical
multi-claimant demand exceeds what's left and pays nothing. No robber events
between the paying and silent rolls in any example. The payout engine was
fuzz-verified this session: ~16k rolls across 1,500 random states (scarce
banks, robber, cities) match an independent payout model exactly.
**FIXED (2026-08-26):** (1) roll events now carry `denied` (rules'
`productionDenied`, whitelisted public in the redact-replay guard) and the
log line reads "rolled 8 — [wheat] exhausted — nobody paid"; (2) HandStrip
shows the bank's stock as a dim second line under each resource.
Cosmetic trailing "·" from example 2's paste: code review found no path to a
dangling separator in the rendered DOM — the pastes' oddities ("P3 +",
trailing "·") are text-copy artifacts (resource icons are SVGs that copy as
empty text; a count of exactly 1 is carried by the icon alone). Watch for a
screenshot recurrence; closing on the paste evidence alone.

# example 1 
P2 declined the offer
You declined the offer
P4 offered for
P4 rolled 8 — no production
P3 ended turn 39
P3 traded for with P2
P2 accepted the offer
You declined the offer
P3 offered for
P3 rolled 8 · You +2 · P3 + · P4 +3
P2 ended turn 38
P2 traded for with P4
P4 accepted the offer
P3 declined the offer
# example 2
P3 traded for with P2
P2 accepted the offer
You declined the offer
P3 offered for
P3 rolled 8 — no production
P2 ended turn 42
P2 traded for with P3
P3 accepted the offer
You declined the offer
P2 offered for
P2 rolled 3 · You + · P2 + · P3 + · P4 +
You ended turn 41
You rolled 6 · P2 +3 ·

# example 3 
Your turn — roll
⚅ —
drag to rotate · scroll to zoom
wood1
brick0
sheep0
wheat4
ore0
You
5 cards0 dev0 knights7 VP
Player 2
7 cards0 dev3 knights9 VP
Player 3
2 cards2 dev4 knights6 VP
Player 4
6 cards2 dev0 knights6 VP
P4 ended turn 76
P4 built a road
P4 bank-traded 4 →
P4 withdrew the offer
P3 declined the offer
P2 declined the offer
You declined the offer
P4 offered for
P4 rolled 8 — no production
P3 ended turn 75
P3 built a road
P3 bank-traded 4 →
P3 built a road
P3 bank-traded 4 →
P3 withdrew the offer
P4 declined the offer
P2 declined the offer
You declined the offer
P3 offered for
P3 rolled 8 · You +3 · P3 +2 · P4 +4
P2 ended turn 74
P2 traded for with P3
P3 accepted the offer