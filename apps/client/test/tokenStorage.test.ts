import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tokenStorage } from '../src/net/tokenStorage'

/** Minimal Storage polyfill: vitest runs in `environment: 'node'`, where
 * `sessionStorage` is undefined and tokenStorage silently falls back to its
 * in-memory path — which would mask a bug that only exists in the real
 * sessionStorage-backed branch. This forces that branch under test. */
class FakeSessionStorage {
  private data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null
  }
  get length(): number {
    return this.data.size
  }
}

describe('tokenStorage room-keyed API', () => {
  beforeEach(() => {
    tokenStorage.clearFor('room-a')
    tokenStorage.clearFor('room-b')
  })

  it('getFor returns the token set for that room', () => {
    tokenStorage.setFor('room-a', 'tok-a')
    expect(tokenStorage.getFor('room-a')).toBe('tok-a')
    expect(tokenStorage.getFor('room-b')).toBeNull()
  })

  it('getAny returns null when nothing is stored', () => {
    expect(tokenStorage.getAny()).toBeNull()
  })

  it('getAny returns the most recently set room, not scan order', () => {
    tokenStorage.setFor('room-a', 'tok-a')
    tokenStorage.setFor('room-b', 'tok-b')
    expect(tokenStorage.getAny()).toEqual({ roomId: 'room-b', token: 'tok-b' })
  })

  it('clearFor removes only that room; a stale recency pointer falls back to a surviving token', () => {
    tokenStorage.setFor('room-a', 'tok-a')
    tokenStorage.setFor('room-b', 'tok-b')
    tokenStorage.clearFor('room-b') // was the most-recent room
    expect(tokenStorage.getFor('room-b')).toBeNull()
    expect(tokenStorage.getAny()).toEqual({ roomId: 'room-a', token: 'tok-a' })
  })

  it('clearFor on the only stored room makes getAny return null', () => {
    tokenStorage.setFor('room-a', 'tok-a')
    tokenStorage.clearFor('room-a')
    expect(tokenStorage.getAny()).toBeNull()
  })

  it('does not disturb the legacy single-token API', () => {
    tokenStorage.set('legacy-tok')
    tokenStorage.setFor('room-a', 'tok-a')
    expect(tokenStorage.get()).toBe('legacy-tok')
    expect(tokenStorage.getFor('room-a')).toBe('tok-a')
    tokenStorage.clear()
    expect(tokenStorage.get()).toBeNull()
    expect(tokenStorage.getFor('room-a')).toBe('tok-a')
  })
})

describe('tokenStorage room-keyed API (sessionStorage-backed browser path)', () => {
  const original = (globalThis as { sessionStorage?: Storage }).sessionStorage

  beforeEach(() => {
    ;(globalThis as { sessionStorage?: Storage }).sessionStorage =
      new FakeSessionStorage() as unknown as Storage
  })

  afterEach(() => {
    ;(globalThis as { sessionStorage?: Storage }).sessionStorage = original
  })

  it('getAny returns the most recently set room deterministically, not sessionStorage key-enumeration order', () => {
    tokenStorage.setFor('room-a', 'tok-a')
    tokenStorage.setFor('room-b', 'tok-b')
    expect(tokenStorage.getAny()).toEqual({ roomId: 'room-b', token: 'tok-b' })
  })

  it('clearFor on the most-recent room falls back to a surviving token instead of null', () => {
    tokenStorage.setFor('room-a', 'tok-a')
    tokenStorage.setFor('room-b', 'tok-b')
    tokenStorage.clearFor('room-b')
    expect(tokenStorage.getAny()).toEqual({ roomId: 'room-a', token: 'tok-a' })
  })

  it('clearFor on the only room makes getAny return null', () => {
    tokenStorage.setFor('room-a', 'tok-a')
    tokenStorage.clearFor('room-a')
    expect(tokenStorage.getAny()).toBeNull()
  })
})
