# Backlog

Items from live playtesting (first human 4-player match vs bots, 2026-08-19).
Verified on the `/board` preview where noted.

## Board/asset fixes (phase 6 polish, or earlier if quick)

- **Roll/END TURN button overlap — shipped with phase 5.** Fixed in
  `hud.css` (roll button `right: 132px`); no longer an issue as of the
  trade/dev-card UX merge.
- **Fixed camera + corner HUD panels (build bar, trade panel, dev strip)
  can cover board vertices at 1280x720.** Vertices under panels are
  unclickable for humans; consider camera orbit, panel auto-collapse, or
  filtering obstructed targets in the `legalTargetsOnScreen` dev hook.
  Discovered during phase-5 E2E work.
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
- **Bots never propose player trades.** `tools/bots.mjs` responds to offers
  and bank-trades, but nothing opens an offer — a human never receives one
  in a bot match. Teach bots to occasionally propose (give surplus / get
  build-goal need) so the responder UI gets exercised in playtests.
- **Placeholder: more playtest findings expected.** This was one match;
  do a deliberate sweep next session (user: "probably a few other
  things") and extend this list.
