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
- **Roads don't always align with their hex edge.** Verified on `/board`:
  several demo roads sit rotated off the edge they occupy (blue and red
  roads visibly askew). Likely the edge-rotation math in the piece placement
  (rotation derived from edge endpoints vs the road mesh's modeled axis) —
  check `Pieces.tsx` / `catanLayout.ts` edge angle handling for all six edge
  orientations.
- **Number tokens hidden by terrain on mountain (and forest) tiles.**
  Verified on `/board`: peaks and pines occlude the token from the default
  camera. Resolution (decided): re-author tile assets with TWO reserved
  circular pads per tile — one for the number token, one for robber
  placement — and keep terrain dressing out of both.
- **Robber placement is invisible after moving.** The current thin gray
  peg disappears into terrain dressing on non-desert tiles. Same two-pad
  resolution; also consider a bolder robber silhouette (classic "hooded
  figure" proportions) so the blocked tile reads at a glance.
- **Token numerals too thin.** Regenerate the text-to-mesh numerals with a
  bolder weight / deeper extrude so they read at gameplay camera distance
  (remember the ≥5mm-proud z-fight constraint from the slice build).

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
