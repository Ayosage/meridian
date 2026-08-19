# Meridian Art Standard — "Painted Miniature at Golden Hour"

One-page go/no-go filter. Every future asset is checked against this sheet
before it enters the board. Established by the approved beauty slice
(2026-08-19, branch `feat/beauty-slice`); source spec:
`docs/superpowers/specs/2026-08-19-beauty-slice-art-direction-design.md`.
Reference implementation: `assets/slice.blend` + `apps/client/src/dev/slice/`.

## The identity test (all four, or NO-GO)

1. **Tabletop tile** — every terrain is a diorama growing from a shared
   beveled puck (circumradius 0.98, top-rim bevel 0.05/3seg, corner bevel
   0.02/2seg). If it couldn't be a physical piece you'd pick up, NO-GO.
2. **Golden hour** — asset must read under the slice rig (warm sun
   `#ffd9a0` @ ~22°, cool hemisphere fill, warm horizon backdrop). Judge in
   `/slice`, never in Blender viewport or a flat mockup.
3. **Painted miniature palette** — saturation lives in the midtones
   (`palette.ts` is the source of truth). Neon, pure white, or pure black
   are NO-GO. Player colors are always the loudest thing on the board.
4. **Miniature realism** — real architectural/natural detail at miniature
   scale (timber framing, shingle rows, layered canopies, furrow geometry).
   Smooth single-cone "chunky low-poly" silhouettes are NO-GO.

## Production recipe (how every asset is built)

- **Geometry carries the detail, vertex colors carry the paint.** No image
  textures. Color variation = per-corner `Col` attribute (noise-jittered,
  two-to-three tone lerps). This survives GLTF export losslessly.
- **Three terrain recipes** (reuse, don't invent):
  - *Sculpt* (mountains): cone-pinched icospheres + ridged noise, faceted
    flat shading, ~2–4k tris per hero tile.
  - *Scatter* (forest): 3–4 shared-mesh variants, seeded poisson placement,
    per-instance scale/rotation jitter. Instanceable at runtime.
  - *Pattern* (fields): dense grid clipped to hex, analytic profile
    (cosine furrows), joined detail clumps (~2k tris).
- **Buildings**: separate part-meshes per material zone; roof mesh stays
  separate so player color can be tinted at runtime. Boxes via basis-vector
  placement; stepped overlapping rows for shingles.
- **Roughness band 0.55–0.8** (painted wood). Below 0.5 only for water/glass.
- **Numerals/engravings** must sit ≥5mm (0.005 units) proud of their surface
  or they z-fight (camera near plane is 0.3).

## Budgets (per asset, before instancing)

| Asset class | Tri budget | Draw calls |
|---|---|---|
| Terrain dressing (hero) | ≤ 4,000 | ≤ 2 |
| Terrain dressing (scatter/pattern) | ≤ 2,500 | ≤ 2 + instanced variants |
| Building | ≤ 400 | ≤ 5 parts (merge candidates in production) |
| Edge/token piece | ≤ 300 | 1–3 |

Slice baseline: whole 3-tile scene ≈ 37 draw calls, 49fps high tier /
81fps low tier (Playwright browser, dpr 2 — see `docs/PERF.md`).

## Go/no-go checklist (run per asset in /slice)

- [ ] Terrain/piece type reads instantly at gameplay zoom (`?cam=close`)
- [ ] Ownership color reads instantly (player color = loudest)
- [ ] No visible seam against existing set pieces (same bevel, palette, roughness)
- [ ] Inside tri + draw-call budget; instanced where repeated
- [ ] Vertex-colored only; exports clean via `assets/export_slice.py`
- [ ] Sits correctly on the puck / vertex / edge with no terrain intersection
