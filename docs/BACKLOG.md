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

- **No incoming-trade UI for the receiving player.** `TradePanel.tsx:201`
  renders the open-trade panel only for the offering seat
  (`view.turn.current === seat`); every other seat gets nothing while an
  offer is open. A human can never see, accept, decline, or counter an
  incoming trade — only bots can respond (they go through the pilot).
  Biggest gap of the playtest; needs an offer-responder panel (terms +
  accept/decline/counter) for non-current seats.
- **Own victory points aren't visible anywhere.** `OpponentStrip` in
  `CatanHud.tsx` filters the local seat out of the player cards
  (`.filter((i) => i !== seat)`) and no other HUD element shows your VP.
  Since it's the self view, it can show TRUE VP (including hidden VP dev
  cards via the rules engine), not just the public subset opponents see.
- **Local player should have a card in the top-right player strip.** Same
  root as above: include a "you" card alongside the opponents (or a
  visually distinct self card) so the strip reads as the full table.
- **Player cards lack seat colors.** The `opponent-card` chips don't carry
  the player's color — red/blue/white/orange already exist as
  `palette.players` (used by `SEAT_COLORS` in `Pieces.tsx`); surface them
  on the cards (border/swatch) so pieces map to players at a glance.
- **Trade UI renders black text on a black background.** Contrast bug in
  the trade panel styles (`hud.css` / `TradePanel.tsx`) — likely a missing
  color on panel text inheriting the dark theme background. Audit all
  trade-panel states (composer, offer review, counter draft) while there.
- **Placeholder: more playtest findings expected.** This was one match;
  do a deliberate sweep next session (user: "probably a few other
  things") and extend this list.
