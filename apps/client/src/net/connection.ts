import { Client, type Room } from 'colyseus.js'
import { MSG, type ClientIntent, type MatchEndedPayload, type RuleErrorPayload } from '@meridian/protocol'
import { placeholderRuleset, type GameState } from '@meridian/rules'
import { useMeridianStore } from '../store'
import { toGameState } from './toGameState'
import { tokenStorage } from './tokenStorage'
import type { ClientMatchState } from './types'

const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:2567'

let client: Client | null = null
let room: Room<ClientMatchState> | null = null

function getClient(): Client {
  client ??= new Client(SERVER_URL)
  return client
}

export function getRoom(): Room<ClientMatchState> | null {
  return room
}

export async function createMatch(): Promise<void> {
  useMeridianStore.getState().setStatus('connecting')
  enterRoom(await getClient().create<ClientMatchState>('match'))
}

export async function joinMatch(code: string): Promise<void> {
  useMeridianStore.getState().setStatus('connecting')
  enterRoom(await getClient().joinById<ClientMatchState>(code.toUpperCase()))
}

/** Try to resume via a persisted token. Clears the token if it is dead. */
export async function reconnectMatch(): Promise<boolean> {
  const token = tokenStorage.get()
  if (!token) return false
  try {
    useMeridianStore.getState().setStatus('reconnecting')
    enterRoom(await getClient().reconnect<ClientMatchState>(token))
    return true
  } catch {
    tokenStorage.clear()
    useMeridianStore.getState().setStatus('idle')
    return false
  }
}

export function sendIntent(intent: ClientIntent): void {
  room?.send(MSG.INTENT, intent)
}

export function leaveMatch(): void {
  void room?.leave()
  room = null
  tokenStorage.clear()
  useMeridianStore.getState().reset()
}

function enterRoom(r: Room<ClientMatchState>): void {
  room = r
  tokenStorage.set(r.reconnectionToken)
  const store = () => useMeridianStore.getState()
  store().setJoined(r.roomId)

  r.onStateChange((state) => {
    const seat = state.seats.indexOf(r.sessionId)
    if (seat !== -1 && store().seat !== seat) store().setSeat(seat)
    if (state.phase === 'waiting') store().setStatus('waiting')
    else store().setGame(toGameState(state, placeholderRuleset))
  })

  r.onMessage(MSG.RULE_ERROR, (payload: RuleErrorPayload) => {
    store().setError(`${payload.code}: ${payload.message}`)
    store().clearSelection()
  })
  r.onMessage(MSG.MATCH_ENDED, (payload: MatchEndedPayload) => {
    store().setMatchResult(payload)
  })
  r.onMessage(MSG.SNAPSHOT, (payload: { state: GameState }) => {
    store().setGame(payload.state)
  })
  r.onMessage('*', () => undefined)

  r.onLeave(() => {
    if (store().status === 'ended' || store().status === 'idle') return
    void reconnectMatch().then((ok) => {
      if (!ok) {
        store().setError('connection lost')
        store().setStatus('error')
      }
    })
  })
}
