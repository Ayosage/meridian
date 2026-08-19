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
  `roads`, `bank`, `awards`, `winner`, `forfeited`, and `turn` — including
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

## 3. Engine extension: `forfeit`

The pivot spec's leave policy ("assets stay, turns skip them") cannot be
implemented by the server synthesizing intents — a departed player's turn
can require roll → 7 → discard → robber → steal. Instead, one engine
extension, exhaustively unit-testable:

- `CatanState` gains `forfeited: readonly PlayerId[]` (empty at create).
- New intent `{ type: 'forfeit'; player: PlayerId }`, applied ONLY by the
  server (never exposed in the client protocol). Legal in any phase, for
  any player still active, including during setup.
- Reducer semantics:
  - **Turn rotation** (endTurn and the setup snake draft) skips forfeited
    players. If the CURRENT player forfeits, their turn ends immediately
    (any half-finished sub-flow they owned — robber placement, open trade
    — is cancelled) and play advances to the next active player.
  - **Production:** forfeited players' buildings are INERT — they collect
    nothing. (Deviation from the in-session presentation, recorded here:
    letting departed players collect would consume bank stock and could
    trigger the bank-shortage rule against active players.)
  - **Discard-on-7:** forfeited players are excluded; any outstanding
    discard owed by the forfeiting player is dropped, and the discard
    phase resolves if they were the last holdout.
  - **Trades:** forfeited players are auto-reject; an open offer FROM a
    player who then forfeits is cancelled.
  - **Awards/VP:** kept as held (assets stay); a forfeited player cannot
    win, but their longest-road/largest-army holdings persist per the
    ties-keep-holder rule.
  - **Game end:** if fewer than 2 active players remain, the game ends;
    with exactly one active player remaining, that player wins
    (`winner = last active`).

## 4. `CatanRoom` (apps/server/src/rooms/CatanRoom.ts)

- **Create options:** `{ players: 3 | 4; layout?: 'beginner' | 'random';
  graceSeconds?: number; seed?: number }` (seed injectable for tests;
  cryptographically-random default). Random layout is the default per the
  pivot spec. Join codes via the existing `generateRoomId` presence
  machinery.
- **Lobby schema** (Colyseus schema, lobby plumbing ONLY): seat list,
  room phase (`waiting | playing | ended`), target player count. Game
  state never enters schema.
- **Seats & host:** join order = seat number; seat 0 is host. Room starts
  automatically when full. In a 4-room with exactly 3 seated, the host may
  send `MSG.START` to begin (3-player game; the 4th seat closes).
- **Intent loop:** validate with `catanIntentSchema` → attach seat →
  `applyCatanIntent(state, intent, rng)` → on success, send each CONNECTED
  seat its own `MSG.SNAPSHOT` carrying `redactCatanState(state, seat)`;
  on `CatanRuleError`, reply `MSG.RULE_ERROR` to the sender only.
- **Reconnection:** `allowReconnection(client, graceSeconds)` (the proven
  MatchRoom pattern, including `afterNextPatch` ordering); the rejoiner
  receives their current redacted snapshot. Same sessionId = same seat.
- **Leaving:** consented leave mid-game, or grace expiry → server applies
  `{ type: 'forfeit', player: seat }` and broadcasts per-seat snapshots
  (plus `MSG.MATCH_ENDED` if the forfeit ended the game). Pre-start leaves
  free the seat (existing waiting-phase pattern).
- **Win:** after any applied intent with `winner !== null`, broadcast
  `MSG.MATCH_ENDED { reason: 'win', winner }` after the final snapshots.

## 5. Protocol (`@meridian/protocol`)

- `catanIntentSchema`: strict zod discriminated union mirroring the 17
  engine intents MINUS the `player` field (server derives seat). `forfeit`
  is deliberately absent. Vertex/edge ids validated as bounded non-empty
  strings; hex coords as strict `{q, r}` ints; resource maps as strict
  partial records of the five resources with positive-int values. The
  ENGINE remains the authority on legality — protocol only rejects
  malformed shapes.
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
- `forfeit.test.ts` matrix: rotation skip (mid-turn and between turns),
  setup-draft skip, current-player forfeit cancels robber/trade sub-flows,
  discard exclusion incl. last-holdout resolution, trade auto-reject,
  production inertness (incl. a bank-shortage case that would differ if
  the forfeited player still collected), cannot-win, last-active-wins,
  award retention.

**apps/server (@colyseus/testing, serialized like the existing suite):**
- Scripted full 3-player and 4-player matches over real ws to a 10-VP win,
  exercising setup draft, production, 7-discard-robber-steal, player and
  bank/port trades, every dev card, and awards.
- Host-start-at-3 in a 4-room; non-host `START` rejected; auto-start when
  full.
- Mid-match reconnect: rejoiner's snapshot is correct and redacted for
  their seat.
- Grace-expiry forfeit: turns skip the departed seat; assets remain on the
  board; game continues to a win.
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

## 8. Risks

- **Leak-by-addition:** future `CatanState` fields default to leaking if
  `redactCatanState` passes objects through wholesale. Mitigation: the
  redactor constructs the view EXPLICITLY field-by-field (never spreads
  `state` or `players[i]`), so a new secret field fails closed; the
  structural key-set tests then catch any accidental widening.
- **Forfeit edge cases** (forfeit during own robber placement, during
  setup, as last holdout of a discard) are the likeliest bug nest — the
  §6 matrix enumerates them ahead of implementation.
- **rng stream alignment:** dice, deck shuffle, and steals share the
  injected rng; server tests use a fixed seed so full-match scripts are
  reproducible (same discipline as the engine's full-game tests).
