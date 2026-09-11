import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatchSocket, httpOrigin, wsUrl } from '../src/net/socket'
import { FakeWs } from './fakeWs'

beforeEach(() => {
  FakeWs.reset()
  vi.stubGlobal('WebSocket', FakeWs)
})
afterEach(() => vi.unstubAllGlobals())

describe('origins', () => {
  it('derives the socket url from the http origin, and tolerates a ws origin', () => {
    expect(wsUrl('https://meridian.example.workers.dev', 'ABCD')).toBe('wss://meridian.example.workers.dev/matches/ABCD/ws')
    expect(wsUrl('http://localhost:8787', 'ABCD')).toBe('ws://localhost:8787/matches/ABCD/ws')
    expect(wsUrl('ws://localhost:8787/', 'ABCD')).toBe('ws://localhost:8787/matches/ABCD/ws')
  })
  it('derives the http origin the same way', () => {
    expect(httpOrigin('wss://meridian.example.workers.dev')).toBe('https://meridian.example.workers.dev')
    expect(httpOrigin('http://localhost:8787/')).toBe('http://localhost:8787')
  })
})

describe('MatchSocket', () => {
  it('sends hello on open, parses server envelopes, and drops malformed ones', async () => {
    const got: unknown[] = []
    const s = new MatchSocket()
    const opened = s.connect('ws://x/matches/ABCD/ws', { t: 'hello' })
    s.onMessage((m) => got.push(m))
    FakeWs.last.open()
    await opened
    expect(FakeWs.last.sentMessages()).toEqual([{ t: 'hello' }])
    FakeWs.last.receive({ t: 'welcome', seat: 1, token: 'tok' })
    FakeWs.last.receive({ t: 'garbage' })
    FakeWs.last.receive('not even json {')
    expect(got).toEqual([{ t: 'welcome', seat: 1, token: 'tok' }])
  })
  it('rejects connect when the socket closes or errors before opening', async () => {
    const s = new MatchSocket()
    const p = s.connect('ws://x/matches/ABCD/ws', { t: 'hello' })
    FakeWs.last.close(1006)
    await expect(p).rejects.toThrow(/closed/)
    const s2 = new MatchSocket()
    const p2 = s2.connect('ws://x/matches/ABCD/ws', { t: 'hello' })
    FakeWs.last.fail()
    await expect(p2).rejects.toThrow(/closed/)
  })
  it('reports a close after open once, and close() silences further callbacks', async () => {
    const s = new MatchSocket()
    const codes: number[] = []
    s.onClose((c) => codes.push(c))
    const opened = s.connect('ws://x/matches/ABCD/ws', { t: 'hello' })
    FakeWs.last.open()
    await opened
    s.send({ t: 'start' })
    expect(FakeWs.last.sentMessages()).toEqual([{ t: 'hello' }, { t: 'start' }])
    const ws = FakeWs.last
    s.close()
    ws.close(1000)
    expect(codes).toEqual([])
  })
})
