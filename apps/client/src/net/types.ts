/**
 * Duck-typed view of the server's MatchState schema as decoded by
 * colyseus.js. The client deliberately does NOT import server code —
 * these structural types are the entire coupling surface.
 */
export interface ClientPiece {
  id: string
  owner: number
  pieceType: string
  q: number
  r: number
}

export interface ClientMatchState {
  phase: string
  currentPlayer: number
  winner: number
  seq: number
  pieces: { forEach(cb: (p: ClientPiece) => void): void }
  seats: { indexOf(sessionId: string): number; length: number }
}
