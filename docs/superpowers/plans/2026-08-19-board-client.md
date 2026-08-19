# Board Client (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable Catan match in the browser on the full 19-tile diorama board — setup draft → roll → build → 7-flow → win — consuming phase-3 per-seat snapshots.

**Architecture:** Blender-MCP asset completion first (three terrains, city/robber/ports, 11 tokens, neutral-tint re-export), then a new `scene/catan/` client stack: zustand store fed by `MSG.SNAPSHOT`, board rendered from GLB clones at topology-derived positions, invisible vertex/edge pick layer with view-computed legality glow, minimal HUD. The slice's rig/water/post promote to production modules.

**Tech Stack:** Blender 5 via MCP + headless CLI export, R3F + drei + @react-three/postprocessing, zustand, colyseus.js, Vitest, Playwright (3 isolated contexts).

**Spec:** `docs/superpowers/specs/2026-08-19-board-client-design.md`

## Global Constraints

- Art: every asset passes `docs/ART-STANDARD.md` (identity tests + budgets); vertex colors only, no textures; GLB exports via `assets/export_slice.py`, re-centered from parking offsets.
- `packages/rules` stays render-free; MatchRoom server code/tests untouched (spec §1 — only the lobby stops routing to hex-tactics).
- Server is the only authority: the client never mutates game state locally; legality queries are UX hints.
- Blender asset tasks are ITERATIVE: run script → viewport screenshot → judge against ART-STANDARD → adjust. The scripts below are calibrated starting points, not final answers. Save `assets/slice.blend` after each asset lands.
- Kill stale dev servers on :5173/:2567/:2568 before any E2E or manual run.
- Working branch `feat/board-client`. Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Blender MCP health check (get_scene_info → execute print("ok") → screenshot) before the first asset task; exports go through headless CLI, never the MCP socket.

---

### Task 1: Neutral-tint re-export (settlement roof, road) + tint contract

**Files:**
- Modify: `assets/slice.blend` (via Blender MCP)
- Modify: `assets/export_slice.py` (no changes expected — same collections)
- Re-export: `apps/client/public/assets/slice/settlement.glb`, `road.glb`

**Interfaces:**
- Produces: the TINT CONTRACT all piece tasks and the client rely on — any GLTF node whose name ends in `_tint` is exported with grayscale vertex colors (value carries shading detail, hue absent) and the client multiplies in the seat color. Renamed nodes: `hs_roof` → `hs_roof_tint`; `road` → `road_tint`.

- [ ] **Step 1: Recolor + rename in Blender (MCP)**

```python
import bpy
from mathutils import Vector
# roof + road: strip hue, keep the banding/grain as VALUE variation
for obj_name, base in (("hs_roof", 0.85), ("road", 0.85)):
    ob = bpy.data.objects[obj_name]
    col = ob.data.color_attributes["Col"]
    for d in col.data:
        # perceived luminance of the old red, remapped to a bright neutral band
        lum = 0.2126*d.color[0] + 0.7152*d.color[1] + 0.0722*d.color[2]
        v = base * (0.55 + lum * 1.3)   # keep contrast, bias bright so tint*v stays vivid
        d.color = (v, v, v, 1.0)
    ob.name = obj_name + "_tint"
    ob.data.update()
bpy.ops.wm.save_mainfile()
```

- [ ] **Step 2: Screenshot the settlement + road in the viewport** — shingle rows and road bevels must still read as VALUE variation (light/dark bands), now in grayscale.
- [ ] **Step 3: Headless re-export; verify names survived GLTF mapping**

```bash
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
"$BLENDER" --background assets/slice.blend --python assets/export_slice.py 2>&1 | grep EXPORTED
cd /private/tmp/claude-501/-Users-brandonsmith-Desktop-webdev/*/scratchpad && ./node_modules/.bin/gltf-transform inspect \
  /Users/brandonsmith/Desktop/webdev/meridian/apps/client/public/assets/slice/settlement.glb | grep -i tint
```

Expected: node `hs_roof_tint` (underscores survive; dots would not — see ART-STANDARD name-mapping note).

- [ ] **Step 4: Commit**

```bash
git add assets/slice.blend apps/client/public/assets/slice/settlement.glb apps/client/public/assets/slice/road.glb
git commit -m "feat(assets): neutral-tint roof and road — _tint node contract for runtime player colors"
```

---

### Task 2: Terrain dressings — pasture, hills, desert

**Files:**
- Modify: `assets/slice.blend` (three new collections: `terrain_pasture` @ x=10, `terrain_hills` @ x=12, `terrain_desert` @ x=14)
- Modify: `assets/export_slice.py` (add the three collections to `EXPORTS` with their offsets)
- Create (exported): `apps/client/public/assets/slice/terrain_pasture.glb`, `terrain_hills.glb`, `terrain_desert.glb`

**Interfaces:**
- Produces: three dressing GLBs, origin at tile center, sitting on the puck top (z=0.22 in Blender, y=0.22 in three.js) — same contract as the slice terrains. No pucks inside the GLBs.

Recipes (iterate with screenshots; palette values are the spec):

- **Pasture (scatter recipe):** domed cap like `forest_ground` but meadow green (`(0.18,0.32,0.12)`→`(0.30,0.44,0.18)` noise lerp), low grass clumps (reuse the fields tuft generator: blade color meadow green, height 0.03, ~80 clumps scattered not row-aligned), and **3 sheep**: body = icosphere subdiv 2 stretched (0.055, 0.04, 0.038) with noise-puffed wool verts, cream `(0.88,0.85,0.78)`; head = small box (0.018) charcoal `(0.12,0.11,0.10)` at +x; 4 leg stubs (0.006 cylinders) charcoal; ~250 tris each; place off-center, one grazing (head low), varied yaw.
- **Hills (sculpt/pattern recipe):** 3 concentric terraced benches — build from 3 stacked, noise-jittered hex-ish discs (radii 0.78/0.55/0.32, each 0.055 tall with a 0.02 top bevel feel via vertex push), terracotta ramp `(0.55,0.25,0.15)` risers → `(0.72,0.42,0.28)` treads, thin darker rim line at each riser top via vertex color band; a few scattered brick-red boulders (displaced icospheres subdiv 2, scale ~0.05) on the treads.
- **Desert (pattern recipe):** the fields furrow generator repurposed — wavelength 0.34, amp 0.018, TWO noise-rotated dune directions blended, parchment `(0.78,0.68,0.48)` crests → `(0.60,0.50,0.34)` troughs, plus 5-6 sparse dry tufts (fields tuft mesh, straw `(0.62,0.55,0.38)`, scale 0.7). No token sits here (engine gives desert `token: null`).

- [ ] **Step 1:** Build pasture (cap → clumps → sheep), screenshot at the slice camera angle, judge vs ART-STANDARD (miniature realism, palette midtones, ≤2.5k tris), iterate.
- [ ] **Step 2:** Build hills the same way (≤2.5k tris).
- [ ] **Step 3:** Build desert the same way (≤2k tris).
- [ ] **Step 4:** Add to `EXPORTS` in `assets/export_slice.py`:

```python
"terrain_pasture": ("terrain_pasture", 10.0, ()),
"terrain_hills": ("terrain_hills", 12.0, ()),
"terrain_desert": ("terrain_desert", 14.0, ()),
```

- [ ] **Step 5:** Save blend, headless export, `gltf-transform inspect` each GLB (COLOR_0 present, tri budget respected, bbox min-y ≈ 0.22).
- [ ] **Step 6: Commit** (`feat(assets): pasture, hills, desert terrain dressings`).

---

### Task 3: Pieces — city, robber, ports

**Files:**
- Modify: `assets/slice.blend` (collections `piece_city` @ x=16, `piece_robber` @ x=17, `piece_port` @ x=18); `assets/export_slice.py` (+3 EXPORTS entries)
- Create (exported): `city.glb`, `robber.glb`, `port.glb`

**Interfaces:**
- Produces: `city.glb` with roofs in `_tint`-named nodes (Task 1 contract); `robber.glb` single node; `port.glb` with a `sail_tint`-style variant NOT used — instead the sail is neutral cream and the client tints per port kind (generic stays cream). Origins at ground center (z=0), like settlement.

Recipes:

- **City (building-kit recipe, reuse Task-1-era settlement part functions):** two joined gabled bodies (footprints 0.20×0.14 and 0.14×0.11, ridge heights 0.22/0.17, offset in an L), one square tower (0.07² × 0.30 with a pyramidal `_tint` cap), stone wall ring (low beveled box arc segments, 0.03 tall) around the footprint, stepped shingle roofs on both bodies as `city_roofs_tint` (one joined mesh), plaster/timber/stone parts reuse the settlement palette. ≤400 tris, ≤5 nodes, roofs+tower-cap in tint nodes.
- **Robber:** lathe-ish hooded pawn — cylinder base (r 0.045) swelling to a hood: build from a 12-seg cylinder, scale rings inward per height, pull a hood lip forward; height 0.26 (≈1.3× settlement wall+roof read); near-black `(0.10,0.10,0.12)` with a faint cool top gradient `(0.20,0.22,0.28)`. ≤300 tris, 1 node.
- **Port:** short pier (2 plank boxes on 4 post stubs, driftwood gray-brown) pointing inward + a single triangular sail on a mast at the pier's outer end, sail neutral cream `(0.92,0.88,0.80)` named `sail` (client tints 2:1 sails by resource color, leaves generic cream); ≤250 tris.

- [ ] **Step 1:** Build + screenshot + iterate each (city first — hardest).
- [ ] **Step 2:** EXPORTS entries (16.0/17.0/18.0 offsets), save, headless export, inspect (tint node names survive; budgets).
- [ ] **Step 3: Commit** (`feat(assets): city, robber, port pieces`).

---

### Task 4: Number tokens 2–12

**Files:**
- Modify: `assets/slice.blend` (collection `piece_tokens` @ x=20; the existing `piece_token` "8" collection stays for the slice)
- Modify: `assets/export_slice.py` (+1 entry → `tokens.glb`)
- Create (exported): `apps/client/public/assets/slice/tokens.glb`

**Interfaces:**
- Produces: one GLB with 11 group nodes named `token_2` … `token_12` (no 7), each = disc + numeral + probability dots, disc centered at its group origin. The client clones `token_<n>` by node name (GLTF keeps underscores).

- [ ] **Step 1: Generate all 11 via script** — reuse the slice token build (disc r=0.15, bevel, ring-noise cream) in a loop; numeral text size 0.13, dots `'•' * pips` where pips = 6−|7−n| (2→1 … 6/8→5); numeral+dots RED `(0.55,0.08,0.06)` for 6 and 8, charcoal `(0.15,0.13,0.11)` otherwise; glyphs at z=0.030 (the z-fight lesson: ≥5mm proud). Parent disc+numeral+dots per token to an EMPTY named `token_<n>` at (20 + (n%4)*0.4, floor offset, 0) so the export re-centers per group — CHECK: the exporter shifts objects by collection offset; group empties keep relative placement. Simpler alternative if empties complicate export: bake each token to ONE mesh object named `token_<n>` (join disc+glyphs) — do this; single-mesh tokens are also cheaper to clone.
- [ ] **Step 2:** Screenshot the 11-token grid; legibility check at gameplay-zoom-equivalent distance; decimate numerals if any exceed ~700 tris (`limited dissolve` on glyph meshes).
- [ ] **Step 3:** EXPORTS entry `"piece_tokens": ("tokens", 20.0, ())` — BUT tokens are parked in a grid around x=20: re-center by shifting −20 in x only; per-token grid offsets stay baked into node positions, and the CLIENT reads each `token_<n>` node's mesh and renders it at the hex position ignoring the node transform (clone the mesh, not the node transform). Document this in the export log line.
- [ ] **Step 4:** Save, export, inspect (11 meshes, names intact), commit (`feat(assets): number tokens 2-12`).

---

### Task 5: `catanLayout.ts` — vertex/edge world positions

**Files:**
- Create: `apps/client/src/scene/catan/catanLayout.ts`
- Test: `apps/client/test/catanLayout.test.ts`

**Interfaces:**
- Consumes: `coordToWorld` (`../layout`), `standardTopology`, `spiralCoords`, `DIRECTIONS`, `add`, `coordKey`, `vertexId`, `edgeId` from `@meridian/rules`.
- Produces: `vertexWorld(): ReadonlyMap<VertexId, [number, number, number]>`; `edgeWorld(): ReadonlyMap<EdgeId, { pos: [number, number, number]; angle: number }>` (angle = Y-rotation aligning a +X-modeled road along the edge). Both memoized module-level.

Math: a hex corner is the CENTROID of the three hex centers meeting there (exact on a regular hex grid); an edge midpoint is the MIDPOINT of the two adjacent hex centers, and the edge runs PERPENDICULAR to the center-to-center line.

- [ ] **Step 1: Write the failing test**

```ts
// apps/client/test/catanLayout.test.ts
import { describe, expect, it } from 'vitest'
import { standardTopology, vertexId, edgeId } from '@meridian/rules'
import { vertexWorld, edgeWorld } from '../src/scene/catan/catanLayout'
import { coordToWorld } from '../src/scene/layout'

describe('catanLayout', () => {
  it('covers every topology vertex and edge exactly once', () => {
    const topo = standardTopology()
    const vw = vertexWorld()
    const ew = edgeWorld()
    expect(vw.size).toBe(topo.vertices.length) // 54
    expect(ew.size).toBe(topo.edges.length) // 72
    for (const v of topo.vertices) expect(vw.get(v)).toBeDefined()
    for (const e of topo.edges) expect(ew.get(e)).toBeDefined()
  })

  it('a corner is equidistant (= circumradius 1) from its owning hex center', () => {
    const vw = vertexWorld()
    const [cx, , cz] = coordToWorld({ q: 0, r: 0 })
    const corner = vw.get(vertexId({ q: 0, r: 0 }, 2))!
    const d = Math.hypot(corner[0] - cx, corner[2] - cz)
    expect(d).toBeCloseTo(1, 5)
  })

  it('an edge midpoint sits halfway between the two hex centers, angle perpendicular', () => {
    const ew = edgeWorld()
    const e = ew.get(edgeId({ q: 0, r: 0 }, 0))! // toward {q:1,r:0} — centers differ along +x
    const a = coordToWorld({ q: 0, r: 0 })
    const b = coordToWorld({ q: 1, r: 0 })
    expect(e.pos[0]).toBeCloseTo((a[0] + b[0]) / 2, 5)
    expect(e.pos[2]).toBeCloseTo((a[2] + b[2]) / 2, 5)
    // centers along +x → edge runs along z → +X-modeled road rotates 90°
    expect(Math.abs(Math.sin(e.angle))).toBeCloseTo(1, 5)
  })
})
```

- [ ] **Step 2:** Run (`cd apps/client && pnpm exec vitest run catanLayout`) — FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
// apps/client/src/scene/catan/catanLayout.ts
import {
  add,
  DIRECTIONS,
  spiralCoords,
  vertexId,
  edgeId,
  type EdgeId,
  type VertexId,
} from '@meridian/rules'
import { coordToWorld, TILE_SIZE } from '../layout'

export const TILE_TOP = 0.22

function centroid3(a: [number, number, number], b: typeof a, c: typeof a): [number, number, number] {
  return [(a[0] + b[0] + c[0]) / 3, TILE_TOP, (a[2] + b[2] + c[2]) / 3]
}

let vw: Map<VertexId, [number, number, number]> | null = null
let ew: Map<EdgeId, { pos: [number, number, number]; angle: number }> | null = null

/** World position of every board vertex (corner = centroid of the 3 meeting hex centers). */
export function vertexWorld(): ReadonlyMap<VertexId, [number, number, number]> {
  if (vw) return vw
  vw = new Map()
  for (const hex of spiralCoords()) {
    for (let c = 0; c < 6; c++) {
      const id = vertexId(hex, c)
      if (vw.has(id)) continue
      vw.set(
        id,
        centroid3(
          coordToWorld(hex, TILE_SIZE),
          coordToWorld(add(hex, DIRECTIONS[c]!), TILE_SIZE),
          coordToWorld(add(hex, DIRECTIONS[(c + 1) % 6]!), TILE_SIZE),
        ),
      )
    }
  }
  return vw
}

/** World midpoint + Y-rotation for every board edge (a +X-modeled road aligns via angle). */
export function edgeWorld(): ReadonlyMap<EdgeId, { pos: [number, number, number]; angle: number }> {
  if (ew) return ew
  ew = new Map()
  for (const hex of spiralCoords()) {
    for (let d = 0; d < 6; d++) {
      const id = edgeId(hex, d)
      if (ew.has(id)) continue
      const a = coordToWorld(hex, TILE_SIZE)
      const b = coordToWorld(add(hex, DIRECTIONS[d]!), TILE_SIZE)
      const angle = Math.atan2(b[2] - a[2], b[0] - a[0]) + Math.PI / 2
      ew.set(id, { pos: [(a[0] + b[0]) / 2, TILE_TOP, (a[2] + b[2]) / 2], angle })
    }
  }
  return ew
}
```

- [ ] **Step 4:** Tests PASS; commit (`feat(client): catanLayout — topology-derived vertex/edge world positions`).

---

### Task 6: Catan store + net layer

**Files:**
- Create: `apps/client/src/scene/catan/catanStore.ts`
- Create: `apps/client/src/net/catan.ts`
- Modify: `apps/client/src/net/tokenStorage.ts` (key by room id — the tab-hijack footgun fix)
- Test: `apps/client/test/catanStore.test.ts`

**Interfaces:**
- Consumes: `CatanSnapshotPayload`, `CatanClientIntent`, `MSG` from `@meridian/protocol`; `CatanClientState` from `@meridian/rules`.
- Produces: `useCatanStore` with `{ status, roomId, seat, view, toast, winner, mode, ingestSnapshot(payload), setMode(mode), ... }`; `Mode = { kind: 'idle' | 'placeSettlement' | 'placeRoad' | 'placeCity' | 'discard' | 'robber' | 'steal', ... }` (discriminated union; `robber` carries no data, `steal` carries `{ hex: Coord; victims: number[] }`); net functions `createCatanMatch(players)`, `joinCatanMatch(code)`, `reconnectCatan()`, `sendCatanIntent(intent)`, `startEarly()`, plus a derived-mode rule: snapshots FORCE modes (setup expect, own pending discard, own robber phase) — the state machine is store logic, unit-testable without React.

- [ ] **Step 1: Write failing store tests** — snapshot ingestion replaces view only when `seq` advances (stale snapshots dropped); forced modes: setup expect=settlement → mode placeSettlement; own `pendingDiscards[seat]` → discard; phase robber + current===seat → robber; RULE_ERROR toast resets a placement mode to idle but NOT a forced mode. Build the test around plain store calls with hand-built `CatanClientState` fixtures (a `makeView(overrides)` helper with a minimal valid view).
- [ ] **Step 2: Implement store** — zustand vanilla-compatible (like `store.ts`); `ingestSnapshot` computes the forced mode from the view + seat; keep a pure exported `deriveMode(view, seat, current: Mode): Mode` so tests hit it directly.
- [ ] **Step 3: Implement `net/catan.ts`** mirroring `net/connection.ts`: `joinOrCreate('catan', { players })` / `joinById` / `reconnect` with the room-id-keyed token, `onMessage(MSG.SNAPSHOT)` → `ingestSnapshot`, RULE_ERROR → toast, MATCH_ENDED → winner, lobby schema `onStateChange` → seats/connected/waiting status. `tokenStorage` gains `set(roomId, token)/getFor(roomId)/getAny()` (getAny returns `{roomId, token}` for auto-resume; keying prevents a copied sessionStorage from hijacking a DIFFERENT room's seat only — same-room copy remains, acceptable).
- [ ] **Step 4:** Tests + `tsc --noEmit` PASS; commit (`feat(client): catan store, net layer, forced-mode state machine`).

---

### Task 7: Lobby — player count, waiting room, host start

**Files:**
- Modify: `apps/client/src/ui/Lobby.tsx`
- Create: `apps/client/src/ui/WaitingRoom.tsx`
- Modify: `apps/client/src/ui/hud.css`

**Interfaces:**
- Consumes: `createCatanMatch(3|4)`, `joinCatanMatch`, `startEarly` (Task 6); lobby state from `useCatanStore`.
- Produces: lobby UI — "Create match" now shows a 3/4 segmented choice (`data-testid="players-3"`, `"players-4"`, default 4) and calls `createCatanMatch`; join unchanged but calls `joinCatanMatch`. `WaitingRoom` shows code, seat list with connected dots, and `data-testid="start-early"` for the host when `seats === 3 && target === 4`.

- [ ] **Step 1:** Implement both components (plain JSX, existing lobby styling idiom, all interactive elements carry data-testids: `create-button`, `players-3/4`, `join-input`, `join-button`, `start-early`).
- [ ] **Step 2:** `tsc --noEmit`; quick manual check (`pnpm exec vite`, create a room, see the waiting room + code).
- [ ] **Step 3:** Commit (`feat(client): catan lobby — player count choice, waiting room, host early start`).

---

### Task 8: CatanScene — board render with promoted rig/water/post

**Files:**
- Create: `apps/client/src/scene/catan/CatanScene.tsx`, `CatanBoard.tsx`, `Pieces.tsx`, `waterMaterial.ts` (promoted), `rig.tsx` (GoldenHourRig + SkyBackdrop promoted)
- Modify: `apps/client/src/dev/slice/SliceScene.tsx` (import promoted modules instead of local copies)
- Create: `apps/client/src/dev/board/BoardPreview.tsx` + route `/board` in `main.tsx` (dev-only: renders a LOCAL beginner-board view via `createCatanGame` + `redactCatanState` — visual iteration without a server)

**Interfaces:**
- Consumes: GLBs (Tasks 1–4), `catanLayout` (Task 5), `useCatanStore.view` (Task 6), palette.
- Produces: `<CatanScene />` rendering from a `CatanClientState`: 19 pucks + terrain dressings by `hex.terrain` (`forest→terrain_forest`, `fields→terrain_fields`, `mountains→terrain_mountains`, `pasture/hills/desert→` Task 2 GLBs), `token_<n>` clone per non-desert hex (offset to each terrain's documented clear spot; reuse slice token offsets for the three slice terrains, pick clear spots for the new three during Task 2 and record them in a `TOKEN_SPOT: Record<Terrain, [x,y,z]>` map), robber at `view.board.robber` hex center (y = terrain-aware via TOKEN_SPOT height + 0.02), ports at their two-vertex midpoint pushed outward, settlements/cities/roads from `view.buildings`/`view.roads` at `vertexWorld`/`edgeWorld` positions with `_tint` meshes multiplied by `palette.players` seat color (clone materials before tinting — clones share materials otherwise). Water = promoted shader with `MAX_TILES` raised to 24 and all 19 centers. Camera: default `[0, 9, 8]` fov 42 + OrbitControls (pan disabled, zoom 6–14, maxPolar 0.45π).

- [ ] **Step 1:** Promote `waterMaterial.ts` (raise `MAX_TILES` to 24), `rig.tsx` from `dev/slice/` into `scene/catan/`; re-point SliceScene imports; `/slice` still renders (screenshot check).
- [ ] **Step 2:** Implement `CatanBoard`/`Pieces` (tint via `traverse` on clone: `if (o.isMesh && o.name.endsWith('_tint')) { o.material = o.material.clone(); o.material.color.set(seatColor) }`).
- [ ] **Step 3:** `/board` dev route with the local beginner view; drive with Playwright; screenshot; judge the full island vs ART-STANDARD (this is the first full-board look — iterate lighting intensity/camera here).
- [ ] **Step 4:** Perf check on `/board`: rAF fps + `renderer.info` draw calls via the existing `__meridianDebug` idiom (add a dev hook to CatanScene). If draw calls > ~250 or fps < 60 at dpr 2: implement the instancing fallback for pines + tufts (merge per-variant across tiles into `InstancedMesh` built once from the GLB geometry at mount). Record numbers in `docs/PERF.md`.
- [ ] **Step 5:** Commit (`feat(client): CatanScene — full 19-tile board, promoted rig/water, /board preview`).

---

### Task 9: Pick layer, legality glow, build bar

**Files:**
- Create: `apps/client/src/scene/catan/PickLayer.tsx`, `apps/client/src/scene/catan/Highlights.tsx`, `apps/client/src/ui/BuildBar.tsx`
- Test: `apps/client/test/buildFlow.test.ts` (store-level: mode transitions + intent emission via an injected `send` spy)

**Interfaces:**
- Consumes: `vertexWorld`/`edgeWorld`, `legalSettlementVertices`/`legalRoadEdges`/`legalCityVertices` (view-typed), `COSTS`/`hasResources`, store modes (Task 6), `sendCatanIntent`.
- Produces: invisible pick meshes — 54 spheres (r=0.16) + 72 boxes (0.55×0.1×0.14 rotated by edge angle) with `visible={false}`-material but raycastable (use `<mesh>` with `material-transparent material-opacity={0}` and `raycast` intact); pointer handlers dispatch by store mode: placeSettlement→click legal vertex sends `build settlement` (or `placeSetupSettlement` in setup), placeRoad→edge, placeCity→own-settlement vertex; robber mode → hex plane click sets `steal` mode with victims (computed from view: adjacent owners with resourceCount>0, minus self) or sends `moveRobber` with `stealFrom: null` when no victims; steal mode → victim chooser (HUD element, Task 10). `Highlights` renders pulse rings/bars ONLY at legal ids for the active mode, in seat color. `BuildBar` shows road/settlement/city with cost affordability (disabled + dimmed), Esc cancels placement modes.

- [ ] **Step 1:** Failing store tests: build-bar click → mode; legal click → correct intent (setup vs main variants); illegal-target click → no intent; Esc resets; robber → steal with victims / direct send without.
- [ ] **Step 2:** Implement store handlers (pure functions on the store; components stay thin).
- [ ] **Step 3:** Implement the three components; verify on `/board` with a mock interactive mode (dev route exposes a mode switcher).
- [ ] **Step 4:** Tests + tsc PASS; commit (`feat(client): pick layer, legality glow, build bar`).

---

### Task 10: Discard modal + steal chooser

**Files:**
- Create: `apps/client/src/ui/DiscardModal.tsx`, `apps/client/src/ui/StealChooser.tsx`
- Test: `apps/client/test/discard.test.ts` (store selection logic)

**Interfaces:**
- Consumes: forced `discard` mode (owed count from view), `steal` mode victims; `sendCatanIntent`.
- Produces: modal listing own hand as per-resource steppers; submit enabled only when selected total === owed; sends `discard`. StealChooser lists victim seats (name = "Player N" + card count) → sends `moveRobber` with the chosen `stealFrom` (hex was stored in the mode by Task 9).

- [ ] **Step 1:** Failing tests for the selection reducer (can't exceed hand counts, exact-N gate).
- [ ] **Step 2:** Implement; render both from `Hud` overlay layer with data-testids (`discard-plus-wood`, `discard-submit`, `steal-victim-2`, …).
- [ ] **Step 3:** Tests + tsc; commit (`feat(client): discard modal and steal chooser`).

---

### Task 11: Catan HUD + win overlay + App wiring

**Files:**
- Create: `apps/client/src/ui/CatanHud.tsx`
- Modify: `apps/client/src/App.tsx` (route catan flow: lobby → waiting → CatanScene + CatanHud; hex-tactics no longer reachable from UI), `apps/client/src/main.tsx` (keep `/slice`, `/board` dev routes)
- Test: existing suite green; smoke test in Task 12's E2E

**Interfaces:**
- Consumes: store view/seat/toast/winner; `sendCatanIntent`; lobby `connected` flags.
- Produces: turn banner ("Your turn — roll" / "Player N's turn · autopilot" badge), dice display (`view.turn.dice`), roll button (preRoll + own turn, `data-testid="roll-button"`), end-turn (`data-testid="end-turn"`), own hand strip (5 resource counts), opponent strip (cards/dev/knights/VP via `victoryPoints`-style public calc: settlements+cities+awards from view — public VP only), toast area, win overlay (`data-testid="win-overlay"`, winner + `winnerVpCards`, "back to lobby"). Old `Hud`/`MatchScene` imports removed from App (files stay).

- [ ] **Step 1:** Implement CatanHud (extend hud.css, no library).
- [ ] **Step 2:** Rewire App.tsx: `useCatanStore` status drives lobby/waiting/scene; `reconnectCatan()` on mount.
- [ ] **Step 3:** `pnpm --filter client test` + tsc green (old unit tests for hex flow still pass — they test modules, not App routing; fix any App-coupled test).
- [ ] **Step 4:** Commit (`feat(client): catan HUD, win overlay, app routing to catan flow`).

---

### Task 12: E2E — 3-browser match + perf snapshot

**Files:**
- Create: `apps/client/e2e/catan.spec.ts`
- Modify: `docs/PERF.md` (phase-4 snapshot section)

**Interfaces:**
- Consumes: everything; server `catan` room with `seed`/`rngScript` create options (pass via lobby? NO — E2E creates the room through the UI; determinism comes from a dev-only query param `?seed=` that `createCatanMatch` forwards in create options. Add that param in this task: `main.tsx` reads `seed`/`rngScript` is overkill — `seed` only).
- Produces: the phase gate evidence.

- [ ] **Step 1:** Add dev-only `?seed=` forwarding to `createCatanMatch` (ignored in prod builds? keep simple: always forwarded if present).
- [ ] **Step 2:** Write the spec: THREE `browser.newContext()` pages (sessionStorage isolation); P1 creates (3 players, seed pinned), P2/P3 join by code scraped from the waiting room; drive the setup draft clicking highlighted vertices/edges (pick the first highlighted mesh via a dev hook exposing legal ids + screen positions — add `window.__meridianDebug.catan()` returning `{ mode, legal: [...ids] }` and click via world→screen projection helper also exposed on the hook); then loop: roll → (discard/robber if forced) → build when affordable → end turn, until `win-overlay` appears or 400 UI turns; assert the overlay names a winner. Use the seed found by a quick headless search (3p seed 3 wins in 586 intents with the greedy bot — UI bot follows the same greedy priorities, but dice/steal rng differs by intent order; pin whatever seed the E2E converges on and note it).
- [ ] **Step 3:** Perf: on `/board?tier=high` and `?tier=low`, sample rAF fps over 3s + read draw calls from the dev hook; write both into `docs/PERF.md` with the instancing decision from Task 8.
- [ ] **Step 4:** Full monorepo `pnpm test` + E2E green; kill stale servers first. Commit (`test(client): 3-browser catan E2E to win overlay; perf snapshot`).

---

### Task 13: Docs + finish

- [ ] **Step 1:** Update `docs/PLAN.md`: mark the plan-2 client tasks as superseded by the Catan phases; add a phase-4 completion note. Update `README.md` run instructions (create/join a Catan match).
- [ ] **Step 2:** Remove the stray `assets/slice.blend1` Blender backup from the repo (`git rm`), add `*.blend1` to `.gitignore`.
- [ ] **Step 3:** Full suite + lint green; commit (`docs: phase-4 completion notes; ignore blender backups`).

## Self-review notes (applied)

- Spec §2 assets → Tasks 1–4 (tint contract, terrains, pieces, tokens); §3 scene/perf → Tasks 5, 8; §4 interactions → Tasks 9, 10; §5 HUD → Task 11; §6 lobby + token-key fix → Tasks 6, 7; §7 tests/gate → per-task tests + Task 12; water MAX_TILES → Task 8 Step 1.
- Type consistency: `Mode` union defined in Task 6, consumed 9–11; `TOKEN_SPOT` defined Task 8, populated for new terrains in Task 2's clear-spot survey; `_tint` contract defined Task 1, consumed 3 and 8.
- Deliberate scale note: asset tasks are recipe+checklist (iterative visual work, like the approved slice), client tasks carry code for the load-bearing math/state; JSX components are specified by behavior + testids.
