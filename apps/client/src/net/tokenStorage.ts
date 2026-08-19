const KEY = 'meridian:reconnectionToken'
const ROOM_PREFIX = 'meridian:catan:token:'
/** Points getAny() at the most-recently-set room instead of relying on
 * sessionStorage's key-enumeration order (which has no recency semantics). */
const LAST_ROOM_KEY = 'meridian:catan:lastRoom'
let memory: string | null = null
const memoryByRoom = new Map<string, string>()
let memoryLastRoom: string | null = null

function hasSession(): boolean {
  return typeof sessionStorage !== 'undefined'
}

/** Reconnection token persistence: sessionStorage in the browser, in-memory in tests. */
export const tokenStorage = {
  get(): string | null {
    return hasSession() ? sessionStorage.getItem(KEY) : memory
  },
  set(token: string): void {
    if (hasSession()) sessionStorage.setItem(KEY, token)
    else memory = token
  },
  clear(): void {
    if (hasSession()) sessionStorage.removeItem(KEY)
    memory = null
  },

  // Room-keyed API (catan): keys the reconnection token by room id so a
  // sessionStorage tab copied into a new window can't hijack the seat of a
  // DIFFERENT room (a same-room copy remains possible; that's acceptable).
  setFor(roomId: string, token: string): void {
    if (hasSession()) {
      sessionStorage.setItem(ROOM_PREFIX + roomId, token)
      sessionStorage.setItem(LAST_ROOM_KEY, roomId)
    } else {
      memoryByRoom.set(roomId, token)
    }
    memoryLastRoom = roomId
  },
  getFor(roomId: string): string | null {
    return hasSession() ? sessionStorage.getItem(ROOM_PREFIX + roomId) : (memoryByRoom.get(roomId) ?? null)
  },
  clearFor(roomId: string): void {
    if (hasSession()) {
      sessionStorage.removeItem(ROOM_PREFIX + roomId)
      if (sessionStorage.getItem(LAST_ROOM_KEY) === roomId) sessionStorage.removeItem(LAST_ROOM_KEY)
    }
    memoryByRoom.delete(roomId)
    if (memoryLastRoom === roomId) memoryLastRoom = null
  },
  /**
   * Any persisted room token, for auto-resume on load. Prefers the
   * most-recently-set room (via the recency pointer); if that pointer is
   * missing or its token already gone, falls back to any surviving token
   * rather than returning null while a usable one still exists.
   */
  getAny(): { roomId: string; token: string } | null {
    if (hasSession()) {
      const last = sessionStorage.getItem(LAST_ROOM_KEY)
      if (last) {
        const token = sessionStorage.getItem(ROOM_PREFIX + last)
        if (token) return { roomId: last, token }
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)
        if (!key?.startsWith(ROOM_PREFIX)) continue
        const token = sessionStorage.getItem(key)
        if (token) return { roomId: key.slice(ROOM_PREFIX.length), token }
      }
      return null
    }
    if (memoryLastRoom) {
      const token = memoryByRoom.get(memoryLastRoom)
      if (token) return { roomId: memoryLastRoom, token }
    }
    for (const [roomId, token] of memoryByRoom) return { roomId, token }
    return null
  },
}
