const KEY = 'meridian:reconnectionToken'
let memory: string | null = null

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
}
