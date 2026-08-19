# Shader/VFX Toolbox for Meridian — Research Report

(Research phase 1 of the Meridian design pass — lane: shaders/VFX/rendering. Agent-produced 2026-08-19.)

Scope note: everything below assumes the existing architecture (2 InstancedMesh draw calls — hex prisms + cone pieces, per-instance state attribute, `uTime` uniform, unused `uQualityTier` uniform) and stays additive to it rather than replacing it.

## 1. Board-surface techniques (hex prism tiles)

- **SDF hex border/edge glow.** Compute a 2D hexagon SDF in the fragment shader from local/UV space (IQ's exact hexagon distance function), then `smoothstep` a thin band around `d≈0` for crisp, resolution-independent borders and edge glow that don't need texture UVs. Cheap (a handful of ALU ops), and the single highest-leverage move because it's what currently reads as "flat instanced mesh" today.
- **Triplanar procedural material** (stone/wood/crystal) driven by world-position + normal blend instead of UVs — avoids stretching on prism side faces vs. top face, and lets you procedurally vary per-tile via the existing per-instance attribute (feed a "material seed" float). IQ's biplanar variant is a cheaper 2-sample version.
- **Height variation + baked-in gradient AO.** Vary prism top height slightly per-instance and multiply by a fake AO term = `1 - pow(saturate(dot(normal, up)), k)` near edges — no real AO pass, just cheap analytic falloff that reads as "the tiles have depth."
- **Animated energy flow along tile edges.** Same SDF border band, modulated with a moving `fract(dist_along_edge - uTime * speed)` ramp — "current flowing along hex borders" with zero extra geometry.
- **Fresnel/rim on tile tops** — cheap `pow(1-dot(N,V), power)` term on the top face only; subtle glassy/lacquered edge without a second material.
- **Parallax depth fake** on the top face (POM-lite, 2-3 steps) for carved-rune or crystal-vein detail — moderate cost, use sparingly (special tiles only).

## 2. Piece material techniques (cones → refined primitives)

- **Toon/cel with rim light** — quantize `NdotL` into 2-4 bands (ToonChess is a direct genre precedent) plus a Fresnel rim term. Extremely cheap, very legible at small piece scale.
- **Glass/gem with internal glow** — drei `MeshTransmissionMaterial` or custom transmission for "royal"/special pieces: transmission + thickness + chromatic aberration, paired with an emissive core. Targeted effect — transmission reads an offscreen buffer, reserve for 1-2 hero pieces.
- **Iridescence/holographic** — thin-film-style color shift driven by `NdotV` through an analytic cosine-palette, with a procedural noise term breaking up the banding (the tell for "holographic" vs plain fresnel rainbow).
- **Team-color systems that stay readable** — drive team color as an attribute that tints the rim/fresnel term and a base-albedo multiply, not the full diffuse — keeps toon bands legible while color-coding clearly; composes with any base material as an overlay.
- **Subsurface fake** — wrap-lighting (`NdotL * 0.5 + 0.5`) + a thickness-approximation translucency term for a "soft stone/jade" organic tier.

## 3. Selection / legal-move / hover language

- **Pulse rings** — expanding SDF ring (`abs(dist - r(t)) < width`), `r(t) = fract(uTime * speed)`, alpha-faded over the cycle. Reads far more "designed" than a flat tint; near-zero cost reusing the hex SDF.
- **Edge-glow propagation for legal-move sets** — drive border-glow intensity with a per-instance "distance from selected piece" attribute so the glow washes out from the source tile over ~200ms — an animated affordance almost for free.
- **Ground projection decals** for hover/target cursors — three.js DecalGeometry works but has corner-distortion/cost caveats; a screen-projected billboard quad positioned via raycast hit is simpler and cheaper for a flat board.
- **Trail/afterimage on movement** — 3-5 short-lived low-opacity instanced ghost copies along the path, fading via alpha-over-lifetime; pairs with the movement easing in §5.

## 4. Post-processing pipeline (@react-three/postprocessing)

Ranked by premium-feel-per-millisecond for this scene type:

1. **Bloom** (biggest win) — `luminanceThreshold` tuned so only emissive accents (edge glow, gem cores, selection rings) cross it; keep bloom `height` modest (256-300px) rather than full-res.
2. **Vignette** — near-free, frames the board, always-on at every tier.
3. **Color grading / LUT or simple tone-curve** — cheap single-pass remap; the biggest "why does this look like a real game" lever for basically no cost.
4. **SSAO (N8AO)** — real cost; half-res mode gives 2-4x speedup; N8AO double-renders transparent objects (matters if glass pieces are used — test together). High quality tier only.
5. **Tilt-shift / DOF diorama blur** — strong "expensive miniature" payoff, real blur cost, and a taste/clarity call — keep subtle (background only) or toggleable.

Mobile fallback: drop SSAO and DOF; keep bloom (reduced res) + vignette + color grade — those three read as premium while being nearly resolution/geometry independent.

## 5. Motion/juice via shaders + springs

- **Piece movement easing** — `maath/easing` `damp3`/`dampQ` (frame-rate independent smooth-damp, no overshoot) in `useFrame` — the direct fit, no spring lib needed.
- **Impact ripples across neighboring tiles** — on landing, write a ripple origin uniform (position + start time); each tile displaces top-face height / boosts edge-glow with a decaying sine keyed off distance + elapsed time. Shockwave as pure math over the existing per-instance system.
- **Capture dissolve/shatter** — classic recipe: sample simplex noise, threshold with rising `uDissolveAmount`, discard below, add a thin emissive "burn edge" band at the boundary; optional vertex displacement pushing fragments outward before they vanish.
- **Idle board "breathing"** — extend `uTime` to a very low-amplitude, low-frequency global height/emissive modulation (slow sine) so the board feels alive at rest — essentially free.

## 6. Environment framing

- **Gradient sky dome** — inverted hemisphere with a 2-3 stop vertical gradient shader; effectively free, huge framing/mood impact.
- **Procedural nebula/fog plane** behind the board — one large plane with layered noise + slow scroll; cheaper than particles, reads as intentional environment art.
- **Ground plane** — dark plane with gradient-fog falloff, optionally a subtle fake reflection.
- **Reflections** — skip true planar reflection (extra camera render); a blurred flipped duplicate or fresnel-driven fake specular gets 80% of the look for a fraction of the cost.

## 7. Perf guidance / cost tiers

**Free-to-cheap (always on, all tiers):** SDF hex border/glow, fresnel rims, toon banding, gradient sky dome, vignette, idle breathing, per-instance height/AO fake, team-color rim tinting. Pure math in existing shaders — no new draw calls or render targets.

**Moderate (mid/high tier):** triplanar material, legal-move glow propagation (one extra per-instance attribute), impact ripples (small uniform buffer of active ripples), bloom (res-capped), color grading, movement trails, capture dissolve (rare event — fine even on low tier).

**Expensive (high tier / desktop only):** glass/gem transmission (1-2 hero pieces max), SSAO/N8AO, tilt-shift DOF, true DecalGeometry cursors (prefer billboard quads).

**Where `uQualityTier` earns its keep:** gate SSAO, DOF, transmission, and bloom resolution. Everything free-to-cheap runs identically across tiers — the game reads premium even at the lowest tier.

## Ranked shortlist — premium-feel-per-effort

1. **SDF hex border/edge glow** — foundational, near-free, unlocks rings/propagation/energy-flow via reuse.
2. **Bloom tuned to emissive accents** — biggest "looks expensive" lever.
3. **Toon/cel piece shading + fresnel rim** — cheap, legible, precedented (ToonChess).
4. **Gradient sky dome + fog plane** — near-free, transforms framing.
5. **Edge-glow propagation + pulse-ring selection** — turns UI affordance into juice.
6. **Vignette + color grading** — near-free polish.
7. **Movement easing via maath/damp3** — removes the "teleport" feel.
8. **Capture dissolve** — rare event, high spectacle-per-cost.
9. **Impact tile ripple** — tactile landing payoff.
10. **Glass/gem hero-piece material** — targeted, real cost, big differentiation.
11. **SSAO / tilt-shift DOF** — top tier only.

## Sources

- IQ distance functions: https://iquilezles.org/articles/distfunctions/
- IQ biplanar mapping: https://iquilezles.org/articles/biplanar/
- Interactive Hexagon Grid Tutorial: https://inspirnathan.com/posts/173-interactive-hexagon-grid-tutorial-part-4/
- Shadertoy hexagonal tiling: https://www.shadertoy.com/view/3sSGWt
- Ronja triplanar: https://www.ronja-tutorials.com/post/010-triplanar-mapping/
- Catlike Coding triplanar: https://catlikecoding.com/unity/tutorials/advanced-rendering/triplanar-mapping/
- ToonChess: https://martinrenou.github.io/ToonChess/
- Roystan toon shader: https://roystan.net/articles/toon-shader/
- drei MeshTransmissionMaterial: http://drei.docs.pmnd.rs/shaders/mesh-refraction-material
- Codrops glass/plastic: https://tympanus.net/codrops/2021/10/27/creating-the-effect-of-transparent-glass-and-plastic-in-three-js/
- DerSchmale thin-film iridescence: https://github.com/DerSchmale/threejs-thin-film-iridescence
- Iridescent shader breakdown: https://medium.com/@sunnless/iridescent-shader-breakdown-c87ec5fe1e2a
- three.js DecalGeometry: https://threejs.org/docs/pages/DecalGeometry.html
- react-postprocessing Bloom: https://react-postprocessing.docs.pmnd.rs/effects/bloom
- N8AO: http://n8programs.com/n8ao/
- HBAO vs N8AO thread: https://discourse.threejs.org/t/new-ambient-occlusion-example-hbao-vs-n8ao/58847
- TresJS tilt-shift: https://post-processing.tresjs.org/guide/pmndrs/tilt-shift
- pmndrs/maath: https://github.com/pmndrs/maath/blob/main/README.md
- Codrops dissolve: https://tympanus.net/codrops/2025/02/17/implementing-a-dissolve-effect-with-shaders-and-particles-in-three-js/
- Cyanilux dissolve breakdown: https://www.cyanilux.com/tutorials/dissolve-shader-breakdown/
- Aunyks procedural skydomes: https://blog.aunyks.com/2021/7/procedural-skydomes-on-the-web
- Maxime Heckel refraction/dispersion: https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/
