import { create } from 'zustand'
import type { CatanClientIntent, CatanSnapshotPayload } from '@meridian/protocol'
import {
  coordKey,
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  RESOURCES,
  standardTopology,
  type CatanClientState,
  type Coord,
  type EdgeId,
  type Resource,
  type ResourceCount,
  type VertexId,
} from '@meridian/rules'
import {
  devHand,
  legalRoadBuildingEdges,
  monopolyIntent,
  resolveRoadBuildingClick,
  yearOfPlentyIntent,
} from './devCardLogic'
import {
  bankTradeIntent,
  counterTradeIntent,
  decrementSelection,
  emptySelection,
  incomingOfferFor,
  incrementSelection,
  offerTradeIntent,
  selectionTotal,
  shouldAutoDecline,
  type ResourceSelection,
} from './tradeLogic'

const TRADE_MUTE_KEY = 'meridian.tradeMute'

/** Defensive read: private browsing / disabled storage must never throw past this — default OFF. */
function loadTradeMute(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(TRADE_MUTE_KEY) === '1'
  } catch {
    return false
  }
}

/** Defensive write: storage failures (quota, disabled, private mode) must not block the in-memory toggle. */
function saveTradeMute(muted: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(TRADE_MUTE_KEY, muted ? '1' : '0')
  } catch {
    // in-memory state still applies; persistence is best-effort
  }
}

export type CatanStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'playing'
  | 'ended'
  | 'reconnecting'
  | 'error'

export interface CatanMatchResult {
  reason: 'win'
  winner: number
}

/**
 * Local UI mode. setup/discard/robber(/steal) are FORCED by the server's
 * snapshot (see deriveMode); placeSettlement/placeRoad/placeCity may ALSO be
 * picked voluntarily by the player during the main phase (e.g. "build road").
 */
export type Mode =
  | { kind: 'idle' }
  | { kind: 'placeSettlement'; forced?: true }
  | { kind: 'placeRoad'; forced?: true }
  | { kind: 'placeCity' }
  | { kind: 'discard' }
  | { kind: 'robber' }
  | { kind: 'steal'; hex: Coord; victims: number[] }
  | { kind: 'roadBuilding'; staged: EdgeId[] }

const IDLE_MODE: Mode = { kind: 'idle' }
const PLACEMENT_KINDS: ReadonlySet<Mode['kind']> = new Set(['placeSettlement', 'placeRoad', 'placeCity'])
const STALE_IF_UNFORCED: ReadonlySet<Mode['kind']> = new Set(['discard', 'robber', 'steal'])

/**
 * Pure state machine: what mode the current snapshot forces the seat into,
 * given the mode it was already in. Unit-testable without React or a store.
 */
export function deriveMode(view: CatanClientState, seat: number | null, current: Mode): Mode {
  if (seat === null) return current
  const { turn } = view
  if (turn.phase === 'setup' && turn.current === seat && turn.setup) {
    return turn.setup.expect === 'settlement'
      ? { kind: 'placeSettlement', forced: true }
      : { kind: 'placeRoad', forced: true }
  }
  if ((turn.pendingDiscards[seat] ?? 0) > 0) return { kind: 'discard' }
  if (turn.phase === 'robber' && turn.current === seat) {
    return current.kind === 'steal' ? current : { kind: 'robber' }
  }
  // Nothing forced right now. discard/robber/steal only ever arise from a
  // forced condition above, so once it no longer holds they're stale.
  // Placement modes may be a voluntary local pick and survive unrelated
  // snapshots (e.g. an opponent's dice roll shouldn't cancel your build UI) —
  // but a placement mode this state machine itself forced (setup) is just as
  // stale once its condition ends: without the check it would outlive our
  // setup turn as a phantom "voluntary" build mode with no legal targets.
  if (STALE_IF_UNFORCED.has(current.kind)) return IDLE_MODE
  if ((current.kind === 'placeSettlement' || current.kind === 'placeRoad') && current.forced) return IDLE_MODE
  if (current.kind === 'roadBuilding' && (view.turn.phase !== 'main' || view.turn.current !== seat))
    return IDLE_MODE
  return current
}

/** True while `deriveMode` would force *some* mode on this seat right now (setup/discard/robber). */
function isModeForced(view: CatanClientState, seat: number | null): boolean {
  return deriveMode(view, seat, IDLE_MODE).kind !== 'idle'
}

/**
 * Function that actually delivers an intent to the server. Store handlers
 * below take it as a parameter (never imported at module scope) so that:
 *   1. catanStore.ts stays decoupled from net/catan.ts, which itself imports
 *      useCatanStore — importing sendCatanIntent here would be circular.
 *   2. tests can inject a spy and assert on emitted intents with zero mocking.
 * Callers (PickLayer, BuildBar) pass the real `sendCatanIntent` explicitly.
 */
export type SendIntent = (intent: CatanClientIntent) => void

/** Legal vertex ids for the given mode; empty outside placeSettlement/placeCity. */
export function legalVerticesForMode(view: CatanClientState, seat: number, mode: Mode): VertexId[] {
  if (mode.kind === 'placeSettlement') {
    return legalSettlementVertices(view, seat, { setup: view.turn.phase === 'setup' })
  }
  if (mode.kind === 'placeCity') return legalCityVertices(view, seat)
  return []
}

/** Legal edge ids for the given mode; setup uses the just-placed settlement's open edges. */
export function legalEdgesForMode(view: CatanClientState, seat: number, mode: Mode): EdgeId[] {
  if (mode.kind === 'roadBuilding') return legalRoadBuildingEdges(view, seat, mode.staged)
  if (mode.kind !== 'placeRoad') return []
  if (view.turn.phase !== 'setup') return legalRoadEdges(view, seat)
  const last = view.turn.setup?.lastSettlement
  if (!last) return []
  return (standardTopology().vertexEdges[last] ?? []).filter((e) => view.roads[e] === undefined)
}

/** Pure: the intent a vertex click produces in the given mode, or null if illegal/inapplicable. */
export function resolveVertexClick(
  view: CatanClientState,
  seat: number,
  mode: Mode,
  vertex: VertexId,
): CatanClientIntent | null {
  if (mode.kind !== 'placeSettlement' && mode.kind !== 'placeCity') return null
  if (!legalVerticesForMode(view, seat, mode).includes(vertex)) return null
  if (mode.kind === 'placeCity') return { type: 'build', piece: 'city', location: vertex }
  return view.turn.phase === 'setup'
    ? { type: 'placeSetupSettlement', vertex }
    : { type: 'build', piece: 'settlement', location: vertex }
}

/** Pure: the intent an edge click produces in the given mode, or null if illegal/inapplicable. */
export function resolveEdgeClick(
  view: CatanClientState,
  seat: number,
  mode: Mode,
  edge: EdgeId,
): CatanClientIntent | null {
  if (mode.kind !== 'placeRoad') return null
  if (!legalEdgesForMode(view, seat, mode).includes(edge)) return null
  return view.turn.phase === 'setup'
    ? { type: 'placeSetupRoad', edge }
    : { type: 'build', piece: 'road', location: edge }
}

/** Adjacent-owner ids the robber could steal from at `hex`: not us, and holding resources. */
export function robberVictims(view: CatanClientState, seat: number, hex: Coord): number[] {
  const verts = standardTopology().hexVertices[coordKey(hex)] ?? []
  const owners = new Set<number>()
  for (const v of verts) {
    const owner = view.buildings[v]?.owner
    if (owner === undefined || owner === seat) continue
    if ((view.players[owner]?.resourceCount ?? 0) > 0) owners.add(owner)
  }
  return [...owners]
}

/** Pure: what a hex click does in robber mode — send directly, enter steal mode, or nothing. */
export function resolveHexClick(
  view: CatanClientState,
  seat: number,
  mode: Mode,
  hex: Coord,
): { intent: CatanClientIntent } | { mode: Mode } | null {
  if (mode.kind !== 'robber') return null
  if (coordKey(hex) === view.board.robber) return null // robber can't stay put
  const victims = robberVictims(view, seat, hex)
  if (victims.length === 0) return { intent: { type: 'moveRobber', hex, stealFrom: null } }
  return { mode: { kind: 'steal', hex, victims } }
}

/** Per-resource counts the player has staged to discard; always fully populated (never partial). */
export type DiscardSelection = Record<Resource, number>

const EMPTY_DISCARD: DiscardSelection = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }

/** Sum of a discard selection across all resources. */
export function discardSelectionTotal(selection: DiscardSelection): number {
  return RESOURCES.reduce((sum, r) => sum + selection[r], 0)
}

/** Pure: selection after +1 on `resource`, refusing to exceed the player's hand count for it. */
export function incrementDiscardSelection(
  hand: ResourceCount,
  selection: DiscardSelection,
  resource: Resource,
): DiscardSelection {
  if (selection[resource] >= hand[resource]) return selection
  return { ...selection, [resource]: selection[resource] + 1 }
}

/** Pure: selection after -1 on `resource`, floored at 0. */
export function decrementDiscardSelection(selection: DiscardSelection, resource: Resource): DiscardSelection {
  if (selection[resource] <= 0) return selection
  return { ...selection, [resource]: selection[resource] - 1 }
}

/** Pure: the `discard` intent for a selection. Protocol requires positive counts only — zeros omitted. */
export function discardIntent(selection: DiscardSelection): CatanClientIntent {
  const resources: Partial<ResourceCount> = {}
  for (const r of RESOURCES) if (selection[r] > 0) resources[r] = selection[r]
  return { type: 'discard', resources }
}

interface CatanState {
  status: CatanStatus
  roomId: string | null
  seat: number | null
  view: CatanClientState | null
  toast: string | null
  winner: CatanMatchResult | null
  mode: Mode
  /** Cards staged to discard while in `discard` mode; reset on entering it, and on submit. */
  discardSelection: DiscardSelection
  /** Lobby roster (waiting room), sessionIds by seat. */
  seats: string[]
  connected: boolean[]
  targetPlayers: number | null
  /** Reserved bot seats (server appends bot players at match start; empty during 'waiting'). */
  botCount: number

  /** TradePanel: open/closed, and which tab (player offer vs. bank) is active. */
  tradeOpen: boolean
  tradeTab: 'players' | 'bank'
  /** Staged composer selections for a new player-to-player offer. */
  tradeGive: ResourceSelection
  tradeGet: ResourceSelection
  /** Staged bank-trade picks (single resource each side). */
  bankGive: Resource | null
  bankGet: Resource | null
  /** Staged counter-offer draft while responding to an incoming trade; null outside that flow. */
  counterDraft: { give: ResourceSelection; get: ResourceSelection } | null

  /** Incoming-trade mute (HUD toggle, `trade-mute-toggle`): a device-level preference, persisted
   * in localStorage and deliberately NOT reset by `reset()` (see below) — it must survive
   * leaving and starting a new match. Default OFF. */
  tradeMute: boolean
  /** True from the moment a muted auto-decline is sent until the offer it answered closes;
   * guards against re-sending while the response is still in flight (see `shouldAutoDecline`). */
  autoDeclinePending: boolean

  /** DevModal: which dev-card modal (if any) is open. */
  devModal: 'yearOfPlenty' | 'monopoly' | null
  /** Staged yearOfPlenty picks; reset on opening the modal. */
  plentySelection: ResourceSelection

  setStatus(status: CatanStatus): void
  setJoined(roomId: string): void
  setSeat(seat: number): void
  setLobby(seats: string[], connected: boolean[], targetPlayers: number, botCount: number): void
  ingestSnapshot(payload: CatanSnapshotPayload): void
  setMode(mode: Mode): void
  setToast(message: string | null): void
  ruleError(message: string): void
  setWinner(result: CatanMatchResult): void
  reset(): void

  /** BuildBar: pick (or un-pick, toggling back to idle) a voluntary placement mode. */
  toggleBuildMode(kind: 'placeRoad' | 'placeSettlement' | 'placeCity'): void
  /** PickLayer: vertex click, dispatched per current mode. No-op if illegal/inapplicable. */
  clickVertex(vertex: VertexId, send: SendIntent): void
  /** PickLayer: edge click, dispatched per current mode. No-op if illegal/inapplicable. */
  clickEdge(edge: EdgeId, send: SendIntent): void
  /** PickLayer: hex click in robber mode — sends moveRobber or enters steal mode. */
  clickHex(hex: Coord, send: SendIntent): void
  /** Esc: cancel a voluntary placement mode. Never touches a forced mode. */
  cancelMode(): void
  /** BuildBar/DevPanel: enter roadBuilding mode if the view shows a playable roadBuilding card. */
  startRoadBuilding(): void

  /** DiscardModal: +1 to a resource's staged discard count, capped at the hand count. */
  incrementDiscard(resource: Resource): void
  /** DiscardModal: -1 to a resource's staged discard count, floored at 0. */
  decrementDiscard(resource: Resource): void
  /** DiscardModal: sends `discard` iff the staged total equals what's owed; no-op otherwise. */
  submitDiscard(send: SendIntent): void
  /** StealChooser: victim-seat click — sends moveRobber with that stealFrom. No-op outside steal mode. */
  clickStealVictim(victim: number, send: SendIntent): void

  /** TradePanel: open/close the panel; opening resets composer staging. No-op while a forced mode is active. */
  toggleTrade(): void
  setTradeTab(tab: 'players' | 'bank'): void
  /** Composer: +1 to the offer's give side, capped at the hand count. */
  incTradeGive(r: Resource): void
  /** Composer: -1 to the offer's give side, floored at 0. */
  decTradeGive(r: Resource): void
  /** Composer: +1 to the offer's get side, uncapped. */
  incTradeGet(r: Resource): void
  /** Composer: -1 to the offer's get side, floored at 0. */
  decTradeGet(r: Resource): void
  setBankGive(r: Resource | null): void
  setBankGet(r: Resource | null): void
  /** Composer: sends offerTrade from the staged selections; no-op if either side is empty. */
  submitOffer(send: SendIntent): void
  /** Bank tab: sends bankTrade from the staged picks; no-op if the trade isn't affordable. */
  submitBankTrade(send: SendIntent): void
  /** Responder: accept/reject the open offer as-is. */
  respondToOffer(response: 'accept' | 'reject', send: SendIntent): void
  /** Responder: seed a counter-offer draft from the open offer, clamped to the responder's hand. */
  startCounter(): void
  /** Counter draft: +1 to the give side, capped at the hand count. */
  incCounterGive(r: Resource): void
  /** Counter draft: -1 to the give side, floored at 0. */
  decCounterGive(r: Resource): void
  /** Counter draft: +1 to the get side, uncapped. */
  incCounterGet(r: Resource): void
  /** Counter draft: -1 to the get side, floored at 0. */
  decCounterGet(r: Resource): void
  /** Responder: sends the counter draft as a respondTrade counter, then clears it. */
  submitCounter(send: SendIntent): void
  /** Responder: discard the counter draft without sending. */
  cancelCounter(): void
  /** Offerer: confirm-trade with a specific responder who accepted/countered. */
  confirmTradeWith(partner: number, send: SendIntent): void
  /** Offerer: cancel the open offer outright. */
  cancelOpenTrade(send: SendIntent): void
  /** HUD toggle: flip trade-mute and persist the choice. */
  toggleTradeMute(): void
  /** IncomingOffer effect: auto-decline this seat's open offer while muted (see `shouldAutoDecline`). No-op otherwise. */
  autoDeclineIfMuted(send: SendIntent): void

  /** DevModal: open the yearOfPlenty/monopoly modal, resetting the plenty staging. */
  openDevModal(kind: 'yearOfPlenty' | 'monopoly'): void
  closeDevModal(): void
  /** yearOfPlenty: +1 to a resource's staged pick, capped at 2 total and at the bank's count. */
  incPlenty(r: Resource): void
  /** yearOfPlenty: -1 to a resource's staged pick, floored at 0. */
  decPlenty(r: Resource): void
  /** yearOfPlenty: sends playDevCard from the staged picks and closes the modal on success. */
  submitPlenty(send: SendIntent): void
  /** monopoly: sends playDevCard for the chosen resource and closes the modal. */
  submitMonopoly(r: Resource, send: SendIntent): void
}

const INITIAL = {
  status: 'idle' as CatanStatus,
  roomId: null as string | null,
  seat: null as number | null,
  view: null as CatanClientState | null,
  toast: null as string | null,
  winner: null as CatanMatchResult | null,
  mode: IDLE_MODE,
  discardSelection: EMPTY_DISCARD,
  seats: [] as string[],
  connected: [] as boolean[],
  targetPlayers: null as number | null,
  botCount: 0,
  tradeOpen: false,
  tradeTab: 'players' as const,
  tradeGive: emptySelection(),
  tradeGet: emptySelection(),
  bankGive: null as Resource | null,
  bankGet: null as Resource | null,
  counterDraft: null as { give: ResourceSelection; get: ResourceSelection } | null,
  devModal: null as 'yearOfPlenty' | 'monopoly' | null,
  plentySelection: emptySelection(),
  autoDeclinePending: false,
}

export const useCatanStore = create<CatanState>((set, get) => ({
  ...INITIAL,
  // Not part of INITIAL: reset() must not wipe a device-level preference the
  // player already set — see the field's doc comment on CatanState.
  tradeMute: loadTradeMute(),

  setStatus: (status) => set({ status }),
  setJoined: (roomId) => set({ roomId, status: 'waiting' }),
  setSeat: (seat) => set({ seat }),
  setLobby: (seats, connected, targetPlayers, botCount) => set({ seats, connected, targetPlayers, botCount }),

  ingestSnapshot: (payload) => {
    const { view, seat, mode, discardSelection } = get()
    if (view !== null && payload.seq <= view.seq) return // stale; drop
    const nextMode = deriveMode(payload.view, seat, mode)
    // Reset staged discards only on freshly entering discard mode — while
    // already in it (subsequent snapshots as other seats discard too) the
    // player's in-progress selection must survive.
    const enteringDiscard = nextMode.kind === 'discard' && mode.kind !== 'discard'
    const hadOpenTrade = view?.turn.openTrade != null
    const hasOpenTrade = payload.view.turn.openTrade != null
    const tradeResolved = hadOpenTrade && !hasOpenTrade
    // Our own offer just posted: the review panel replaces the composer, so the
    // staged selections are done with; a resolved/cancelled trade clears drafts.
    const ownOfferPosted = !hadOpenTrade && hasOpenTrade && payload.view.turn.current === seat
    const resetStaging = tradeResolved || ownOfferPosted
    set({
      view: payload.view,
      mode: nextMode,
      status: payload.view.winner !== null ? 'ended' : 'playing',
      discardSelection: enteringDiscard ? EMPTY_DISCARD : discardSelection,
      counterDraft: tradeResolved ? null : get().counterDraft,
      tradeGive: resetStaging ? emptySelection() : get().tradeGive,
      tradeGet: resetStaging ? emptySelection() : get().tradeGet,
      // Cleared whenever no offer is open, so the NEXT offer can be
      // auto-declined too — see shouldAutoDecline's `declinePending` guard.
      autoDeclinePending: hasOpenTrade ? get().autoDeclinePending : false,
    })
  },

  setMode: (mode) => set({ mode }),
  setToast: (toast) => set({ toast }),

  ruleError: (message) => {
    const { view, seat, mode } = get()
    if (mode.kind === 'roadBuilding') {
      set({ toast: message, mode: { kind: 'roadBuilding', staged: [] } })
      return
    }
    if (!PLACEMENT_KINDS.has(mode.kind)) {
      set({ toast: message })
      return
    }
    const stillForced = view !== null && isModeForced(view, seat)
    set({ toast: message, mode: stillForced ? mode : IDLE_MODE })
  },

  setWinner: (winner) => set({ winner, status: 'ended' }),

  reset: () => set({ ...INITIAL }),

  toggleBuildMode: (kind) => {
    const { mode } = get()
    if (STALE_IF_UNFORCED.has(mode.kind)) return // never override a forced discard/robber/steal mode
    set({ mode: mode.kind === kind ? IDLE_MODE : { kind } })
  },

  clickVertex: (vertex, send) => {
    const { view, seat, mode } = get()
    if (view === null || seat === null) return
    const intent = resolveVertexClick(view, seat, mode, vertex)
    if (!intent) return
    send(intent)
    if (!isModeForced(view, seat)) set({ mode: IDLE_MODE })
  },

  clickEdge: (edge, send) => {
    const { view, seat, mode } = get()
    if (view === null || seat === null) return
    if (mode.kind === 'roadBuilding') {
      const result = resolveRoadBuildingClick(view, seat, mode, edge)
      if (!result) return
      if ('intent' in result) {
        send(result.intent)
        set({ mode: IDLE_MODE })
      } else set({ mode: result.mode })
      return
    }
    const intent = resolveEdgeClick(view, seat, mode, edge)
    if (!intent) return
    send(intent)
    if (!isModeForced(view, seat)) set({ mode: IDLE_MODE })
  },

  clickHex: (hex, send) => {
    const { view, seat, mode } = get()
    if (view === null || seat === null) return
    const result = resolveHexClick(view, seat, mode, hex)
    if (!result) return
    if ('intent' in result) send(result.intent)
    else set({ mode: result.mode })
  },

  cancelMode: () => {
    const { view, seat, mode } = get()
    if (!PLACEMENT_KINDS.has(mode.kind) && mode.kind !== 'roadBuilding') return
    if (view !== null && isModeForced(view, seat)) return
    set({ mode: IDLE_MODE })
  },

  incrementDiscard: (resource) => {
    const { view, discardSelection } = get()
    if (view === null) return
    set({ discardSelection: incrementDiscardSelection(view.you.resources, discardSelection, resource) })
  },

  decrementDiscard: (resource) => {
    const { discardSelection } = get()
    set({ discardSelection: decrementDiscardSelection(discardSelection, resource) })
  },

  submitDiscard: (send) => {
    const { view, seat, discardSelection } = get()
    if (view === null || seat === null) return
    const owed = view.turn.pendingDiscards[seat] ?? 0
    if (discardSelectionTotal(discardSelection) !== owed) return
    send(discardIntent(discardSelection))
    set({ discardSelection: EMPTY_DISCARD })
  },

  clickStealVictim: (victim, send) => {
    const { mode } = get()
    if (mode.kind !== 'steal') return
    if (!mode.victims.includes(victim)) return
    send({ type: 'moveRobber', hex: mode.hex, stealFrom: victim })
  },

  toggleTrade: () => {
    const { tradeOpen, mode } = get()
    if (STALE_IF_UNFORCED.has(mode.kind)) return // never over a forced discard/robber/steal
    set(
      tradeOpen
        ? { tradeOpen: false }
        : { tradeOpen: true, tradeTab: 'players', tradeGive: emptySelection(), tradeGet: emptySelection(), bankGive: null, bankGet: null },
    )
  },
  setTradeTab: (tradeTab) => set({ tradeTab }),
  incTradeGive: (r) => {
    const { view, tradeGive } = get()
    if (view === null) return
    set({ tradeGive: incrementSelection(tradeGive, r, view.you.resources[r]) })
  },
  decTradeGive: (r) => set({ tradeGive: decrementSelection(get().tradeGive, r) }),
  incTradeGet: (r) => set({ tradeGet: incrementSelection(get().tradeGet, r) }),
  decTradeGet: (r) => set({ tradeGet: decrementSelection(get().tradeGet, r) }),
  setBankGive: (bankGive) => set({ bankGive }),
  setBankGet: (bankGet) => set({ bankGet }),
  submitOffer: (send) => {
    const intent = offerTradeIntent(get().tradeGive, get().tradeGet)
    if (intent) send(intent)
  },
  submitBankTrade: (send) => {
    const { view, seat, bankGive, bankGet } = get()
    if (view === null || seat === null) return
    const intent = bankTradeIntent(view, seat, bankGive, bankGet)
    if (intent) send(intent)
  },
  respondToOffer: (response, send) => send({ type: 'respondTrade', response }),
  startCounter: () => {
    const { view, seat } = get()
    if (view === null || seat === null) return
    const offer = incomingOfferFor(view, seat)
    if (!offer) return
    const give = emptySelection()
    for (const r of RESOURCES) give[r] = Math.min(offer.youGive[r] ?? 0, view.you.resources[r])
    const getSel = emptySelection()
    for (const r of RESOURCES) getSel[r] = offer.youReceive[r] ?? 0
    set({ counterDraft: { give, get: getSel } })
  },
  incCounterGive: (r) => {
    const { view, counterDraft } = get()
    if (view === null || counterDraft === null) return
    set({ counterDraft: { ...counterDraft, give: incrementSelection(counterDraft.give, r, view.you.resources[r]) } })
  },
  decCounterGive: (r) => {
    const { counterDraft } = get()
    if (counterDraft === null) return
    set({ counterDraft: { ...counterDraft, give: decrementSelection(counterDraft.give, r) } })
  },
  incCounterGet: (r) => {
    const { counterDraft } = get()
    if (counterDraft === null) return
    set({ counterDraft: { ...counterDraft, get: incrementSelection(counterDraft.get, r) } })
  },
  decCounterGet: (r) => {
    const { counterDraft } = get()
    if (counterDraft === null) return
    set({ counterDraft: { ...counterDraft, get: decrementSelection(counterDraft.get, r) } })
  },
  submitCounter: (send) => {
    const { counterDraft } = get()
    if (counterDraft === null) return
    const intent = counterTradeIntent(counterDraft.give, counterDraft.get)
    if (!intent) return
    send(intent)
    set({ counterDraft: null })
  },
  cancelCounter: () => set({ counterDraft: null }),
  confirmTradeWith: (partner, send) => send({ type: 'confirmTrade', partner }),
  cancelOpenTrade: (send) => send({ type: 'cancelTrade' }),

  toggleTradeMute: () => {
    const next = !get().tradeMute
    saveTradeMute(next)
    set({ tradeMute: next })
  },
  autoDeclineIfMuted: (send) => {
    const { view, seat, tradeMute, autoDeclinePending } = get()
    if (view === null || seat === null) return
    if (!shouldAutoDecline(view, seat, tradeMute, autoDeclinePending)) return
    send({ type: 'respondTrade', response: 'reject' })
    set({ autoDeclinePending: true })
  },

  startRoadBuilding: () => {
    const { view, seat, mode } = get()
    if (view === null || seat === null) return
    if (STALE_IF_UNFORCED.has(mode.kind)) return
    if (!devHand(view, seat).some((g) => g.card === 'roadBuilding' && g.playable)) return
    set({ mode: { kind: 'roadBuilding', staged: [] }, tradeOpen: false })
  },
  openDevModal: (devModal) => set({ devModal, plentySelection: emptySelection() }),
  closeDevModal: () => set({ devModal: null }),
  incPlenty: (r) => {
    const { view, plentySelection } = get()
    if (view === null) return
    if (selectionTotal(plentySelection) >= 2) return
    set({ plentySelection: incrementSelection(plentySelection, r, Math.min(2, view.bank[r])) })
  },
  decPlenty: (r) => set({ plentySelection: decrementSelection(get().plentySelection, r) }),
  submitPlenty: (send) => {
    const { view, plentySelection } = get()
    if (view === null) return
    const intent = yearOfPlentyIntent(plentySelection, view.bank)
    if (!intent) return
    send(intent)
    set({ devModal: null })
  },
  submitMonopoly: (r, send) => {
    send(monopolyIntent(r))
    set({ devModal: null })
  },
}))
