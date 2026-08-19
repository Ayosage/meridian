import { create } from 'zustand'
import { coordKey, legalMoves, type GameState } from '@meridian/rules'

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'playing'
  | 'ended'
  | 'reconnecting'
  | 'error'

export interface MatchResult {
  reason: 'win' | 'forfeit'
  winner: number
}

const EMPTY: ReadonlySet<string> = new Set()

interface MeridianState {
  status: ConnectionStatus
  joinCode: string | null
  seat: number | null
  error: string | null
  game: GameState | null
  matchResult: MatchResult | null
  selectedPieceId: string | null
  legalTargets: ReadonlySet<string>
  setStatus(status: ConnectionStatus): void
  setJoined(joinCode: string): void
  setSeat(seat: number): void
  setGame(game: GameState): void
  setError(message: string | null): void
  setMatchResult(result: MatchResult): void
  selectPiece(pieceId: string): void
  clearSelection(): void
  reset(): void
}

export const useMeridianStore = create<MeridianState>((set, get) => ({
  status: 'idle',
  joinCode: null,
  seat: null,
  error: null,
  game: null,
  matchResult: null,
  selectedPieceId: null,
  legalTargets: EMPTY,

  setStatus: (status) => set({ status }),
  setJoined: (joinCode) => set({ joinCode, status: 'waiting' }),
  setSeat: (seat) => set({ seat }),

  setGame: (game) => {
    const { selectedPieceId, seat } = get()
    const ourTurn = game.winner === null && seat !== null && game.currentPlayer === seat
    const stillOurs =
      selectedPieceId !== null && game.pieces.some((p) => p.id === selectedPieceId && p.owner === seat)
    if (ourTurn && stillOurs && selectedPieceId !== null) {
      set({
        game,
        status: 'playing',
        legalTargets: new Set(legalMoves(game, selectedPieceId).map(coordKey)),
      })
    } else {
      set({
        game,
        status: game.winner === null ? 'playing' : 'ended',
        selectedPieceId: null,
        legalTargets: EMPTY,
      })
    }
  },

  setError: (error) => set({ error }),

  setMatchResult: (matchResult) =>
    set({ matchResult, status: 'ended', selectedPieceId: null, legalTargets: EMPTY }),

  selectPiece: (pieceId) => {
    const { game, seat } = get()
    if (!game || seat === null || game.winner !== null || game.currentPlayer !== seat) return
    const piece = game.pieces.find((p) => p.id === pieceId)
    if (!piece || piece.owner !== seat) return
    set({ selectedPieceId: pieceId, legalTargets: new Set(legalMoves(game, pieceId).map(coordKey)) })
  },

  clearSelection: () => set({ selectedPieceId: null, legalTargets: EMPTY }),

  reset: () =>
    set({
      status: 'idle',
      joinCode: null,
      seat: null,
      error: null,
      game: null,
      matchResult: null,
      selectedPieceId: null,
      legalTargets: EMPTY,
    }),
}))
