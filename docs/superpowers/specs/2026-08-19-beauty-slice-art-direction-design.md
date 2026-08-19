# Meridian Beauty Slice — Art Direction Design

**Date:** 2026-08-19
**Status:** Approved (user, 2026-08-19)
**Parent:** `docs/superpowers/specs/2026-08-19-catan-pivot-design.md` §6 (the beauty-slice gate)
**Grounding:** `docs/superpowers/research/2026-08-19-design-pass/` (references, shaders, assets/licensing) — findings transfer post-pivot except where the hybrid-pipeline decision supersedes "sourced = greyboxing only".

## 1. Identity — "Painted Miniature at Golden Hour"

Four locked decisions (user, 2026-08-19):

1. **Board form: tabletop tiles.** Each hex is a distinct physical tile —
   beveled visible sides, hairline seams between neighbors, its terrain
   diorama growing from the tile top. Tiles sit in a real water plane.
   Number tokens and (later) the robber sit ON tiles. The board must read
   as a premium physical Catan set, not a videogame landscape.
2. **Lighting: golden hour.** One low warm sun (long soft shadows,
   honey-toned highlights), cool sky fill in the shadows. The "expensive
   miniature photographed by a pro" look.
3. **Palette: painted miniature.** Rich but earthbound — deep pine greens,
   ochre wheat, terracotta hills, slate-blue mountains with warm snow,
   parchment desert. Saturation lives in the midtones, never neon. Player
   colors are always the loudest thing on the board.
4. **Buildings: miniature realism.** Timber framing, shingle rows, stone
   foundations — real architectural detail at miniature scale.
   **Consequence accepted:** terrain must match this fidelity (sculpted
   rock massifs, layered pine canopies, real furrow geometry), or the
   contrast jars. "Chunky low-poly" terrain is off the table.
   **Ownership read: player-colored roofs** — shingles in the player
   color, everything else natural materials. (Fallback if the slice
   disproves it at gameplay zoom: colored plinth under the building.)

## 2. Slice contents

Chosen for production-technique coverage — every later tile reuses one of
these three recipes:

| Piece | Technique it proves |
|---|---|
| **Mountains tile** | Hero sculpt: rock massif + warm snow, most sculpt-heavy terrain |
| **Forest tile** | Scatter: instanced pine clusters on a groundcover top |
| **Fields tile** | Pattern: furrowed wheat rows as repeated geometry/texture |
| **Settlement** (at the shared vertex) | Building kit fidelity + player-colored roof read |
| **Road** (on one edge) | Edge-piece language (bespoke, player-colored) |
| **Number token** (one per tile) | Engraved wooden disc, numeral legibility at zoom |
| **Sea edge** | Water shader: depth-tinted, gentle motion, foam ring around tile bases |

Not in the slice (inherit the standard later): robber, ports, cities,
pasture/hills/desert tiles.

## 3. Pipeline

- **Assembly in Blender via the MCP bridge** (`mcp__blender__*`), iterating
  with viewport screenshots for composition, then GLB export.
- **Bespoke (Blender):** hex tile base (one shared beveled puck — the bevel
  language is a set-wide constant), settlement, road, number token, and any
  terrain sculpt sourced assets can't cover.
- **Sourced (hybrid per parent spec):** Poly Haven PBR textures + HDRI
  (CC0); photoscanned rocks decimated to budget; CC-BY acceptable with the
  credits surface. Licensing tripwires from the research stand: no
  community matcap dumps, no Synty hero assets.
- **Unification treatment (applies to every asset, sourced or bespoke):**
  one shared palette ramp pushing albedo toward the §1 palette; one
  roughness band (~0.55–0.8, painted-wood feel); baked AO per tile
  assembly; consistent bevel language; subtle fresnel/rim on pieces.
- **Review medium: the real R3F scene.** A dedicated slice route in
  `apps/client` renders the exported GLBs with the real lighting rig and
  post stack. The user reviews rendered pixels in the browser. **No flat
  mockups** (parent spec §6).

## 4. Lighting rig + post (starting values, tuned live in the slice loop)

- Sun: warm directional `#ffd9a0`, ~25° elevation, soft shadows
  (2048 map, radius blur).
- Fill: cool hemisphere (`sky #b8cae8` / `ground #6b5e4f`, low intensity)
  or a golden-hour Poly Haven HDRI at low intensity for ambient +
  reflections (pick whichever wins in the loop).
- Post: ACES tonemap → warm grade → bloom gated high (water sparkle /
  emissives only) → subtle vignette → N8AO half-res (high quality tier
  only) → optional gentle tilt-shift (taste call in the loop).
- Perf non-negotiables (parent spec): instanced tiles/trees, budgeted draw
  calls, 60fps mid-range; mobile tier drops SSAO/tilt-shift, keeps
  bloom + vignette + grade.

## 5. The gate checklist ("approved slice" means all of these)

1. Terrain type reads instantly at gameplay zoom.
2. Ownership (player color) reads instantly at gameplay zoom.
3. The three tiles + settlement + road + token feel like ONE hand-made set
   — no visible sourced-vs-bespoke seam.
4. 60fps on mid-range hardware at the slice's draw-call budget.
5. The user says ship it.

## 6. Deliverables of the approved slice

- The GLB asset set (tile base, three terrain dressings, settlement, road,
  token) — the production templates.
- A palette token file (terrain + player colors + water + light colors).
- The lighting-rig and post-stack constants as committed code in the slice
  scene.
- A one-page **art-standard sheet** (Dorfromantik-style go/no-go filter)
  added to `docs/` — every future asset is checked against it.

## 7. Risks

- **Fidelity mismatch** (realism buildings vs terrain) — mitigated by
  raising terrain detail; the slice's job is to find the budget ceiling
  where 60fps still holds.
- **Modeling time**: miniature realism is the slowest building style; the
  slice builds exactly one settlement to price it before committing to the
  full building kit (city, ports, robber).
- **Ownership read** may fail at zoom despite colored roofs — fallback
  (colored plinth) named in §1.
