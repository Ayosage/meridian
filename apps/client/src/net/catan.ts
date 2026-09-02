import { Client, type Room } from 'colyseus.js'
import {
  MSG,
  type CatanClientIntent,
  type CatanSnapshotPayload,
  type MatchEndedPayload,
  type RuleErrorPayload,
} from '@meridian/protocol'
import type { CatanPlayerCount } from '@meridian/rules'
import { useCatanStore } from '../scene/catan/catanStore'
import { tokenStorage } from './tokenStorage'

const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:2567'

/**
 * Duck-typed view of the server's CatanLobbyState schema as decoded by
 * colyseus.js. Game state itself never enters this — it only ever arrives
 * via MSG.SNAPSHOT (see CatanRoom's design spec §4).
 */
interface CatanLobbyClientState {
  phase: string
  targetPlayers: number
  seats: Iterable<string> & { indexOf(sessionId: string): number; length: number }
  connected: Iterable<boolean> & { length: number }
  botCount: number
  seatNames: Iterable<string> & { length: number }
}

let client: Client | null = null
let room: Room<CatanLobbyClientState> | null = null

function getClient(): Client {
  client ??= new Client(SERVER_URL)
  return client
}

export function getCatanRoom(): Room<CatanLobbyClientState> | null {
  return room
}

/**
 * Optional numeric query params forwarded to room creation options so the E2E
 * suite can spin up deterministic (?seed=) and fast-finishing (?vp=) matches.
 */
function numberParam(name: string): number | undefined {
  if (typeof window === 'undefined') return undefined
  const raw = new URLSearchParams(window.location.search).get(name)
  if (raw === null) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

export async function createCatanMatch(players: CatanPlayerCount, bots: number): Promise<void> {
  useCatanStore.getState().setStatus('connecting')
  const seed = numberParam('seed')
  const targetVp = numberParam('vp')
  const botsOverride = numberParam('bots') // E2E hook, same idiom as ?seed=/?vp=
  const options = {
    players,
    bots: botsOverride ?? bots,
    ...(seed !== undefined ? { seed } : {}),
    ...(targetVp !== undefined ? { targetVp } : {}),
  }
  enterRoom(await getClient().create<CatanLobbyClientState>('catan', options))
}

/** ?join=CODE from a launch link (docs/DISCORD-LAUNCH.md) — normalized room code, or null. */
export function launchJoinCode(search: string): string | null {
  const raw = new URLSearchParams(search).get('join')?.trim().toUpperCase() ?? ''
  return /^[A-Z0-9]{1,12}$/.test(raw) ? raw : null
}

export async function joinCatanMatch(code: string): Promise<void> {
  useCatanStore.getState().setStatus('connecting')
  enterRoom(await getClient().joinById<CatanLobbyClientState>(code.toUpperCase()))
}

export interface ReconnectOptions {
  /** Total attempts before the token is declared dead. */
  attempts?: number
  /** Pause between attempts. */
  delayMs?: number
}

/**
 * Try to resume via a persisted token for any known room. Clears it if dead.
 *
 * Retries: on a page reload the new page's reconnect can reach the server
 * before the OLD socket's close has been processed — CatanRoom only registers
 * the token in `onLeave` (allowReconnection), so that first attempt bounces
 * as "token invalid or expired" and, without a retry, the seat was handed to
 * autopilot and the token thrown away (reproduced on every reload in Chromium).
 */
export async function reconnectCatan({ attempts = 3, delayMs = 400 }: ReconnectOptions = {}): Promise<boolean> {
  const saved = tokenStorage.getAny()
  if (!saved) return false
  useCatanStore.getState().setStatus('reconnecting')
  for (let attempt = 1; ; attempt++) {
    try {
      enterRoom(await getClient().reconnect<CatanLobbyClientState>(saved.token))
      return true
    } catch {
      if (attempt >= attempts) break
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  tokenStorage.clearFor(saved.roomId)
  useCatanStore.getState().setStatus('idle')
  return false
}

export function sendCatanIntent(intent: CatanClientIntent): void {
  room?.send(MSG.INTENT, intent)
}

/** Host-only: start a 4-room early once 3 seats are filled. */
export function startEarly(): void {
  room?.send(MSG.START)
}

export function leaveCatanMatch(): void {
  if (room) tokenStorage.clearFor(room.roomId)
  void room?.leave()
  room = null
  useCatanStore.getState().reset()
}

function enterRoom(r: Room<CatanLobbyClientState>): void {
  room = r
  tokenStorage.setFor(r.roomId, r.reconnectionToken)
  const store = () => useCatanStore.getState()
  store().setJoined(r.roomId)

  r.onStateChange((state) => {
    const seat = state.seats.indexOf(r.sessionId)
    if (seat !== -1 && store().seat !== seat) store().setSeat(seat)
    store().setLobby(Array.from(state.seats), Array.from(state.connected), state.targetPlayers, state.botCount ?? 0, Array.from(state.seatNames ?? []))
    if (state.phase === 'waiting') store().setStatus('waiting')
  })

  r.onMessage(MSG.SNAPSHOT, (payload: CatanSnapshotPayload) => {
    store().ingestSnapshot(payload)
  })
  r.onMessage(MSG.RULE_ERROR, (payload: RuleErrorPayload) => {
    store().ruleError(`${payload.code}: ${payload.message}`)
  })
  r.onMessage(MSG.MATCH_ENDED, (payload: MatchEndedPayload) => {
    // A finished match's reconnection token is dead weight: clear it so
    // getAny() (used on reload to auto-resume) can't pick a stale, ended
    // room instead of a live one.
    tokenStorage.clearFor(r.roomId)
    // Catan match-end is always a win (no forfeit path yet); pin the literal
    // so it matches CatanMatchResult's narrower `reason` type.
    store().setWinner({ reason: 'win', winner: payload.winner })
  })
  r.onMessage('*', () => undefined)

  r.onLeave(() => {
    if (store().status === 'ended' || store().status === 'idle') return
    void reconnectCatan().then((ok) => {
      if (!ok) {
        store().setToast('connection lost')
        store().setStatus('error')
      }
    })
  })
}
