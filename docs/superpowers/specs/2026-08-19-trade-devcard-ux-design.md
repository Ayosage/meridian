# Meridian — Trade & Dev-Card UX (Phase 5) Design

Phase 5 delivers the trading and development-card interfaces on top of the
phase-4 board client. The engine (`packages/rules`), protocol
(`packages/protocol`), and server already support every action in this spec —
`catanIntentSchema` carries all trade/dev intents, and the redacted
`CatanClientState` already exposes `turn.openTrade`, `you.devCards`, and
`turn.devPlayed`. This phase is client UI plus one deliberate server change
(pilot trade evaluation, §6). Zero engine or protocol changes.

Visual reference: the approved design canvas ("Meridian Trade and Dev Cards",
2026-08-19) — all panels follow the existing `hud.css` vocabulary
(rgba(12,14,20) panels, `#2c6e8f` primary, `#7fc8e8` borders, `#4a8f5c`
green, `#e8e8f0` text).

## 1. Scope decisions (user, 2026-08-19)

- **Docked composer (Option A)**: the trade composer docks bottom-right above
  END TURN so the board stays visible; modals are reserved for dev-card
  target pickers (Year of Plenty, Monopoly), which follow the DiscardModal
  pattern.
- **Pilot evaluates trades**: the caretaker pilot stops auto-rejecting and
  accepts clearly favorable offers (§6), so solo playtests vs bots exercise
  the full trade loop. Bots still never offer or counter — a piloted seat
  remains non-competitive.
- Static design locked on the canvas; no new visual exploration during
  implementation.

## 2. Trade UI

### Composer (docked panel, own turn, main phase)

- A **Trade** button joins BuildBar; it toggles the docked composer
  (mirroring `toggleBuildMode`'s toggle discipline). Disabled off-turn and
  outside the main phase.
- Two tabs:
  - **Players**: two stepper rows (give / get) over the five resources.
    Give-steppers cap at the hand count; both sides must be non-empty to
    enable **Offer to players** → `{type: 'offerTrade', give, get}`.
  - **Bank**: pick one give resource and one get resource. Each give chip
    shows the live rate from `bankTradeRate(view, seat, resource)`
    (4:1 base, 3:1 generic port, 2:1 matching port) and disables when the
    hand can't cover it; the CTA reads the exact exchange ("Trade 4 wood →
    1 ore") → `{type: 'bankTrade', give, get}`. Get chips disable when
    `view.bank[r] < 1`.
- Rule errors surface through the existing toast path; the composer keeps
  its staged state so the player can adjust.

### Open-offer review (offerer's view)

While `view.turn.openTrade` is set and `turn.current === seat`, the docked
panel becomes the response review: the posted offer as chips, then one row
per opponent showing live status from `openTrade.responses` — *waiting*,
*Accepted* (+ Confirm), *Counter: you give X, get Y* (+ Confirm), or
*Declined*. Confirm sends `{type: 'confirmTrade', partner}` (engine settles
accepted terms or countered terms as appropriate); **Cancel** sends
`{type: 'cancelTrade'}`. Composing a new offer is impossible while one is
open (engine rule) — the review panel is the only trade surface then.

### Incoming offer (responder's view)

While `openTrade` is set, `turn.current !== seat`, and
`openTrade.responses[seat]` is undefined, a banner panel appears top-center
(below the dice): "Player N offers a trade", the terms from the responder's
perspective (*you receive* offer.give / *you give* offer.get), and three
actions:

- **Accept** → `{type: 'respondTrade', response: 'accept'}`
- **Decline** → `{type: 'respondTrade', response: 'reject'}`
- **Counter** → expands the same stepper rows inline, prefilled with the
  posted terms from the responder's perspective; submit sends
  `{type: 'respondTrade', response: {give, get}}` (give = what the responder
  hands over). After responding the banner collapses to a one-line
  "waiting for Player N" status until the offer resolves.

The banner never blocks forced modes: discard/robber/steal keep priority
(they're modal or board-mode surfaces; the banner hides while one is
active for this seat).

## 3. Dev-card UI

- **Buy**: a **Dev Card** button joins BuildBar → `{type: 'buyDevCard'}`.
  Disabled unless main phase + own turn + `affordable(...).devCard` +
  `view.devDeckCount > 0`.
- **Dev strip**: a panel above the hand strip (own cards only, from
  `view.you.devCards`), grouped by card with counts. Header shows
  "Dev cards · N in deck".
  - A card with `boughtOnTurn === view.turn.number` (own turn) shows a NEW
    badge and a disabled Play.
  - Once `view.turn.devPlayed` is true, every Play disables for the turn.
  - Victory Point cards have no Play — caption "revealed at win".
  - Play enabled only in the main phase on your own turn.
- **Play flows**:
  - **Knight** → send `{type: 'playDevCard', card: 'knight'}` directly. The
    next snapshot flips `turn.phase` to `'robber'` and the existing
    `deriveMode` robber/steal machinery takes over untouched.
  - **Road Building** → a new voluntary board mode `roadBuilding` staging
    edge picks: target count = `min(2, you roadsLeft)` (engine allows 1 edge
    when only 1 road remains). Legal edges for the second pick are computed
    with the first staged edge overlaid as owned (local view overlay), so
    chains off the new road highlight correctly. When the target count is
    staged, send `{type: 'playDevCard', card: 'roadBuilding', edges}`.
    Esc cancels like other voluntary modes.
  - **Year of Plenty** → modal, two-resource stepper capped at total 2
    (get chips disable when the bank is short) →
    `{type: 'playDevCard', card: 'yearOfPlenty', take: [r1, r2]}`.
  - **Monopoly** → modal, five resource buttons, click sends
    `{type: 'playDevCard', card: 'monopoly', resource}`.

## 4. Client architecture

New pure-logic modules (no React, no zustand — unit-testable like
`deriveMode`/`discardIntent`):

- `apps/client/src/scene/catan/tradeLogic.ts` — stepper staging reducers
  (increment/decrement with hand caps), offer/bank/respond/counter intent
  builders, `incomingOfferFor(view, seat)` / `offerReviewFor(view, seat)`
  derivations, bank-rate/affordability helpers over `bankTradeRate`.
- `apps/client/src/scene/catan/devCardLogic.ts` — grouped-hand derivation
  (counts, NEW, playability per card given `devPlayed`/phase/turn),
  road-building staging (legal-edge overlay, completion check), Year of
  Plenty selection reducer, intent builders.

Store (`catanStore.ts`) additions, following the existing injected
`SendIntent` pattern:

- Composer UI state: open/closed, active tab, staged give/get, bank picks.
- New `Mode` kind: `{ kind: 'roadBuilding'; staged: EdgeId[] }` — voluntary,
  cancellable via the existing `cancelMode`, cleared stale by `deriveMode`
  if the phase leaves main.
- Year of Plenty / Monopoly modal state + selection.
- Counter-drafting state for the incoming-offer banner.
- Snapshot ingestion resets trade staging when `openTrade` transitions
  (posted → resolved), mirroring the `enteringDiscard` discipline.

New components (`apps/client/src/ui/`): `TradePanel.tsx` (composer + review,
docked), `IncomingOffer.tsx`, `DevCardStrip.tsx`, `YearOfPlentyModal.tsx`,
`MonopolyModal.tsx`; `BuildBar.tsx` gains the Dev Card and Trade buttons;
`PickLayer` routes edge clicks to road-building staging when that mode is
active. Styles extend `hud.css` with the canvas vocabulary.

## 5. HUD placement (from the canvas)

- Composer/review panel: `bottom: 74px; right: 18px` (above END TURN),
  width ~320–360px.
- Incoming-offer banner: top-center below the dice display.
- Dev strip: `bottom: 138px; left: 18px` (above the hand strip).
- Fix the pre-existing Roll/END TURN squeeze: `.roll-button` moves from
  `right: 120px` to `right: 132px`.

## 6. Server: pilot trade evaluation

`apps/server/src/pilot.ts` — replace the unconditional
`respondTrade: 'reject'` with a deterministic evaluation. The pilot gives
`offer.get` and receives `offer.give`, so it accepts iff:

- it holds every resource on the `get` side
  (`hasResources(pilot.resources, offer.get)`), and
- `totalResources(offer.give) >= totalResources(offer.get)` — it receives
  at least as many cards as it hands over.

Otherwise reject. The pilot still never offers, counters, or initiates
trades; a piloted seat remains a caretaker, not a competitor (server design
spec §3's spirit holds — this only prevents the trade UI from being dead
against bots). The doc comment in `pilot.ts` updates to match.

## 7. Testing + phase gate

- Unit (client): `tradeLogic` and `devCardLogic` pure functions —
  staging caps, intent shapes, offer derivations per seat, road-building
  overlay legality, NEW/devPlayed gating. Store tests with a send spy for
  every new action (existing `catanStore.test.ts` pattern).
- Unit (server): pilot evaluation matrix — favorable accept, unaffordable
  reject, unfavorable reject; full-match liveness stays green (a piloted
  game with an open trade still terminates).
- E2E (`catan.spec.ts`): extend the 3-browser match with (a) one completed
  player trade — offer from browser A, accept in browser B, confirm in A,
  assert both hand strips changed; (b) a bank trade; (c) buy a dev card,
  end turn, come back and play it, assert the effect. Kill stale dev
  servers first (worktree footgun).
- Gate: full suite + lint green; playtest vs 3 pilots exercising a trade
  accepted by a bot.

## 8. Risks

- **Road-building second-edge legality** must match the engine's validation
  exactly or players stage an edge the server rejects; mitigated by the
  overlay reusing `legalRoadEdges` on a patched view rather than
  reimplementing rules, plus the engine remains the authority (toast on
  reject, mode survives to re-pick).
- **Trade UI state races**: snapshots can resolve/cancel an offer while a
  responder is mid-counter; ingestion clears stale trade UI the way
  `deriveMode` clears stale forced modes (derive-from-snapshot, never
  trust local flags).
- **Pilot acceptance changes bot-game balance** in tests that assume trades
  never complete; audit existing server tests for that assumption.
