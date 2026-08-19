# Meridian — Project Brief

> **REVISED 2026-08-19 (supersedes the "original abstract game" framing below):**
> Meridian is a **Settlers of Catan implementation** — the real Catan loop
> (resource terrain hexes, number tokens, dice production, settlements/cities
> on vertices, roads on edges, the robber, victory points) so viewers
> instantly recognize what they're looking at. Original name and original
> art; the mechanics are Catan's. Visual bar: **Civilization-level board
> artistry** — terrain tiles as rich mini-dioramas (forests, pastures,
> fields, hills, mountains, sea), detailed buildings, real 3D assets, not
> abstract minimalism. This is a **portfolio display piece, not a product**.
> Pillar 1's "art direction over asset quantity" is replaced by: rich assets
> unified by custom shaders and lighting. Pillars 2-4 (performance,
> multiplayer-first, rules-as-data where practical) stand. The hex-tactics
> placeholder ruleset and the plan-2 client were infrastructure milestones;
> the Catan data model (vertices/edges/resources) is a new engine cycle.

**What:** An original online board game built in React Three Fiber. The
long-tail portfolio project (in-progress with a public devlog is fine).

## Pillars (locked)

1. **Hyper-stylized** — the look is the hook: custom GLSL shaders (board
   surface, piece materials, move/capture VFX), cohesive art direction over
   asset quantity. No stock-asset look.
2. **Performance-driven** — 60fps on mid-range laptops and phones: instancing,
   draw-call budget, no per-frame allocations, adaptive quality tiers
   (threejs-graphics-optimizer skill applies).
3. **Multiplayer from day 1** — authoritative Node WebSocket server owns game
   state; clients send intents, receive state diffs. No "add multiplayer
   later."
4. **Expansion baked in** — rules are data, not code: pieces, abilities, board
   layouts defined declaratively so expansions are content drops. The rules
   engine is pure TypeScript, shared client/server, fully unit-testable
   without rendering.

**Stack:** R3F + drei + custom GLSL, zustand client state, Node + ws (or
Colyseus — decide in design cycle) authoritative server, shared
`packages/rules` engine, Turborepo monorepo, Vitest.

## Game design status

The actual game (theme, board shape, piece roster, win condition) gets its own
design cycle before rendering work starts. Until then, infrastructure tasks
below are needed regardless of which board game this becomes — the rules
engine is developed against a placeholder ruleset (simplified hex
tactics: move + capture + last-player-standing) that exercises every engine
interface and gets replaced by the real ruleset later.

## Milestone 1

Two players in different browsers complete a full match of the placeholder
ruleset on a shader-styled board: lobby → join → alternate turns → win state —
authoritative server, reconnection-safe.

## Non-goals (v1)

- Matchmaking/ranking, accounts (lobby codes only), mobile apps (responsive
  web only), sound design, AI opponent.
