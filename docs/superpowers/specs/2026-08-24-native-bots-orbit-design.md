# Native companion bots, bot trade proposals, camera orbit — design

Date: 2026-08-24. Closes the remaining BACKLOG.md items: "bots never
propose player trades", "fixed camera + corner HUD panels can cover
board vertices", and retires the external-script requirement for solo
play by making bots a first-class room option.

## Goals

1. Solo (or partial) matches vs competent bots with no external
   tooling: pick a bot count in the lobby, play.
2. Bots propose player trades, so the human responder flow
   (banner → accept/counter/decline) sees real traffic every match.
3. A human can always reach a board vertex hidden behind a HUD panel
   by orbiting the camera.
4. A deliberate playtest sweep over the finished build, findings
   logged in BACKLOG.md.

Non-goals: bot difficulty levels, bot chat/personality, bots in the
player strip looking different from piloted seats beyond the waiting
room, changes to `tools/bots.mjs` (it stays as a UI-exercise/E2E
tool; its "propose trades" backlog item closes as moot).

## 1. Companion brain — `packages/rules/src/catan/companion.ts`

`companionIntent(state: CatanState, seat: PlayerId, rng: Rng, opts:
CompanionOpts): CatanIntent | null` — a pure function beside `bot.ts`
and mirroring `pilotIntent`'s contract: reads only seat-visible
information (own hand, public board/players/bank), returns one intent
or null when the seat has nothing to do (e.g. waiting on responses to
its own trade offer).

```ts
interface CompanionOpts {
  /** Room-tracked: this seat already opened an offer this turn. */
  proposedThisTurn: boolean
  /** Room-tracked: response window expired — confirm best or cancel. */
  resolveOfferNow: boolean
  /** Room-tracked: bank trades already made this turn (brain stops at 2). */
  bankTradesThisTurn: number
}
```

Heuristics ported from `apps/client/tools/bots.mjs` (the competent
pass), now in TS against `CatanState` + `@meridian/rules` queries:

- **Setup + settlement/city placement**: pip-weighted vertices
  (`6 − |7 − token|` summed over the vertex's hexes); setup road =
  first free edge off the new settlement.
- **Build goal**: city (if upgradable) > settlement > dev card > road;
  deficits for the goal drive monopoly picks, year-of-plenty picks,
  bank trades, and trade proposals.
- **Main-phase priority**: build city > build settlement > buy dev >
  play dev (knight, roadBuilding, yearOfPlenty, monopoly; respects
  `devPlayed` and `boughtOnTurn`) > build road > propose player trade
  > bank-trade surplus (max 2/turn, derived from opts — see room) >
  end turn.
- **Robber**: hex score = Σ over adjacent enemy buildings of
  `(city?2:1) × (1 + owner public VP)`, × `(1 + pips)`; never a hex
  we build on; steal from the adjacent victim with most public VP.
- **Discard**: shed largest piles first (reuse/move `greedyDiscard`
  from `pilot.ts` into the rules package so both brains share it).
- **Respond to trades**: pilot floor — accept iff the seat can cover
  what it gives and never loses net cards; else reject. (No counters
  from bots; YAGNI.)

New behavior:

- **Propose a player trade** (`{ type: 'offerTrade', … }`): only when
  main phase, own turn, no open trade, nothing higher-priority fired,
  `!opts.proposedThisTurn`, the build goal is missing 1–2 resource
  kinds, and some other resource has surplus beyond the goal's own
  cost. Offer exactly `give 1 surplus → get 1` biggest-deficit
  resource (a 1:1 ask, tried before the ≥4:1 bank fallback).
- **Manage own open offer**: among responses, confirmable = plain
  accepts, plus counters that pass the same floor rule (cover the
  counter's give, net cards ≥ 0). If any confirmable → confirm the
  responder with the fewest public VP (don't feed the leader). Else
  if `opts.resolveOfferNow` → cancel. Else → null (keep waiting; the
  room owns the clock).

Unit tests (vitest, `packages/rules/test/companion.test.ts`, TDD):
placement picks the pip-max vertex; goal/deficit selection; proposal
fires only under the stated conditions and shapes give/get correctly;
offer management (confirm best, prefer low-VP, cancel on
`resolveOfferNow`, wait otherwise); robber scoring never self-blocks;
full-game liveness: seeded 4-bot match driven by `companionIntent`
reaches a winner within an intent cap (mirrors the existing pilot
liveness harness).

## 2. Room — `apps/server/src/rooms/CatanRoom.ts`

`CreateOptions.bots?: number` (default 0, validated `0 ≤ bots ≤
players − 1`; non-integers rejected like `players` is).

Seating: `seats` stays human-only while waiting, so the creator is
always seat 0 (host) and the join/early-start rules are untouched.
The room starts when `seats.length === targetPlayers − bots`; at
`startGame()` bot seats are appended (synthetic ids `bot-1…`,
`connected = true`, `seatClients[seat] = null`) so bots hold the
trailing seats. A new `seatKinds: ('human' | 'bot')[]` distinguishes
a bot seat from a disconnected human forever after.

Early start (`MSG.START`): unchanged rule, but the 3-of-4 condition
counts only human seats and is only reachable in a 0-bot room (any
bot count already lowers the human threshold); no code path conflict.

Driving: `schedulePilot`/`nextPilotSeat` generalize to "driven
seats" — a seat with no client uses `companionIntent` when
`seatKinds[seat] === 'bot'`, `pilotIntent` otherwise. Same single
timer, same `applyAndBroadcast` choke point. Bot pacing: a separate
`botDelayMs` (default 900) so bot turns are watchable; pilot delay
unchanged. The all-humans-disconnected pause stays (bots idle while
the room is abandoned).

Per-seat bot memory lives in the room (not the brain):
`{ proposedOnTurn: number, bankTradesThisTurn: number }` keyed by
seat, reset when `game.turn.number` moves; mapped into
`CompanionOpts`. Bank-trade cap: the room counts applied bank-trade
intents per bot per turn and stops offering the option via opts after 2.

Trade response window: when `applyAndBroadcast` leaves an
`openTrade` owned by a bot seat, the room arms a 10 s clock timer;
every human response re-runs the bot immediately (existing
`schedulePilot` call after each intent already does this); at the
deadline the bot is driven once with `resolveOfferNow: true`
(confirm best or cancel). Timer cleared when the offer closes.

Lobby schema (`CatanLobbyState`): add `@type('number') botCount = 0`.
Game-state bytes still never enter Colyseus schema.

Integration tests (existing server test idiom): create with bots →
starts at the reduced human count with bots in trailing seats;
bots=players−1 starts on creator join; invalid bot counts rejected;
bot offer resolves (confirm on accept / cancel at deadline).

## 3. Protocol + client

- `@meridian/protocol`: `bots` added to the create-options schema.
- `net/catan.ts` `createCatanMatch(players, bots)` forwards it (plus
  a `?bots=` query param alongside `?seed=`/`?vp=` for E2E).
- `Lobby.tsx`: bot-count selector under the player-count choice —
  buttons `0…players−1` (testids `bots-N`), clamped when switching
  4→3. Label: "Bots". Default 0.
- `WaitingRoom.tsx`: shows `botCount` bot seats as reserved rows
  ("Bot" label) after the human seats; "waiting for N players" math
  uses `targetPlayers − botCount`.
- `PlayerStrip` needs no change (bots render as normal seats).

## 4. Camera orbit — occluded vertices

`OrbitControls` is already mounted in `CatanScene` (rotate + zoom,
pan off, polar-clamped) — yet the 2026-08-19 playtest logged vertices
under HUD panels as unclickable for humans. Step 1 is reproduction at
1280×720 in the live match route: verify whether drag-orbit works at
all there, and what blocks it if not (candidate causes: fixed HUD
panels swallowing pointerdown over their area, PickLayer/controls
conflict, or orbit works and the finding was a discoverability gap).
Fix what reproduction shows; the acceptance check is scripted: a
legal vertex whose projected point sits under a HUD panel becomes
clickable after a drag-orbit, and `clearPointIndex`-style probing
confirms the click lands on the canvas. If the cause turns out to be
pure discoverability, the fix is a minimal affordance (e.g. a one-line
"drag to rotate" hint), not new camera code.

## 5. Playtest sweep

Kill stale dev servers first (ports 5173/2567 — the known worktree
footgun), fresh server + client, then a scripted full match through
the new flow: create 4-player/3-bot from the lobby UI, Playwright
drives the human seat. Must-exercise list: bot trade offer arriving
at the human seat (accept once, decline once, counter once), human
proposing to bots, orbit-then-click on an occluded vertex, dev cards
(all four), robber + discard, win overlay. Console errors collected;
findings appended to BACKLOG.md; quick fixes applied in-session,
bigger ones left as new backlog items.

## 6. Delivery

Order: companion brain (TDD) → room/protocol/client → E2E for the
bots flow → orbit reproduction + fix → sweep → BACKLOG.md updates.
Logical commits per stage; push at the end. `rules`, `protocol`,
`server`, `client` each keep their existing test commands green
(turbo pipeline).
