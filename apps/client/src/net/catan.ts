import type { CatanClientIntent, CatanEvent, ClientEnvelope, ServerEnvelope } from '@meridian/protocol'
import type { CatanClientState, CatanPlayerCount } from '@meridian/rules'
import { useCatanStore } from '../scene/catan/catanStore'
import { friendlyRuleMessage } from '../ui/waitingRoomLogic'
import { MatchSocket, httpOrigin, wsUrl } from './socket'
import { tokenStorage } from './tokenStorage'

/** The Worker's origin. http(s) for the create/lookup calls; the socket url is derived from it. */
const SERVER_ORIGIN: string = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8787'
const HTTP = httpOrigin(SERVER_ORIGIN)

type Hello = Extract<ClientEnvelope, { t: 'hello' }>

let socket: MatchSocket | null = null
let currentCode: string | null = null

/** The object refused to seat us; `code` is the protocol error code. */
class JoinRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function param(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

/**
 * Optional numeric query params forwarded as test knobs so the E2E suite can
 * spin up deterministic (?seed=) and fast-finishing (?vp=) matches. The Worker
 * ignores them unless TEST_KNOBS=1.
 */
function numberParam(name: string): number | undefined {
  const raw = param(name)
  if (raw === null) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

export async function createCatanMatch(players: CatanPlayerCount, bots: number): Promise<void> {
  useCatanStore.getState().setStatus('connecting')
  const seed = numberParam('seed')
  const targetVp = numberParam('vp')
  const botsOverride = numberParam('bots') // E2E hook, same idiom as ?seed=/?vp=
  const knobs = {
    ...(seed !== undefined ? { seed } : {}),
    ...(targetVp !== undefined ? { targetVp } : {}),
  }
  const res = await fetch(`${HTTP}/matches/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ players, bots: botsOverride ?? bots, knobs }),
  })
  if (res.status !== 201) throw new Error(`create failed (${res.status})`)
  const { code } = (await res.json()) as { code: string }
  await enterRoom(code, { t: 'hello' })
}

/** ?join=CODE from a launch link (docs/DISCORD-LAUNCH.md): normalized room code, or null. */
export function launchJoinCode(search: string): string | null {
  const raw = new URLSearchParams(search).get('join')?.trim().toUpperCase() ?? ''
  return /^[A-Z0-9]{1,12}$/.test(raw) ? raw : null
}

/**
 * One sentence for the lobby's error line. An unknown code (the lobby lookup
 * is a 404) is a typo; a full or started room says so; anything else is the
 * Worker being unreachable.
 */
export function describeJoinError(e: unknown): string {
  const err = e as { code?: unknown; message?: unknown } | null
  const code = err?.code
  const message = typeof err?.message === 'string' ? err.message : ''
  if (code === 'FULL') return 'That match is full.'
  if (code === 'NOT_WAITING') return 'That match has already started.'
  if (code === 4212 || code === 'NOT_FOUND' || /not found|invalid room|no rooms|no such match/i.test(message)) {
    return 'No match with that code. Check the four letters and try again.'
  }
  return 'Could not reach the game server. Check your connection and try again.'
}

/** Shown when a `?join=` link points at a room that has ended or expired. */
export const DEAD_LINK_MESSAGE = 'That match has ended or the link has expired.'

/**
 * The same sentence for an invite link (`?join=CODE`), where nobody typed the
 * code: a room the Worker has never heard of is a dead link, not a typo, so
 * only that case swaps in DEAD_LINK_MESSAGE. Everything else (full, already
 * started, server unreachable) keeps its own reason, which is what the invite
 * path used to throw away.
 */
export function describeInviteError(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  if (code === 'NOT_FOUND' || code === 4212) return DEAD_LINK_MESSAGE
  return describeJoinError(e)
}

export async function joinCatanMatch(code: string): Promise<void> {
  useCatanStore.getState().setStatus('connecting')
  const c = code.toUpperCase()
  // The personal Steward link carries ?seat=<token>; App strips the query right after calling us, so read it now.
  const seatToken = param('seat')
  const probe = await fetch(`${HTTP}/matches/${c}`)
  if (probe.status === 404) throw new JoinRefused('NOT_FOUND', 'no such match (404)')
  if (!probe.ok) throw new Error(`lobby lookup failed (${probe.status})`)
  await enterRoom(c, { t: 'hello', ...(seatToken ? { seatToken } : {}) })
}

export interface ReconnectOptions {
  /** Total attempts before the token is declared dead. */
  attempts?: number
  /** Pause before the second attempt; doubles each time, capped at 5s. */
  delayMs?: number
}

/**
 * Try to resume via a persisted token for any known room. Clears it if dead.
 * Retries cover the reload race (the old socket's close may still be in
 * flight) and short network blips.
 */
export async function reconnectCatan({ attempts = 6, delayMs = 400 }: ReconnectOptions = {}): Promise<boolean> {
  const saved = tokenStorage.getAny()
  if (!saved) return false
  useCatanStore.getState().setStatus('reconnecting')
  let delay = delayMs
  for (let attempt = 1; ; attempt++) {
    try {
      await enterRoom(saved.roomId, { t: 'hello', token: saved.token }, true)
      return true
    } catch (e) {
      // a refused token is dead now; anything else may be transient
      if (e instanceof JoinRefused || attempt >= attempts) break
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(5000, delay * 2)
    }
  }
  tokenStorage.clearFor(saved.roomId)
  useCatanStore.getState().setStatus('idle')
  return false
}

export function sendCatanIntent(intent: CatanClientIntent): void {
  socket?.send({ t: 'intent', intent })
}

/** Host only, while waiting: resize the table. The object answers with a lobby broadcast or an error. */
export function configureLobby(players: number, bots: number): void {
  socket?.send({ t: 'configure', players, bots })
}

/** Host only, while waiting: start with the people present; bots take the empty seats. */
export function startMatch(): void {
  socket?.send({ t: 'start' })
}

export function leaveCatanMatch(): void {
  if (currentCode) tokenStorage.clearFor(currentCode)
  socket?.close()
  socket = null
  currentCode = null
  useCatanStore.getState().reset()
}

/**
 * Dial the room, wait for `welcome` (or a refusal), and wire the store. Store
 * writes for the welcome happen inside the listener so the lobby and snapshot
 * that follow it are applied in order.
 */
async function enterRoom(code: string, hello: Hello, isReconnect = false): Promise<void> {
  const s = new MatchSocket()
  const store = () => useCatanStore.getState()
  let welcomed = false
  const welcome = new Promise<void>((resolve, reject) => {
    s.onMessage((m) => {
      if (welcomed) return
      if (m.t === 'welcome') {
        welcomed = true
        tokenStorage.setFor(code, m.token)
        store().setJoined(code)
        store().setSeat(m.seat)
        // keep the last known board up until the snapshot lands (App renders the match while reconnecting)
        if (isReconnect) store().setStatus('reconnecting')
        resolve()
      } else if (m.t === 'error') {
        reject(new JoinRefused(m.code, m.message))
      }
    })
    s.onClose((c) => {
      if (!welcomed) reject(new Error(`socket closed before welcome (${c})`))
    })
  })
  welcome.catch(() => undefined) // settled below; this keeps a connect() failure from also logging as unhandled
  s.onMessage((m) => {
    if (welcomed) handleMessage(m)
  })
  s.onClose(() => {
    if (socket !== s) return
    if (store().status === 'ended' || store().status === 'idle') return
    void reconnectCatan().then((ok) => {
      if (!ok) {
        store().setToast('Connection to the match was lost.')
        store().setStatus('error')
      }
    })
  })
  try {
    await s.connect(wsUrl(SERVER_ORIGIN, code), hello)
    await welcome
  } catch (e) {
    s.close()
    throw e
  }
  const previous = socket
  socket = s
  currentCode = code
  if (previous && previous !== s) previous.close()
}

function handleMessage(m: ServerEnvelope): void {
  const store = useCatanStore.getState()
  switch (m.t) {
    case 'lobby':
      store.setLobby(m.seats, m.connected, m.targetPlayers, m.botCount, m.seatNames)
      if (m.phase === 'waiting') store.setStatus('waiting')
      break
    case 'snapshot':
      store.ingestSnapshot({
        seq: m.seq,
        view: m.view as CatanClientState,
        ...(m.events ? { events: m.events as CatanEvent[] } : {}),
      })
      break
    case 'error':
      store.ruleError(friendlyRuleMessage(m.message))
      break
    case 'ended':
      // A finished match's token is dead weight: clear it so getAny() (auto-resume on reload) can't pick it.
      if (currentCode) tokenStorage.clearFor(currentCode)
      store.setWinner(
        m.reason === 'abandoned' ? { reason: 'abandoned', winner: null } : { reason: 'win', winner: m.winner ?? 0 },
      )
      break
    case 'welcome':
      // A second welcome means the seat moved (the launcher's host arrived and took seat 0).
      store.setSeat(m.seat)
      break
  }
}
