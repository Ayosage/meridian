# Meridian — Catan Server (Phase 3) Design

**Date:** 2026-08-19
**Status:** Approved (user, 2026-08-19 — design batches approved in session; this document is the written record)
**Parent:** `docs/superpowers/specs/2026-08-19-catan-pivot-design.md` §4 (server), §7 phase 3
**Depends on:** the merged Catan engine (`packages/rules/src/catan/`, 123 tests)
**Does not depend on:** the beauty slice (PR #2) or any client work

## 1. Scope decisions (user, 2026-08-19)

- **CatanRoom lives ALONGSIDE MatchRoom.** The 2-player hex-tactics room,
  its schema, and the current playable client demo stay untouched.
  Deleting the placeholder is a later cleanup (phase 4+).
- **Done bar = integration-tested, no UI.** Phase 3 is complete when
  ws-level integration tests drive full 3- and 4-player matches through the
  real room (setup draft → production → 7/discard/robber → trades → dev
  cards → win) and prove no secret ever reaches the wrong seat. The board
  client is phase 4.
- **Redaction approach A: per-seat redacted snapshots.** No game state in
  Colyseus schema; no StateView/filters; no hybrid.

## 2. Redacted view: `CatanClientState`

New module `packages/rules/src/catan/redact.ts`:

```ts
redactCatanState(state: CatanState, seat: PlayerId): CatanClientState
```

This function is the ONLY doorway game state passes through to a client.
The server never sends `CatanState` itself (the reconnect path included).

Shape of `CatanClientState`:

- **Public pass-through:** `seq`, `playerCount`, `board`, `buildings`,
  `roads`, `bank`, `awards`, `winner`, and `turn` — including
  dice, phase, the open trade offer and its responses, and pending
  discards as **counts owed** (`Record<seat, number>`, already
  composition-free in the engine).
- **Per-player public summaries** — `players[i]` for EVERY seat `i`:
  `resourceCount` (total only; totals are countable in physical Catan),
  `devCardCount`, `knightsPlayed`, `roadsLeft`, `settlementsLeft`,
  `citiesLeft`. Opponents' hand composition never appears in any form.
- **`you` block** (receiving seat only): `seat`, full `resources`, full
  `devCards` (with `boughtOnTurn`).
- **Deck:** `devDeckCount` only. Order and composition are stripped.
- **Win reveal:** when `winner !== null`, the view additionally carries
  `winnerVpCards: number` (the revealed VP-card count that closed the
  win); hands otherwise stay redacted even at game end.

Steal/monopoly/discard privacy needs no special events: each seat sees its
own snapshot change (the robber's thief learns the stolen card because
their own hand grew; everyone else sees totals move).

## 3. Seat pilot: a caretaker bot drives absent seats (user decision, 2026-08-19)

**Supersedes the passive-forfeit engine extension considered first.** The
leave policy: the moment a seat has no connected human, a server-side BOT
pilots it so the game never stalls; the human reclaims the seat by
reconnecting, any time until the game ends. The engine needs NO changes —
every seat always has a driver, so rotation, discards, robber flows, and
production all work exactly as already implemented and tested.

New server module `apps/server/src/pilot.ts`:

```ts
pilotIntent(state: CatanState, seat: PlayerId, rng: Rng): CatanIntent | null
```

- **Caretaker policy — mandatory actions only.** The bot: rolls the dice;
  discards on 7 with DETERMINISTIC GREEDY selection (shed from the largest
  resource piles first, ties broken in fixed resource order); moves the
  robber to a legal hex (preferring hexes touching no building, else any
  legal hex) and steals from an rng-chosen adjacent player when the rules
  force a target; completes the setup draft (rng-chosen legal vertex +
  adjacent edge) if a player is absent during setup; answers any open
  trade offer with REJECT immediately; ends its turn. It NEVER builds,
  buys or plays dev cards, or offers trades — a piloted seat cannot win
  the game for its owner or reshape the board.
- **Returns `null`** when the seat has nothing mandatory to do (not its
  turn, no discard owed, no trade to answer) — the room invokes the pilot
  only when the game is waiting on that seat.
- **Pacing:** the room schedules pilot actions with a configurable delay
  (`pilotDelayMs`, default ~600ms; 0 in tests) so remaining humans see the
  flow rather than an instant cascade.
- **Liveness property (the failure mode that matters):** for any reachable
  state where the game is waiting on the piloted seat, `pilotIntent`
  returns an intent the engine accepts. Property-tested (§6).

## 4. `CatanRoom` (apps/server/src/rooms/CatanRoom.ts)

- **Create options:** `{ players: 3 | 4; layout?: 'beginner' | 'random';
  pilotDelayMs?: number; abandonMinutes?: number; seed?: number }` (seed
  injectable for tests; cryptographically-random default). Random layout
  is the default per the pivot spec. Join codes via the existing
  `generateRoomId` presence machinery.
- **Lobby schema** (Colyseus schema, lobby plumbing ONLY): seat list,
  room phase (`waiting | playing | ended`), target player count, and a
  per-seat `connected` flag (so clients can render "away — autopilot" in
  phase 4). Presence is transport metadata, not game state; game state
  never enters schema.
- **Seats & host:** join order = seat number; seat 0 is host. Room starts
  automatically when full. In a 4-room with exactly 3 seated, the host may
  send `MSG.START` to begin (3-player game; the 4th seat closes).
- **Intent loop:** validate with `catanIntentSchema` → attach seat →
  `applyCatanIntent(state, intent, rng)` → on success, send each CONNECTED
  seat its own `MSG.SNAPSHOT` carrying `redactCatanState(state, seat)`;
  on `CatanRuleError`, reply `MSG.RULE_ERROR` to the sender only.
- **Disconnect → pilot takes over immediately.** Any leave mid-game
  (dropped connection OR consented leave) puts the seat under the §3
  pilot with no stall — the pilot acts whenever the game is waiting on
  that seat. Pre-start leaves free the seat (existing waiting-phase
  pattern).
- **Reconnect → seat handed back.** `allowReconnection(client, 'manual')`
  holds every departed seat reclaimable until the game ends or the room
  is abandoned (no grace deadline — the pilot removes the need for one).
  On reclaim the pilot stands down between intents (the room serializes
  intent application, so there is no mid-action race) and the rejoiner
  receives their current redacted snapshot via the proven
  `afterNextPatch` pattern. Same sessionId = same seat.
- **Abandonment guard:** if ZERO humans are connected, the pilots pause
  (no bot-vs-bot games playing themselves out); after `abandonMinutes`
  (default 10) with no human, the room disposes and its join code is
  released.
- **Win:** after any applied intent with `winner !== null`, broadcast
  `MSG.MATCH_ENDED { reason: 'win', winner }` after the final snapshots.
  A piloted seat can hold buildings/awards but cannot reach 10 VP while
  piloted (the pilot never builds or buys), so a bot cannot end the game.

## 5. Protocol (`@meridian/protocol`)

- `catanIntentSchema`: strict zod discriminated union mirroring the 17
  engine intents MINUS the `player` field (server derives seat). Vertex/
  edge ids validated as bounded non-empty strings; hex coords as strict
  `{q, r}` ints; resource maps as strict partial records of the five
  resources with positive-int values. The ENGINE remains the authority on
  legality — protocol only rejects malformed shapes. The pilot is
  server-internal and has no protocol surface.
- `MSG.START` added (lobby, host-only, no payload).
- `catanSnapshotPayloadSchema`: `{ seq: number, view: CatanClientState }`
  — typed so the phase-4 client consumes it directly.
- Existing message names reused: `INTENT`, `RULE_ERROR`, `SNAPSHOT`,
  `MATCH_ENDED`. Hex-tactics `clientIntentSchema` untouched.

## 6. Testing

**packages/rules:**
- `redact.test.ts`: own hand present in full; every opponent entry has
  ONLY the public-summary keys (structural key-set assertion, not string
  grep); deck reduced to a count; pending discards are counts; win-reveal
  behavior.
- No-leak property test: replay the existing seeded 4-player bot game
  (`full-game.test.ts` harness); at EVERY step, for EVERY seat, assert the
  view's structural invariants and that `JSON.stringify(view)` contains no
  `devDeck` array and no other seat's `devCards`.
**apps/server unit (pilot.ts, engine-only — no ws):**
- Policy tests: greedy discard selection order; robber preference (empty
  hex first) and forced steal; setup-draft placement legality; trade
  auto-reject; `null` when nothing is mandatory; never emits build/buy/
  play/offer intents.
- Liveness property test: seeded random-walk games where one or more
  seats are pilot-driven at every decision point — assert the pilot's
  intent is always accepted by `applyCatanIntent` and every game reaches
  a terminal state or a human-decision point (no stalls).

**apps/server integration (@colyseus/testing, serialized like the
existing suite):**
- Scripted full 3-player and 4-player matches over real ws to a 10-VP win,
  exercising setup draft, production, 7-discard-robber-steal, player and
  bank/port trades, every dev card, and awards.
- Host-start-at-3 in a 4-room; non-host `START` rejected; auto-start when
  full.
- Pilot takeover: a client drops mid-turn (and once mid-setup, once while
  owing a discard, once holding an open robber decision) → the pilot
  completes the mandatory flow and the game continues.
- Seat reclaim: the human reconnects several turns later → pilot stands
  down, rejoiner's snapshot is correct and redacted for their seat, and
  their subsequent intents apply.
- Abandonment: all humans disconnect → pilots pause; after
  `abandonMinutes` the room disposes and the join code is released.
- Cross-seat leak assertion: every snapshot every client receives during
  the scripted matches passes the same structural no-leak checks keyed to
  that client's seat.

## 7. Out of scope (phase 3)

- Any client/UI work (phase 4-5), including the store consuming
  `CatanClientState`.
- Retiring MatchRoom/hex-tactics.
- Spectators, 5-6 players, ranked/matchmaking (out of v1 entirely).
- Event-stream messages for juice (phase 5 may add them; snapshots are
  sufficient for correctness).
- A COMPETENT bot (building, trading, strategy). The pilot is a caretaker
  by design; promoting it to a real AI opponent is a separate future
  project with its own design questions.

## 8. Risks

- **Leak-by-addition:** future `CatanState` fields default to leaking if
  `redactCatanState` passes objects through wholesale. Mitigation: the
  redactor constructs the view EXPLICITLY field-by-field (never spreads
  `state` or `players[i]`), so a new secret field fails closed; the
  structural key-set tests then catch any accidental widening.
- **Pilot stalls are the failure mode that matters:** a piloted seat that
  can't produce a legal intent wedges the whole match. The §6 liveness
  property test attacks this directly; the pilot's policy is also kept
  deliberately minimal so its decision surface stays enumerable.
- **Takeover/reclaim races:** the room serializes intent application and
  hands seats over only between intents; the reclaim integration tests
  cover drop/rejoin at awkward moments (mid-setup, owing a discard,
  holding the robber).
- **rng stream alignment:** dice, deck shuffle, and steals share the
  injected rng; the pilot's rng-based choices (steal target, setup vertex)
  draw from the same server stream, and server tests use a fixed seed so
  full-match scripts are reproducible (same discipline as the engine's
  full-game tests). The greedy discard is deliberately rng-free.
