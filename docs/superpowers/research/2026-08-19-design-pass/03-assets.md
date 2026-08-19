# Meridian Asset Research: 3D Models, Fonts, Icons, Textures, Build-vs-Source

(Research phase 1 of the Meridian design pass — lane: assets + commercial licensing. Agent-produced 2026-08-19. License terms verified against the actual license pages at research time; re-verify at integration.)

## 1. 3D piece assets — sourced options evaluated

| Source | License | Commercial OK? | Attribution | Limits | Style fit | GLB? |
|---|---|---|---|---|---|---|
| KayKit – Board Game Bits (kaylousberg.itch.io/board-game-bits) | CC0 | Yes | None | Don't resell unmodified | Geometric low-poly meeples/pawns/chess/dice on one gradient atlas | Yes |
| Kenney – Board Game Info (kenney.nl/assets/board-game-info) | CC0 | Yes | None | None | Signature blocky/toylike "Kenney look" | Yes |
| Quaternius (quaternius.itch.io) | CC0 | Yes | None | None | Bright rounded "cute" low-poly, recognizable | Yes |
| Poly Pizza (poly.pizza) | Mixed CC0/CC-BY per model | Yes, check each | CC-BY items only | Per-model | Inconsistent quality/style across contributors | Yes |
| Sketchfab | Mixed, filterable | Only filtered CC0/CC-BY | Depends | Some bar redistribution | Cohesion across authors is hard | Varies |
| Synty (paid) | Custom EULA | Yes (seat license, royalty-free in product) | N/A | No standalone asset resale | Polished but extremely recognizable house style | Yes |
| game-icons.net (icons) | CC-BY 3.0 | Yes | REQUIRED — credit reachable from an in-game menu | — | — | — |

**Flags:** Synty's risk is visual fingerprinting, not legal — the look is recognized on sight, cutting against "no stock-asset look." KayKit/Kenney/Quaternius are commercial-clean but each has a strong recognizable house style: use for greyboxing, don't ship as hero pieces.

## 2. The bespoke alternative — custom pieces via the Blender MCP bridge (RECOMMENDED)

- **Scope is small:** 6-10 unique piece silhouettes, no rigging/skinning/animation — board pieces slide (R3F lerps/springs), they don't walk. This collapses the "custom 3D is expensive" argument, which is about character pipelines.
- **Scripted modeling fits:** chess-like abstractions (cones, truncated pyramids, obelisks), crystalline forms (extrude + inset + bevel, randomized facets), totem stacks (boolean-unioned primitives via bmesh). One parameterized Blender Python script (via `mcp__blender__execute_blender_code`) generates a matched family — cohesion for free, the hardest thing to get from sourcing.
- **Custom geometry + custom shader is the actual antidote to stock look.** A KayKit pawn under Meridian's GLSL still reads as a KayKit pawn — silhouette is what players pattern-match. A bespoke silhouette under the same shader reads as nothing anyone has seen.
- **Effort:** a few hours of scripting for 6-10 GLB exports (primitive → bevel/inset/taper → boolean detail → decimate → export), reusable indefinitely. 100% owned, zero attribution, zero resale risk.

## 3. Fully-procedural in-three.js pieces

- **Wins for:** revolve-based forms (LatheGeometry), extruded markers, and especially secondary/runtime geometry — selection rings, highlight overlays, procedural state variants (three-bvh-csg for runtime booleans).
- **Loses to Blender for:** hero-quality bevel/shading control, organic passes, iteration speed (Blender viewport + MCP screenshot beats a code/reload loop).
- **Recommendation:** Blender for the ship-quality hero set; in-three.js CSG for runtime-only geometry.

## 4. Textures / matcaps / HDRIs

- **Poly Haven** (polyhaven.com) — CC0, commercial-safe: HDRIs for cheap ambient/reflection variance; PBR textures if the board isn't fully procedural.
- **⚠️ Matcap dumps are NOT commercial-safe.** The popular community collections (emmelleppi/matcaps, nidorx/matcaps) self-describe as scraped from unattributed sources including ZBrush's library, with no license grant. **Do not ship these in a sold product.** Clean alternatives: (a) bake your own matcaps in Blender via the MCP bridge (minutes, fully owned); (b) compute the matcap look in GLSL (view-space normal → gradient ramp) — no texture at all, fits the custom-shader direction.
- **Noise/gradients:** generate in-shader — cheaper, resolution-independent, reinforces the mandate.

## 5. UI assets — fonts and icons

**Fonts (Google Fonts, SIL OFL, commercial-safe):** skip the esports/HUD cluster (Orbitron/Audiowide/Rajdhani — overused "this is a game" defaults). For premium abstract strategy:

| Role | Candidate | Why |
|---|---|---|
| Display | **Cinzel** | Roman-inscription capitals — "strategy/mythic" immediately |
| Display alt | **Fraunces** | Warm high-contrast serif, less stock-classical |
| UI/body | **Spectral** | Quiet, highly legible small-size serif |
| UI/body alt | **Marcellus** | Crisp near-geometric serif, pairs with Cinzel |
| Numerals/sans option | **Saira / Sora** | Neutral geometric, sits under a serif display without going esports |

Recommended pairing: **Cinzel + Spectral** (Fraunces as display fallback).

**Icons:** game-icons.net is CC-BY 3.0 (attribution reachable from an in-game menu required). Meridian needs ~10 UI icons — hand-rolling custom SVGs in the same visual language is low-effort, cohesive, and license-free. Keep game-icons.net as a legitimate fallback under timeline pressure.

## 6. Recommendation — concrete asset strategy

**Build custom (Blender MCP):** all hero pieces (one parameterized script), custom-baked matcaps if texture-sampled matcaps are wanted, ~10 custom SVG UI icons.
**Source (CC0):** KayKit/Kenney for greyboxing ONLY (never ship); Poly Haven HDRIs; Google Fonts (Cinzel, Spectral, Fraunces, Marcellus).
**Pure shader:** noise/gradient surfaces; optionally the matcap lighting response itself.
**Avoid:** third-party matcap dumps (unlicensed provenance); Synty for shipped hero pieces (fingerprinting); any CC-BY asset without actually implementing the attribution surface.

Shortlist: polyhaven.com · kaylousberg.itch.io/board-game-bits · kenney.nl/assets/board-game-info (+ kenney.nl/assets/kenney-fonts CC0 fallback) · game-icons.net (fallback) · fonts.google.com (Cinzel/Spectral/Fraunces/Marcellus).
