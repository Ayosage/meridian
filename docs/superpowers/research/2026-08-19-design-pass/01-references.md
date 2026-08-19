# Premium Digital Board/Tactics Game Presentation — Research Report

(Research phase 1 of the Meridian design pass — lane: reference analysis. Agent-produced 2026-08-19.)

## 1. What "premium" actually is

Premium presentation in digital board/tactics games decomposes into a handful of disciplines that recur across every acclaimed title:

- **Silhouette/readability first, decoration second.** Into the Breach's team is explicit: "sacrifice cool ideas for the sake of clarity every time." Every unit's threat/intent is telegraphed before it resolves. Premium boards read at a glance from a fixed camera — piece type, ownership, and state are distinguishable by shape and color alone, not by close inspection.
- **Palette discipline.** Monument Valley's team literally printed every screen and pasted them on a wall as a color script, iterating until the palette held together as one system. Dorfromantik wrote an art-style sheet up front (shapes, proportions, atmosphere, lighting, color, texture, perspective) as a consistency check. The common thread: a small, deliberate palette (3-5 hues + neutrals) beats a "realistic" wide gamut.
- **Materials/lighting mood over polycount.** Civilization VI's "clay and resin diorama" look (vs. cartoonish) became a reference point later titles (Ara, Civ VII) chased — it reads as expensive because the lighting and material treatment imply a physical miniature, not because of geometric detail. Monument Valley uses baked/simple shading + ambient occlusion + fog for depth instead of a real lighting system — cheap to compute, expensive to look at.
- **Camera framing = the diorama contract.** Isometric or tilted-down "looking at a tabletop/scale-model" framing (Into the Breach, Civ VI, Terraforming Mars's "console overlooking the planet") signals premium production because it mimics photographing a real physical object. A void/black background with a single lit island (TFT's Arena, Faeria's board floating on an ocean) reframes the board as a jewel-box object rather than a full "world," which is cheaper to build and often reads as more premium than a busy environment.
- **Motion/juice as the primary premium signal.** Hearthstone's three-phase feedback structure — Preparation (anticipation) → Emphasis (the animation peak) → Aftermath (a beat to process) — is the single most transferable finding here. Card/piece movement is never linear; travel has ease-in/out, impacts have a hitch-frame and camera micro-shake, sound is layered under every animation ("sound is 50% of the experience"). Absence of this is what makes placeholder boards feel like tech demos regardless of shader quality.
- **Environmental storytelling in small doses.** Gloomhaven digital and Armello add weather, day/night, ambient particles, and idle life around a mechanically-static board — these cost little (particle systems, simple loops) but sell "this is a living place," not a math simulation.
- **Board-as-diorama vs. abstract-void framing are both valid premium lanes** — pick one deliberately and commit rather than blending, which is what produces a placeholder look.

## 2. Per-reference takeaways

| Game | Steal | Avoid |
|---|---|---|
| **Dorfromantik** | Write an art-style sheet (shapes/palette/lighting/perspective) before touching shaders — use it as a go/no-go filter for every asset. | Its extreme minimalism can read as "unfinished" without Dorfromantik's tile-laying core loop to justify the calm. |
| **Polytopia** | Flat, saturated, low-poly hex terrain reads instantly as "friendly strategy" and is trivially cheap to build with instanced geometry. | Its cartoon flatness sacrifices dramatic lighting — wrong lane if Meridian wants a moody/serious tone. |
| **Into the Breach** | The Emphasis/Aftermath telegraph discipline (show intent before it resolves) is the single best UX pattern for a capture/move hex tactics game. | Its UI is intentionally spartan-diegetic; don't copy the retro-terminal skin, copy the clarity logic underneath. |
| **Armello** | Procedural 3D hex board with settlements/mountains as prop variety on top of instanced tiles — cheap breadth via prop-kit + placement rules. | Full character animation rigs are exactly the "no character animation budget" Meridian doesn't have. |
| **Faeria** | Board-as-living-ocean framing (hexes emerge from a void/sea) is a strong shader-driven "board is the star" concept, very GLSL-friendly. | Its painterly 2D card-illustration layer requires an artist pipeline Meridian doesn't have. |
| **Duelyst** | Independent lighting on battlefield vs. sprites — the board and pieces can be lit as separate layers for cohesion without matching geometry complexity. | Hand-drawn pixel sprite work is a large asset-production commitment, not shader-driven. |
| **Hearthstone** | The 3-phase animation feedback structure + heavy layered sound design — steal this even without any of its art. | Character-forward camera cuts/close-ups aren't relevant to an overhead tactics board. |
| **Teamfight Tactics (Arena)** | Void-black background + single lit hex island is nearly a direct template for a premium multiplayer hex board — cheap to build, reads as high production value. | Its "Little Legend" mascot/cosmetics layer is a live-service monetization system, out of scope. |
| **Slay the Spire** | Small readability juice (draw/discard streak trails) that doubles as functional information, not just decoration — cheap, high payoff. | Not much to avoid; its UI is close to best-in-class for the genre, low risk to emulate. |
| **Terraforming Mars (digital)** | Reframing the whole game as "looking down at a planet from orbit" turned a flat cardboard hex board into a dramatic diorama with animated growth — a strong single conceptual camera/theme move can transform a plain grid. | The planet-as-model approach needed heavy custom art for the surface; scope the equivalent for Meridian carefully. |
| **Root (Dire Wolf Digital)** | Cel-shaded, illustration-faithful adaptation shows a consistent flat-shaded toon style can feel "top notch" without photorealism. | Requires a large licensed illustration library — not shader/instancing-native. |
| **Gloomhaven (digital)** | Atmospheric lighting + weather + dynamic camera on top of a static board layout is a cheap way to keep a mechanically-fixed tactics board visually alive turn to turn. | Per-brick/per-surface hand detail is asset-heavy; the *lighting/weather* layer is the transferable part, not the geometry detail. |
| **Monument Valley** | Fog + AO + flat shader color instead of a lighting engine is a direct, cheap GLSL technique for making minimal geometry look intentional and expensive. | Total absence of HUD only works because the game has no competitive-info requirement; a multiplayer tactics game can't go that minimal. |

## 3. Hex-specific findings

- **Tile affordances are almost universally three-state:** default (unlit/neutral), hover (soft highlight/glow ring), and legal-move (a distinct color wash or outline). The pattern that keeps clarity: hover state must be visually *quieter* than legal-move state, and legal-move state quieter than "danger/threat" state — a strict brightness/saturation hierarchy so the board never has two competing bright signals at once.
- **Piece design on hex grids favors silhouette-first, top-down-readable shapes.** Classic chess-silhouette design principles (distinct outline per unit type, readable in flat black) transfer directly — each unit type needs a genuinely different base silhouette (cone vs. prism vs. sphere-cluster vs. tapered spike), not just a recolor, or piece identity collapses into color-reading only.
- **Board edge treatment separates "abstract void" and "diorama" lanes.** TFT/Faeria let the hex island end abruptly into black/void or water — edges are a soft glow/fade. Civ VI/Armello treat the edge as a physical boundary. Given no animation budget, the void-fade edge (a radial alpha falloff shader) is the lower-cost, still-premium option.
- **Neighbor-highlighting** (adjacent-tile glow on hover, range rings) recurs as a "premium tells" signal — showing computed legal-move sets as a shaped highlight rather than a generic tint communicates system depth cheaply.

## 4. Three candidate art-direction lanes

**Lane A — "Obsidian Table" (void diorama, cold precision)**
- Mood/palette: near-black void, a single lit hex island in cool slate/graphite, one or two accent hues per faction (e.g., ember orange vs. glacial cyan) used *only* on pieces and highlights, never on the board itself.
- Anchors: TFT Arena, Faeria's void-ocean board, Duelyst's independent board/piece lighting.
- Why cheap-but-expensive: a single directional/rim light + emissive accent shader on instanced primitives does most of the work; no environment art needed beyond a vignette/fog gradient.

**Lane B — "Terrarium" (physical diorama, warm miniature)**
- Mood/palette: warm neutral clay/stone hex terrain (Civ VI "resin diorama"), soft AO, muted earth tones with saturated faction accents on pieces only, tilt-shift DOF to sell miniature scale.
- Anchors: Civilization VI, Dorfromantik, Monument Valley's AO + flat shading.
- Why cheap-but-expensive: tilt-shift DOF is a cheap post-process; AO fakeable; prop-kit primitives placed procedurally sell "handcrafted world."

**Lane C — "Living Current" (organic/elemental, board as material)**
- Mood/palette: the board itself is the spectacle — hexes rendered as crystallizing ice, magma-cracked stone, or emergent coral via GLSL noise/flow shaders, animated idle motion even at rest.
- Anchors: Faeria's living ocean, Armello's day/night world, Gloomhaven's weather layer.
- Why cheap-but-expensive: leans hardest into shader-driven beauty — noise-driven vertex displacement, flow-mapped emissive veins — pure GLSL, zero asset budget, delivers idle "living world" juice.

Given the stack (R3F + custom GLSL, instanced primitives, no character animation budget) and the brief's shader-driven mandate, **Lane C or Lane A are the strongest fits**; Lane B depends more on prop variety and DOF tuning than raw shader work.

## 5. Five highest-leverage moves (ranked)

1. **Install the three-phase move/capture animation (Preparation → Emphasis → Aftermath) with eased motion + a hit-frame + layered sound.** A static instant-snap piece move reads as a tech demo no matter how good the shader is.
2. **Commit to one camera/framing contract and one palette discipline, written down like Dorfromantik's art-style sheet** (3-5 hue budget, enforced).
3. **Build the tile-affordance state hierarchy** (hover < legal-move < threat, strictly increasing brightness/saturation) on the existing per-instance attributes.
4. **Differentiate piece silhouettes by base geometry, not just color**, and add idle life (slow bob, emissive pulse) to pieces at rest.
5. **Add one board-as-material shader effect that runs even when nothing is happening** — animated noise/flow, rim-light void edge, or faction-colored emissive veins. First thing visible before a match starts; most stack-aligned move.

## Sources

- Game Presentation – Dorfromantik: https://news.pegasus.de/en/game-presentation-welcome-to-the-world-of-dorfromantik/
- How Dorfromantik Expands Its Cozy World: https://80.lv/articles/how-dorfromantik-expands-its-cozy-world-through-minimalist-design
- Battle of Polytopia Game Graphics: https://polytopia.io/game-graphics/
- Into the Breach dev on UI design: https://www.gamedeveloper.com/design/-i-into-the-breach-i-dev-on-ui-design-sacrifice-cool-ideas-for-the-sake-of-clarity-every-time-
- Into the Breach's UX: https://blog.prototypr.io/into-the-breachs-ux-makes-you-feel-smart-a9cb03210757
- Into the Breach Design Postmortem (GDC): https://media.gdcvault.com/gdc2019/presentations/Into%20the%20Breach%20Postmortem%20Final.pdf
- Armello presskit: https://armello.com/_press/sheet.php?p=armello
- Faeria's living board — PC Gamer: https://www.pcgamer.com/faerias-living-board-makes-it-stand-out-from-the-card-game-crowd/
- Game UI Database — Faeria: https://www.gameuidatabase.com/gameData.php?id=621
- Duelyst — PC Gamer: https://www.pcgamer.com/duelyst-is-my-favorite-new-card-game-since-hearthstone/
- The "Juice" Factor: https://hackread.com/the-juice-factor-designing-game-feel/
- Hearthstone — Any Key To Start: https://anykeytostart.wordpress.com/2015/03/19/hearthstone/
- TFT Arena — LoL Wiki: https://leagueoflegends.fandom.com/wiki/Arena_(Teamfight_Tactics)
- Riot TFT Art Blast: https://magazine.artstation.com/2020/06/riot-games-teamfight-tactics-league-of-legends-art-blast/
- Slay the Spire — Interface In Game: https://interfaceingame.com/games/slay-the-spire/
- Slay the Spire's UI: https://www.cloudfallstudios.com/blog/2018/2/20/flash-thoughts-slay-the-spires-ui
- Wingspan Digital Review: https://www.boardgamequest.com/wingspan-digital-review/
- Terraforming Mars digital — PC Gamer: https://www.pcgamer.com/terraforming-mars-digital-is-a-quick-playing-alternative-to-tabletop/
- Monument Valley visual style: https://jachonoursproj.wordpress.com/2015/10/03/breaking-down-monument-valleys-visual-style/
- Making of Monument Valley: https://www.creativebloq.com/computer-arts/making-monument-valley-71412213
- Root Digital Review: https://spritesanddice.com/reviews/root-digital-review/
- Gloomhaven Digital Review: https://gamingtrend.com/reviews/gloomhaven-digital-review-lots-of-gloom-lots-of-boom/
