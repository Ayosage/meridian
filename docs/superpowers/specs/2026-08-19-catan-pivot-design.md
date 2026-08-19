# Meridian — Catan Pivot Design

**Date:** 2026-08-19
**Status:** Approved direction (user, 2026-08-19), spec pending user review
**Supersedes:** the abstract hex-tactics game design; the plan-1/plan-2 specs remain accurate as descriptions of the infrastructure they built.
**Parent:** `docs/BRIEF.md` (2026-08-19 revision note)

## 1. What Meridian is now

A **full implementation of Settlers of Catan** — instantly recognizable to
anyone who has played it — rendered at **Civilization-level board artistry**,
built as a **portfolio display piece** (not for sale). Original name
("Meridian") and 100% original/licensed art; the mechanics are Catan's.

**Locked decisions (user, 2026-08-19):**
- Full ruleset in v1: production, building, robber, **player + bank/port
  trading, development cards, longest road, largest army**, 10 VP win.
- **3–4 players from the start** (lobby, server rooms, engine all sized for it).
- **Hybrid asset pipeline:** CC0/CC-BY sourced bases (Kenney, Quaternius,
  Poly Haven) where quality suffices + bespoke Blender-bridge modeling for
  signature pieces, all unified by custom shaders, lighting, and one palette.
- Art is gated by a **beauty slice** (§6) approved interactively before
  full-board production.

## 2. Game rules (v1 = the Catan base game, 3–4 players)

Standard base-game rules, enumerated here as the engine contract:

- **Board:** 19 land hexes — 4 forest (wood), 4 pasture (sheep), 4 field
  (wheat), 3 hill (brick), 3 mountain (ore), 1 desert — ringed by sea with 9
  ports (4 generic 3:1, one 2:1 per resource). Number tokens 2–12 (no 7),
  placed by the standard spiral; 6s and 8s never adjacent (validated).
  Fixed "beginner" layout AND randomized setup both supported (data-driven
  board definition; random is the default).
- **Setup phase:** snake draft — each player places settlement + adjacent
  road (P1→Pn, then Pn→P1); second settlement pays out its adjacent hexes.
- **Turn loop:** roll 2d6 → production (every settlement/city on a matching
  token collects 1/2 of that resource; bank limits apply — if the bank can't
  cover everyone for a resource, nobody gets that resource that roll unless
  only one player is affected) → main phase: any mix of trading and building
  → end turn.
- **Rolling a 7:** no production; every player holding >7 cards discards
  half (rounded down) simultaneously; roller moves the robber to a new hex
  and steals 1 random card from one player adjacent to it. Robbed hex
  produces nothing while occupied.
- **Building costs:** road = brick+wood; settlement = brick+wood+wheat+sheep;
  city = 3 ore + 2 wheat (upgrades a settlement); dev card = ore+wheat+sheep.
- **Placement rules:** settlements on vertices, ≥2 edges from any other
  settlement/city (distance rule), connected to own road network (after
  setup); roads on edges, connected to own network; cities only upgrade own
  settlements. Piece limits per player: 15 roads, 5 settlements, 4 cities.
- **Development cards** (25-card deck: 14 knights, 5 VP, 2 road building,
  2 year of plenty, 2 monopoly): bought face-down, playable from the turn
  after purchase (VP cards exempt — count hidden until win), max one dev
  card played per turn, knight before or after rolling.
- **Trading (main phase, current player only):** player↔player open offers
  (propose specific give/get; others accept/reject/counter), bank 4:1, port
  3:1 (generic) or 2:1 (matching resource port where the player has a
  settlement/city).
- **Awards:** longest road (≥5 continuous, ties keep holder), largest army
  (≥3 knights played, ties keep holder) — 2 VP each, transferable.
- **Win:** first to **10 VP on their own turn** (settlement 1, city 2, VP
  card 1, each award 2). Hidden VP cards mean a win can be declared revealing
  them.
- Out of scope for v1: 5–6 player extension, Seafarers/Cities & Knights,
  friendly-robber house rules, AI players, spectators.

## 3. Engine architecture (packages/rules v2)

The existing pure-TS/no-render-deps discipline stands. The hex-tactics
modules remain (they cost nothing) but the Catan engine is a new model:

- **Topology:** axial hex coords (existing `coord.ts` reused) extended with
  canonical **vertex ids** (hex + direction, normalized so shared vertices
  have one id) and **edge ids** (same approach). A generated adjacency index
  (vertex↔vertex, vertex↔edge, vertex↔hexes, edge↔edges) built once per
  board.
- **State:** one plain immutable `CatanState` — board (hexes: terrain,
  token, robber flag; ports), per-player (resources, dev cards with
  bought-this-turn flags, played knights, piece stocks, buildings), bank
  (resource pools, dev deck order), turn structure (current player, phase,
  dice, pending discards, open trade offer), awards, winner. **Secrets live
  in the state** (hands, deck order) — the SERVER redacts per-seat views
  (§4); the engine stays deterministic and fully testable.
- **Reducer:** `applyCatanIntent(state, intent, rng) → state | RuleError`.
  Intents: rollDice, discard (selection), moveRobber+steal target,
  build(road|settlement|city, location), buyDevCard, playDevCard(type,
  args), offerTrade / respondTrade / confirmTrade / cancelTrade, bankTrade,
  endTurn, and the setup-phase placements. `rng` is injected (seeded) —
  dice, deck shuffle, and robber steals are reproducible in tests.
- **Rules-as-data where honest:** board layouts, costs, piece limits, deck
  composition, VP values as a data file; the placement/production/award
  LOGIC is code (Catan logic is not generically declarative — pillar 4 bends
  here per the revised brief).
- **Derived helpers** for the client: legal placements for the current
  player (vertices/edges/upgrades), affordability, current VP (public +
  own-hand view), longest-road computation (shared with award logic).
- **Testing:** exhaustive unit tests per mechanic (production incl. bank
  shortage, distance rule, connectivity, robber flow, each dev card, trade
  settlement, award transfers incl. ties, hidden-VP win) + property tests
  (topology indices, longest-road on random networks) + full scripted
  4-player game to a win with a seeded rng.

## 4. Server (apps/server evolution)

Colyseus foundation transfers; the room grows substantially:

- **Rooms:** 3–4 players (configurable 3 or 4 at creation; start when full —
  host may start at 3 in a 4-room). Join codes, reconnection grace, forfeit
  → the leaver's assets stay, turns skip them (display-piece pragmatism;
  revisit later).
- **Authoritative loop:** all intents through `applyCatanIntent` with a
  server-held seeded rng; schema mirror carries the **public** state plus
  per-seat private sections (Colyseus schema filters or per-seat messages —
  decided in the implementation plan) so hands/deck stay hidden.
- **Interactive sub-flows** the server orchestrates: simultaneous
  discard-on-7 (phase blocks until all submit), trade offers (open offer →
  responses → current player confirms one), one-dev-card-per-turn and
  bought-this-turn enforcement server-side via the engine.
- **Protocol:** intent schemas extended in `@meridian/protocol` (still no
  player field client-side; seat derived server-side).

## 5. Client (apps/client evolution)

Lobby/connection/store architecture transfers; the scene is rebuilt for the
Catan board (instancing where it fits — tiles, roads; hero meshes where it
doesn't — buildings are few):

- **Board:** 19 diorama terrain tiles + sea ring + ports + number tokens +
  robber. Vertex/edge picking (invisible pick geometry at vertices/edges,
  sized ≥44px screen-space at default zoom).
- **Interactions:** build mode from a costs-aware build bar → legal
  vertices/edges glow (shape-coded per the UX research) → click to place;
  robber placement mode; discard picker; trade composer (offer builder +
  incoming-offer panel); dev card hand.
- **HUD** (from the UX research, now with real information density): turn
  banner + phase, dice with roll ceremony, own hand (resource + dev cards),
  opponents' summaries (card counts, VPs, awards), build costs reference,
  bank/port trade panel, event log. Portrait/responsive plan applies.
- **Juice:** dice roll, resource payout flight from hexes to hand, building
  placement thunk + ripple, robber drag ceremony, award transfer moment,
  win ceremony. (Preparation → Emphasis → Aftermath discipline throughout.)

## 6. Art direction: "Civ-level" defined and gated

- **Bar:** terrain tiles read as miniature dioramas (forest = actual tree
  clusters; mountains = rock massifs with snow; fields = furrowed wheat;
  hills = terraced brick-red clay; pasture = rolling green with sheep;
  desert = dunes), buildings with silhouette-level charm (settlement = tiny
  hamlet, city = walled cluster), sea with animated water shader, warm
  directional light, soft AO, tilt-shift-adjacent framing. Reference
  anchors: Civ VI's resin-diorama material feel, Catan Universe's board
  richness (reference only — zero art copied).
- **Pipeline (hybrid per user decision):** sourced CC0/CC-BY bases
  (Kenney/Quaternius nature + building packs, Poly Haven HDRI/textures)
  where they clear the bar, bespoke Blender-bridge modeling for signature
  meshes (tile bases, buildings, robber, number tokens), ALL unified by a
  shared custom shader treatment (palette ramp, rim, AO bake) so sources are
  indistinguishable. Attribution surface (credits screen) added — CC-BY is
  acceptable now.
- **The beauty-slice gate:** before any full-board work, produce one board
  corner FOR REAL — 3-4 terrain tiles, a settlement + road, a number token,
  sea edge — assembled in Blender, exported, rendered in the actual R3F
  scene with lighting + post. The user iterates on this until it hits the
  bar; the approved slice's assets, palette, lighting rig, and shader
  treatment become the production standard. No flat mockups.
- Perf pillar stands: instanced tiles/trees/roads, budgeted draw calls,
  quality tiers; the richness must still hit 60fps on mid-range hardware.

## 7. Delivery phases (each phase = its own implementation plan(s))

1. **Beauty slice** (interactive with the user — the art gate).
2. **Catan engine** (headless, parallel-safe with 1): topology + state +
   reducer + full test matrix.
3. **Server**: 3-4 player rooms, redaction, sub-flows, protocol.
4. **Board client**: full board render from the approved art standard +
   build/robber interactions.
5. **Trade + dev cards + awards UX**, HUD completion, juice pass.
6. **Polish**: win ceremony, onboarding hints, accessibility pass,
   README/devlog/case-study material for the portfolio.

Milestone: a 3-player match in three browsers from setup draft to a 10-VP
win, on a board that makes people ask "wait, you built this?"

## 8. Risks

- **Scope:** full Catan + 3-4 players is by far the portfolio's largest
  build; the brief's "long-tail, in-progress with devlog is acceptable"
  framing is the pressure valve — phases ship independently.
- **Trade UX** is the hardest interactive surface (async offers between 4
  people); prototype early in phase 5.
- **Hidden information** (hands, deck) is a new server discipline — the
  redaction design in phase 3 must be reviewed carefully; no client-trusted
  secrets.
- **Art bar subjectivity:** the beauty-slice gate exists precisely so the
  bar is settled on real pixels before mass production.
