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

## Browser performance pass — task 13 (2026-08-25)

Measure-first pass over the live client, per the task-13 brief's hypothesis
list (per-snapshot re-render cost, `view.board` identity churn, Zustand
selector granularity, N8AO/shadow cost, draw-call growth from phases 5-6 +
port rafts/boats). Own vite (5199) + colyseus (2599) stack, never the dev
ports; Playwright Chromium with `--use-angle=metal --enable-gpu` (same GPU
trap as the Phase-4 gate above).

### Baseline

| Scene | Tier | FPS (5s rAF) | Draw calls | Triangles | Heap (JS, MB) |
|---|---|---|---|---|---|
| `/board` preview | high | 61–86 (noisy, see below) | 537 | 314,523 | ~40–45 |
| `/board` preview | low | 114–120 | 531 | 314,517 | ~36–45 |
| Live solo vs 3 bots | high | 82–88 | 609 | 316,543 | ~55–69 |
| Live solo vs 3 bots | low | 111–119 | 603 | 316,537 | ~55–69 |

Method: `window.__meridianDebug.catanRenderInfo()` + a 5s `requestAnimationFrame`
counter, 1280×720, `performance.memory.usedJSHeapSize`. The high-tier FPS
range is genuinely noisy run-to-run on this machine (unlike the Phase-4
gate's clean 120fps vsync cap) — draw calls/geometry have grown enough
since that gate (287 → 432 → 537/609 here) that tier=high is no longer
purely vsync-capped, it's now mildly GPU/fill-rate-bound via N8AO. Draw
calls grew 432 → 537 (`/board`) since the Phase-4 gate: SVG resource icons,
port signs, and now two boats + a raft per port account for the rest (this
task's context: 501 → 537 from the two-boats-per-port change alone).

### Hotspot ranking (measured, not assumed)

1. **`view.board` identity churn → redundant per-snapshot scene rebuilds
   (confirmed, fixed).** The task-13 context flagged this as unverified —
   confirmed directly. `catanStore.ingestSnapshot` assigns `payload.view`
   (a fresh object from the wire) wholesale on every server push, so
   `view.board` gets a new identity every snapshot even though only
   `board.robber` ever actually changes mid-match. A temporary console-log
   probe on a 20s live solo-vs-3-bots match (bots on a 900ms delay, host
   driven through real turns so bots keep producing snapshots) counted:
   - `ingestSnapshot`: 27–28 calls (one per real snapshot).
   - `PortSign.tsx`'s `buildContentGeometry` (the merged ink-backing +
     SVG-icon + `TextGeometry` port-sign mesh, rebuilt via
     `mergeGeometries`): **28/28 snapshots** re-ran it. Direct timing:
     avg **1.57ms**, total 44.1ms of wasted main-thread work over 20s.
   - `CatanBoard.tsx`'s `InstancedVariant` (rewrites an entire scatter
     InstancedMesh's matrices + `computeBoundingSphere` + a GPU buffer
     re-upload): **168/168** calls (28 snapshots × 6 scatter variants)
     re-ran. Direct timing: avg 0.02ms/call, ~2.6ms total over 20s — cheap
     per call, but 6 unnecessary GPU buffer re-uploads every snapshot.
   - `PortSign.tsx`'s `RaftInstances` (rewrites the port-raft InstancedMesh
     matrices): 28/28 re-ran (not separately timed; same shape as
     `InstancedVariant`).

   None of this work was ever needed except on an actual robber move —
   board layout (hexes, ports) is fixed for the whole match.

2. **Boat draw-call count (measured, no win found, not landed).** Task
   context flagged two-boats-per-port (+36 draw calls, 501→537) as a
   candidate for `InstancedMesh` conversion. Tested empirically first:
   disabled boat rendering entirely and re-measured. Draw calls dropped
   537→465 (`/board`) / 609→537 (live), a real 12% cut — but FPS moved
   from 83.6→86.4 (`/board`) and *down* slightly live (87.9→81.8), both
   within this machine's run-to-run noise band (±5fps across identical
   configs). This scene is not currently draw-call-bound at 1280×720 on
   this hardware — instancing the boats would be legitimate defensive
   engineering (mobile/low-end GPUs are far more draw-call-sensitive per
   the graphics-optimizer skill's mobile-first guidance) but isn't a
   *measured* win here, so it's not landed this round. See Future below.

3. **N8AO tier cost (already known, no action).** high-vs-low tier gap is
   unchanged in character from the beauty-slice finding — draw calls
   barely move (−6, the N8AO pass itself) but fps drops meaningfully
   (~85→~118): a fill-rate cost, not a draw-call one, and already the
   entire point of the `?tier=low` fallback. Not touched (would require a
   visual-quality change to move further, which is out of scope).

4. **Shadow map / Zustand selector granularity: investigated, not pursued.**
   The 2048×2048 soft-shadow directional light is a plausible cost but any
   reduction is a visible quality change (out of scope: no visual
   regressions). HUD components (`CatanHud`, `BuildBar`, `TradePanel`, etc.)
   subscribe to the whole `view` via Zustand and so re-render on every
   snapshot regardless of relevance — real, but these are cheap DOM
   components (several return `null` immediately when inactive) and
   almost all of them legitimately need to reflect most snapshots (turn,
   dice, hand); no measurable win identified here, so not pursued further
   this round (see Future below).

### Fix landed: pin the board's static layout, only re-identity on robber moves

`apps/client/src/scene/catan/CatanScene.tsx`'s new `useStableBoard` pins
the first `view.board` it sees in a `useRef` and only produces a new
`board` object (spreading the pinned layout with a fresh `robber` field)
when `view.board.robber` actually changes. `CatanBoard`, `Pieces`,
`PickLayer`, and `Highlights` now all receive this stable `board` (via a
`stableView` that keeps `buildings`/`roads` live) instead of the
raw per-snapshot `view.board`.

**Re-measured with the same probe** (20s live solo-vs-3-bots match, 27
real snapshots landed): `buildContentGeometry` ran **1** time (mount only,
not 27); `InstancedVariant` ran **6** times total (once per variant at
mount, not 162); `RaftInstances` ran **1** time (not 27). This eliminates
essentially all of the wasted per-snapshot work identified in hotspot #1 —
confirmed by direct call-count elimination, the most reliable signal here.

Aggregate FPS/frame-time percentiles (`requestAnimationFrame` delta
p50/p95/p99/max over a 20s driven match) did **not** show a detectable
before/after difference at this board's current scale (p50 ~12ms, p95
~19–20ms, both before and after) — the ~1.6ms eliminated per snapshot is
smaller than this harness's run-to-run noise floor, and snapshots land
only every few seconds during normal play, not every frame. Reporting
this honestly rather than overclaiming an FPS win: the fix is justified by
eliminating measured, real, unconditional wasted work (main-thread CPU +
unnecessary GPU buffer re-uploads) on every network message, not by a
headline FPS delta. It also fully resolves the "water material `useMemo`
identity" item this file's own Task-8/9 entry had deferred pending "the
store [producing] new view objects mid-match" — that's exactly what
happens now, and the generalized pin (not just `Water`'s local one) covers
it for every consumer, not just water.

No visual regression: `/board?tier=high` screenshots before/after are
pixel-identical modulo water-shader animation phase (the two captures were
taken at slightly different `uTime` values, not a rendering difference —
confirmed by eye, board geometry/lighting/pieces unchanged).

Verification: `pnpm -C apps/client test` (190/190), `npx tsc --noEmit`
(clean), `pnpm -C packages/rules test` (158/158), `pnpm -C apps/server
test` (63/63) — all green, run once at the end of this pass.

### Future (not landed this round — deeper or riskier, ledgered instead of chased)

- **Boat `InstancedMesh` conversion** (hotspot #2 above): no measured win
  on this hardware at this scale, but draw-call reduction is real (12%)
  and would matter more on lower-end/mobile GPUs. Complication: sails need
  per-instance tint (only resource ports color theirs) — three.js
  `InstancedMesh.setColorAt`/`instanceColor` supports this on
  `MeshStandardMaterial` without a custom shader, but needs its own
  visual-regression pass (per-instance color vs. today's cloned-material
  tint must render identically) before landing.
- **HUD Zustand selector granularity**: components subscribing to the
  whole `view` re-render on every snapshot even when irrelevant to them
  (e.g. `IncomingOffer`, `StealChooser` on turns with no open
  trade/steal). Likely low-value (cheap DOM, mostly early-return) but
  unmeasured — worth a pass only if HUD-side jank is ever reported.
- **Tint-material dispose on upgrade** (carried over from the Task-8/9
  entry above): still not fixed, still minor.
- **Shadow map size/radius, N8AO parameters**: any further tightening
  changes the approved art direction and needs a design sign-off, not a
  perf-only change.
