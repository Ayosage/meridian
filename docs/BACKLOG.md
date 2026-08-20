# Backlog

Items from live playtesting (first human 4-player match vs bots, 2026-08-19).
Verified on the `/board` preview where noted.

## Phase 5 (trade/dev-card UX) — already planned

- **No trading interface.** Confirmed as phase-5 scope per the spec: player
  trades (offer/counter), bank 4:1, and port trades all need UI; the engine
  and protocol already support them.

## Board/asset fixes (phase 6 polish, or earlier if quick)

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
