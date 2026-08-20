# Meridian Performance Snapshots

Pillar 2 (BRIEF): 60fps on mid-range laptops and phones; instancing;
draw-call budget; no per-frame allocations.

## Milestone 1 — placeholder ruleset, radius-3 board (2026-08)

| Metric | Budget | Measured |
|---|---|---|
| Draw calls (match scene) | < 10 | 2 |
| Triangles | < 50k | 948 |
| FPS (desktop, dev build) | 60 | ~120 (display-refresh-capped at 120Hz; no dropped frames) |

Method: `window.__meridianDebug.renderInfo()` (dev-only hook) read by
`apps/client/e2e/match.spec.ts`; fps observed via a `requestAnimationFrame`
counter sampled over 3s during an active match (dev build, `pnpm --filter
client dev` + `pnpm --filter server start`), consistent with a brief manual
check via browser devtools' performance panel — steady, no frame drops.

Techniques in force: one InstancedMesh for tiles + one for pieces;
per-instance `aState`/color attributes instead of material swaps; matrices
rewritten only on state changes; single `uTime` uniform write per frame;
zero per-frame allocations (module-level scratch objects).

## Beauty slice — 3 Catan tiles + pieces, /slice route (2026-08-19)

| Metric | Budget | Measured |
|---|---|---|
| GLB payload (7 assets) | < 5 MB | 1.2 MB (vertex colors, no textures) |
| Scene nodes / draw calls | — | ~37 meshes + water + post |
| FPS high tier (N8AO, bloom, vignette) | 60 | 49 (Playwright Chromium, dpr 2) |
| FPS low tier (bloom + vignette only) | 60 | 81 (same browser) |

Method: `requestAnimationFrame` counter over 2s via Playwright evaluate.
Caveat: the Playwright browser may lack full GPU acceleration — re-measure
high tier in a real browser before treating 49fps as a violation. N8AO
half-res is the entire high/low gap; the tier switch (`?tier=low`) already
implements the spec's mobile fallback (drop SSAO, keep bloom + vignette +
grade).

Production notes for the board client phase: forest pines are 14 nodes
sharing 3 meshes per tile — convert to InstancedMesh per variant across the
whole board; settlement is 5 part-meshes — merge to ≤2 (roof separate for
player tint); token numerals (580 tris each) are merge/decimate candidates.

## Full board — 19 Catan tiles + demo pieces, /board route (2026-08-19)

| Metric | Budget | Before instancing | After instancing |
|---|---|---|---|
| Draw calls | ~250 (target ≤300 for the fix) | 1049 | **287** |
| Triangles | — | 257,293 | 257,293 (unchanged — same geometry, fewer draw calls) |
| FPS (rAF counter, 2s) | 60 | ~60 | ~60 (both rAF/vsync-capped; not a reliable GPU-bound signal at dpr 1) |

Method: `window.__meridianDebug.catanRenderInfo()` (dev-only hook on
`CatanScene`, mirroring the `renderInfo()` idiom in `dev/debugHooks.tsx`) +
a `requestAnimationFrame` counter over 2s, Playwright Chromium, dpr 1
(devicePixelRatio was not controllable from this harness — dpr 2 numbers,
comparable to the beauty-slice row above, still need a real-browser
re-measure). `gl.info` needed `autoReset = false` + a manual reset at the
start of each frame (lowest `useFrame` priority) to read the whole frame's
total — by default it only reflects the postprocessing composer's last
internal `renderer.render()` call (the 1-triangle fullscreen blit).

**Root cause (1049 draw calls):** the scatter/pattern terrains, unbatched —
pasture is 84 nodes/tile × 4 tiles = 336 draw calls, forest is 15
nodes/tile × 4 tiles = 60, and every shadow-casting mesh is drawn a
*second* time into the sun's shadow map, roughly doubling those totals
(pasture ≈672, forest ≈120 combined main+shadow) — together over 80% of
the pre-fix total.

**Fix (fix round 1):** `scene/catan/CatanBoard.tsx` now batches forest
pines (3 geometry variants: `pine_a/b/c`) and pasture grass clumps (1
variant) + sheep (3 variants) into per-variant `InstancedMesh`es spanning
every tile of that terrain, instead of one clone per node per tile.
`ScatterInstances` reads each source GLB once (`collectVariants`: groups
repeated nodes by shared `BufferGeometry` reference, keeping each node's
local-to-tile `matrixWorld`), then `InstancedVariant` composes
`translate(tileWorldPos) * localMatrix` per (tile × node) pair and writes
all instance matrices once on mount (`instanceMatrix.needsUpdate` set
once — the board is static after mount, no per-frame writes). Because
instancing is a single GPU draw call regardless of instance count, this
collapses both the main pass *and* the shadow pass to 1 draw call per
variant. Ground meshes (`forest_ground`/`pasture_ground`) still clone
per-tile as before — only the two terrains with real repeat-count are
touched; hills' 7 unique sculpt meshes, fields' pre-joined `fields_tufts`,
and desert's 6 tufts (only 1 desert tile — not worth it) are unchanged.
Verified via Playwright screenshot at the same camera pose: pixel-identical
to the pre-fix render, and the unchanged triangle count (257,293 in both)
confirms no geometry was added, removed, or moved — only draw-call count
changed.

## Phase-4 gate — E2E perf snapshot, /board tiers (2026-08-19)

| Metric | `/board?tier=high` | `/board?tier=low` |
|---|---|---|
| FPS (rAF counter, 3s) | 120 | 120 |
| Draw calls | 432 | 426 |
| Triangles | 272,527 | 272,521 |

Method: `apps/client/e2e/catan.spec.ts` perf test — headless Chromium with
GPU via ANGLE-on-Metal (see below), 3s `requestAnimationFrame` sample +
`catanRenderInfo()`, dpr 1. Both tiers pin the 120Hz vsync cap on this
machine (M-series), so fps no longer separates them here; the −6 draw calls
at low tier is the N8AO pass. This finally resolves the beauty-slice open
gate item ("re-measure high tier in a real browser"): the earlier 49fps was
indeed un-accelerated rendering, not scene cost.

**Headless WebGL trap:** default headless Chromium renders WebGL on
SwiftShader (software) — this scene collapses to **3.5fps** high / 4.9fps
low there, which starved the 3-browser match E2E into timeouts.
`playwright.config.ts` now passes `--use-angle=metal --enable-gpu`, which
restores the real GPU in new-headless mode (measured identical to headed).

**Multi-page contention:** even with the GPU, THREE simultaneous boards at
tier=high saturate the GPU/main threads — every Playwright protocol call
queues for seconds and the match crawled at ~10 turns per 10 minutes. The
match E2E therefore joins all pages with `?tier=low` (~27 end-turns/min).
Single-page interactive play at tier=high is unaffected.

Ledger: draw calls grew 287 → 432 since the Task-8 snapshot above (pick
layer, legality highlights, and match-time pieces landed in between) —
over the ~250 budget again; worth a pass to find what un-batched.

Deferred (ledgered, not required for this round): tint-material dispose on
upgrade (`Pieces.tsx`'s `cloneTinted` clones a material per piece but never
disposes the previous one if a building is re-tinted, e.g. settlement →
city upgrade re-mounting with a new source — a minor GPU-memory leak, not
a draw-call issue); water material `useMemo` identity (`CatanScene.tsx`'s
`Water` recreates the whole shader material if `view.board.hexes`'
reference changes, even when the actual hex set didn't — fine for a
static board, worth revisiting once the store can produce new view objects
mid-match).
