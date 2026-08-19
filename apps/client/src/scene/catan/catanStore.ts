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
  | { kind: 'placeSettlement' }
  | { kind: 'placeRoad' }
  | { kind: 'placeCity' }
  | { kind: 'discard' }
  | { kind: 'robber' }
  | { kind: 'steal'; hex: Coord; victims: number[] }

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
    return turn.setup.expect === 'settlement' ? { kind: 'placeSettlement' } : { kind: 'placeRoad' }
  }
  if ((turn.pendingDiscards[seat] ?? 0) > 0) return { kind: 'discard' }
  if (turn.phase === 'robber' && turn.current === seat) {
    return current.kind === 'steal' ? current : { kind: 'robber' }
  }
  // Nothing forced right now. discard/robber/steal only ever arise from a
  // forced condition above, so once it no longer holds they're stale.
  // Placement modes may be a voluntary local pick and survive unrelated
  // snapshots (e.g. an opponent's dice roll shouldn't cancel your build UI).
  return STALE_IF_UNFORCED.has(current.kind) ? IDLE_MODE : current
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

  setStatus(status: CatanStatus): void
  setJoined(roomId: string): void
  setSeat(seat: number): void
  setLobby(seats: string[], connected: boolean[], targetPlayers: number): void
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

  /** DiscardModal: +1 to a resource's staged discard count, capped at the hand count. */
  incrementDiscard(resource: Resource): void
  /** DiscardModal: -1 to a resource's staged discard count, floored at 0. */
  decrementDiscard(resource: Resource): void
  /** DiscardModal: sends `discard` iff the staged total equals what's owed; no-op otherwise. */
  submitDiscard(send: SendIntent): void
  /** StealChooser: victim-seat click — sends moveRobber with that stealFrom. No-op outside steal mode. */
  clickStealVictim(victim: number, send: SendIntent): void
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
}

export const useCatanStore = create<CatanState>((set, get) => ({
  ...INITIAL,

  setStatus: (status) => set({ status }),
  setJoined: (roomId) => set({ roomId, status: 'waiting' }),
  setSeat: (seat) => set({ seat }),
  setLobby: (seats, connected, targetPlayers) => set({ seats, connected, targetPlayers }),

  ingestSnapshot: (payload) => {
    const { view, seat, mode, discardSelection } = get()
    if (view !== null && payload.seq <= view.seq) return // stale; drop
    const nextMode = deriveMode(payload.view, seat, mode)
    // Reset staged discards only on freshly entering discard mode — while
    // already in it (subsequent snapshots as other seats discard too) the
    // player's in-progress selection must survive.
    const enteringDiscard = nextMode.kind === 'discard' && mode.kind !== 'discard'
    set({
      view: payload.view,
      mode: nextMode,
      status: payload.view.winner !== null ? 'ended' : 'playing',
      discardSelection: enteringDiscard ? EMPTY_DISCARD : discardSelection,
    })
  },

  setMode: (mode) => set({ mode }),
  setToast: (toast) => set({ toast }),

  ruleError: (message) => {
    const { view, seat, mode } = get()
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
    if (!PLACEMENT_KINDS.has(mode.kind)) return
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
}))
