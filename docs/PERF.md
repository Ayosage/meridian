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
