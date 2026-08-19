import { create } from 'zustand'
import type { CatanSnapshotPayload } from '@meridian/protocol'
import type { CatanClientState, Coord } from '@meridian/rules'

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

interface CatanState {
  status: CatanStatus
  roomId: string | null
  seat: number | null
  view: CatanClientState | null
  toast: string | null
  winner: CatanMatchResult | null
  mode: Mode
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
}

const INITIAL = {
  status: 'idle' as CatanStatus,
  roomId: null as string | null,
  seat: null as number | null,
  view: null as CatanClientState | null,
  toast: null as string | null,
  winner: null as CatanMatchResult | null,
  mode: IDLE_MODE,
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
    const { view, seat, mode } = get()
    if (view !== null && payload.seq <= view.seq) return // stale; drop
    set({
      view: payload.view,
      mode: deriveMode(payload.view, seat, mode),
      status: payload.view.winner !== null ? 'ended' : 'playing',
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
    const stillForced = view !== null && deriveMode(view, seat, IDLE_MODE).kind !== 'idle'
    set({ toast: message, mode: stillForced ? mode : IDLE_MODE })
  },

  setWinner: (winner) => set({ winner, status: 'ended' }),

  reset: () => set({ ...INITIAL }),
}))
