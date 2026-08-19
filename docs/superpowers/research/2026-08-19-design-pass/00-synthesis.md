# Meridian Design Pass — Research Synthesis

(Phase 1 of 3 [research → planning → implementation], 2026-08-19. Four parallel research lanes: 01-references, 02-shaders, 03-assets, 04-uxui. This synthesis feeds the phase-2 interactive planning session.)

## Where all four reports converge

1. **Shader-driven premium is validated, not just hoped.** The reference analysis (TFT's void island, Faeria's living board, Monument Valley's fog+AO-instead-of-lighting) and the shader toolbox (SDF hex borders, bloom-tuned emissives, gradient sky domes — all free-to-cheap) agree: this stack can look expensive without an asset budget. The brief's "shader-driven beauty" pillar is the right bet.
2. **Motion is the #1 gap, not materials.** Every lane lands on the same diagnosis: an instant-snap piece move reads as a tech demo regardless of shader quality. The Preparation → Emphasis → Aftermath animation structure (eased travel, hit-frame, landing ripple, capture dissolve) is the single highest-leverage change. `maath/damp3` + the ripple/dissolve shader recipes are the concrete implementation path.
3. **Affordance hierarchy is a solved design problem — adopt it.** Strict brightness/saturation ordering (hover < legal-move < danger), shape-coded markers (dots = move, rings = capture) for colorblind safety, prevention-over-error-messages. Maps directly onto the existing per-instance attribute system.
4. **Bespoke pieces via the Blender MCP bridge.** 6-10 unrigged hero silhouettes from one parameterized script beats sourcing (license-clean by construction, cohesive by construction, and custom silhouette + custom shader is the actual antidote to "stock-asset look"). Sourced CC0 packs (KayKit/Kenney) are for greyboxing only.
5. **Licensing tripwires found before they fired:** community matcap dumps are unlicensed (never ship); game-icons.net needs an in-game credits surface (or hand-roll ~10 SVGs); Synty is legally fine but visually fingerprinted.

## The three art-direction lanes (phase-2 decision #1)

| | A — "Obsidian Table" | B — "Terrarium" | C — "Living Current" |
|---|---|---|---|
| Mood | Void diorama, cold precision | Warm physical miniature | Board-as-living-material |
| Anchors | TFT Arena, Faeria void, Duelyst | Civ VI resin diorama, Dorfromantik, Monument Valley | Faeria ocean, Armello day/night, Gloomhaven weather |
| Key tech | Rim light + emissive accents + vignette | Tilt-shift DOF + fake AO + prop kit | Noise/flow shaders, vertex displacement, emissive veins |
| Fit to stack | Strong | Weakest (prop variety + DOF-dependent) | Strongest (pure GLSL) |

References verdict: **A or C** are the strongest stack fits. C delivers idle "living world" juice for free; A is the cheapest path to jewel-box premium.

## Phase-2 decisions to put to the user (in order)

1. **Art lane** (A/B/C or a hybrid direction) — visual decision, best made against mockups.
2. **Theme/identity** — what IS Meridian (the name suggests lines/navigation/celestial)? Theme should be chosen WITH the lane, since palette and piece language follow. Note: engine constraint list applies (cheap: radius/roster/positions/ranges; expensive: board shape, movement patterns, capture rules, win conditions, >2 players).
3. **Roster + silhouettes** — how many piece types for v1 (engine supports N types with step-range movement today), and their silhouette family (chess-abstract / crystalline / totemic).
4. **Camera contract** — locked isometric + zoom (+ snapped rotation?), per UX research; angle chosen against the lane's framing.
5. **Palette** (3-5 hue budget, blue/orange-family team colors for colorblind safety) + **typography** (Cinzel+Spectral proposed; Fraunces alt).
6. **Scope of the implementation plan** — the ranked backlogs below, cut to a coherent plan-3.

## Pre-ranked implementation backlog (for phase-2 scoping)

**Rendering/juice (from 02, ranked by premium-per-effort):** SDF hex borders/glow → bloom on emissives → toon+rim pieces → gradient sky dome + fog → legal-move glow propagation + pulse rings → vignette + grading → movement easing → capture dissolve → landing ripple → hero-piece glass (targeted) → SSAO/DOF (top tier only).
**UX/UI (from 04, ranked):** legal-move dot/ring system → turn banner with felt handoff → lobby hero-code + copy-as-link + alive waiting + rematch-reuses-room → move/capture juice → match-end modal + calm reconnect + confirm-gated forfeit. Plus: click-click default (drag as desktop extra), micro-undo before commit, captured tray, ~44px touch targets, prefers-reduced-motion, portrait layout plan.
**Assets (from 03):** Blender-scripted hero piece set → custom SVG icon set (~10) → Cinzel/Spectral fonts → Poly Haven HDRI (if wanted) → baked-own matcaps (if wanted).

## Engine follow-ups the design pass may trigger

- More piece types with step-range movement: pure ruleset JSON (cheap, ready today).
- New movement patterns/capture rules/win conditions, board shapes, >2 players: engine code changes — flag any lane/theme choice that needs them BEFORE committing.
- Rematch-reuses-room + reconnect-grace UX: server-side additions (small MatchRoom changes) — fold into the implementation plan if phase 2 adopts them.
