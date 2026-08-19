# Meridian — Board Client (Phase 4) Design

**Date:** 2026-08-19
**Status:** Approved (user, 2026-08-19 — design sections approved in session; this document is the written record)
**Parent:** `docs/superpowers/specs/2026-08-19-catan-pivot-design.md` §5 (client), §7 phase 4
**Art authority:** `docs/ART-STANDARD.md` + the approved beauty slice (merged PR #2)
**Server contract:** merged phase 3 (PR #3) — `CatanClientState` snapshots, `catanIntentSchema`, lobby schema with per-seat `connected` flags

## 1. Scope decisions (user, 2026-08-19)

- **Playable core loop.** Phase 4 ends with a match you can PLAY in the
  browser: setup draft → dice/production → build road/settlement/city →
  7-flow (discard picker, robber placement, steal) → end turn → 10-VP win
  screen. NOT in phase 4 (phase 5): trade composer, dev-card hand and
  plays, awards presentation, HUD completion, the juice pass.
  Consequence accepted: without trading/dev cards some matches progress
  slowly — fine for the phase gate; bots proved wins are reachable on
  builds alone.
- **Lobby goes full Catan.** "Create match" creates a `catan` room (3-or-4
  player choice); the hex-tactics UI flow is retired from the lobby.
  MatchRoom server code, its schema, and its tests stay untouched
  (deletion is later cleanup).

## 2. Asset set completion (Blender MCP, slice pipeline)

Built procedurally in `assets/slice.blend` (parked at fresh x-offsets),
vertex-colored only, checked against ART-STANDARD budgets, exported by
extending `assets/export_slice.py`. New collections → GLBs:

| Asset | Recipe | Notes |
|---|---|---|
| `terrain_pasture` | scatter | rolling green cap + 2–3 procedural sheep minis (blob body, head, legs; cream wool, dark face) |
| `terrain_hills` | sculpt/pattern | terraced terracotta clay benches (3–4 concentric terraces, brick-toned) |
| `terrain_desert` | pattern | parchment dune ridges, sparse dry tufts; carries no token |
| `piece_city` | building kit | walled cluster: 2 joined house bodies + tower, player-tinted roofs, stone wall ring |
| `piece_robber` | bespoke | dark hooded pawn, ~settlement height ×1.3, matte near-black with cool rim |
| `piece_port` | bespoke | small pier + sail marker; sail carries the port kind (2:1 resource tint or generic cream) |
| `tokens` | slice token recipe ×11 | numerals 2–12 (no 7) as named nodes `token_2`…`token_12` in ONE GLB; red numerals for 6/8, charcoal otherwise; probability dots per rank |

- **Baked numerals, not runtime text**: matches the approved engraved-disc
  art exactly and avoids font/licensing/crispness concerns. ~600 tris per
  numeral is within budget.
- **Player-color strategy:** settlement roof is already a separate mesh;
  the city roofs and the road are likewise separate meshes exported with
  NEUTRAL (white-ish) vertex colors so the client multiplies in the seat
  color (`palette.players`). One GLB serves all four seats. The slice
  settlement's baked red roof gets re-exported neutral the same way.
- **Sourced CC0 remains the fallback** (pivot spec hybrid rule) if a piece
  resists proceduralism; nothing here is expected to.

## 3. Scene architecture (`apps/client/src/scene/catan/`)

- **Store:** `catanStore.ts` (zustand) — latest `CatanClientState` (from
  `MSG.SNAPSHOT`, replacing whole-view on seq advance), connection status,
  seat, and UI state (mode, selection, pending intent). The old hex store
  stays untouched.
- **Net:** `net/catan.ts` — join/create/reconnect for `catan` rooms,
  message wiring (SNAPSHOT → store, RULE_ERROR → toast queue, MATCH_ENDED
  → win state), intent send helpers typed by `CatanClientIntent`.
- **Board:** `CatanBoard.tsx` renders `view.board.hexes`: shared puck GLB
  + per-terrain dressing GLB (slice mountains/forest/fields + §2 three) as
  clones at `coordToWorld` positions; number-token clone per hex
  (`token_<n>` node); robber mesh at `view.board.robber`; ports at their
  edge positions. Sea: the slice water shader promoted from `dev/slice/`
  to `scene/catan/waterMaterial.ts` with all 19 hex centers (foam ring
  hugs the whole island). Lighting rig + sky dome + post stack likewise
  promoted from the slice scene into `CatanScene.tsx`; the `/slice` dev
  route keeps working by importing the promoted modules.
- **Pieces:** settlements/cities from `view.buildings`, roads from
  `view.roads`, positioned via topology (`vertexId`/`edgeId` → world
  coords — a new `catanLayout.ts` derives vertex/edge world positions from
  the hex layout; property-tested against `standardTopology()`).
- **Perf plan (60fps gate):** clone-per-tile first; measure draw calls +
  fps; if over budget, promote the two high-count repeats (forest pines,
  fields tufts) to per-variant `InstancedMesh` across the whole board (the
  GLBs share meshes for exactly this). Record before/after in
  `docs/PERF.md`. Quality tiers as in the slice (`?tier=low` drops N8AO).

## 4. Interactions

- **Pick layer:** invisible raycast targets — 54 vertex spheres + 72 edge
  capsules from `standardTopology()`, sized ≥44px screen-space at default
  zoom. Tile picking (robber mode) reuses hex raycast planes.
- **Legality glow:** `legalSettlementVertices` / `legalRoadEdges` /
  `legalCityVertices` run CLIENT-SIDE on the redacted view (phase-3
  `PlacementView` retyping) — shape-coded markers (ring pulse on vertices,
  bar glow on edges), player-colored. The server remains the authority;
  client legality is a UX hint only.
- **Modes** (a small state machine in the store, unit-tested):
  - `setup`: auto-enters place-settlement then place-road, following
    `turn.setup.expect`.
  - `idle` main phase: build bar buttons (road/settlement/city) enter
    placement mode when affordable (cost check on `you.resources` via
    `COSTS` + `hasResources`); Esc/right-click cancels.
  - `discard`: modal picker forced open when `turn.pendingDiscards[seat]`
    exists — select exactly N of your cards, submit.
  - `robber`: forced after own 7 roll (phase `robber` + current === seat):
    pick a hex, then a steal target from a chooser listing eligible
    adjacent players (or auto-none).
- **Intent flow:** every action sends a `catanIntentSchema` message; UI
  never mutates game state locally; `RULE_ERROR` shows a toast and clears
  the pending mode.

## 5. Minimal HUD (phase-4 slice of pivot spec §5)

- Turn banner: whose turn + phase; dice faces with the rolled result.
- Own hand: five resource counts (icon + number).
- Opponent strip: per seat — resource-card count, dev-card count, knights,
  public VP, and an "away — autopilot" badge from the lobby schema
  `connected` flags.
- Build bar with live affordability; roll button (preRoll, own turn); end
  turn button (main, own turn); room code display.
- Win overlay: winner seat + `winnerVpCards` reveal, rematch = back to
  lobby (rematch flow proper is later).
- Styling: extend the existing `hud.css` approach; no component library.

## 6. Lobby

- Create: player-count choice (3/4) → `joinOrCreate('catan', { players })`.
- Waiting room: seat list from lobby schema, room code, and for the host
  of a 4-room with exactly 3 seated, a "start now" button (`MSG.START`).
- Join-by-code and the sessionStorage reconnect-token flow carry over
  (server-side seat reclaim from the pilot already works). Fix in passing:
  key the token by room id (the known same-context tab-hijack footgun).

## 7. Testing + phase gate

- Unit: catanLayout vertex/edge world positions (property test against
  `standardTopology` adjacency); store snapshot ingestion (seq ordering,
  stale-snapshot rejection); mode state machine (setup/build/discard/
  robber transitions, RULE_ERROR reset).
- E2E (Playwright, one browser CONTEXT per player — the sessionStorage
  footgun): 3 players complete the setup draft, roll until production
  pays, build a road + settlement, survive a 7 (discard + robber + steal),
  upgrade to a city, and reach the win overlay via a seeded room
  (`seed`/`rngScript` create options are already server-supported).
- Perf snapshot in `docs/PERF.md`: draw calls, triangles, fps at default
  zoom on the full 19-tile board, high and low tier — 60fps gate.
- Visual gate: user reviews the running board (golden-hour rig on the full
  island) — same "ship it" bar as the slice.

## 8. Risks

- **Asset volume** is the schedule risk (6 new asset groups + neutral-roof
  re-export). Mitigation: every one reuses a proven slice recipe; the art
  standard sheet is the go/no-go filter; build order puts the three
  terrains first so the full board renders early.
- **Draw calls** on a 19-tile board with cloned dressings may miss 60fps —
  the instancing fallback is designed in (§3), not an afterthought.
- **Vertex/edge pick precision** at gameplay zoom: the ≥44px rule is a
  hard check in the E2E (click through Playwright at default zoom).
- **Retiring the placeholder UI** must not break `MatchRoom` server tests
  — the lobby stops ROUTING to hex-tactics, the code stays.
