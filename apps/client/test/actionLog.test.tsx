import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CatanEvent, CatanSnapshotPayload } from '@meridian/protocol'
import { affectsSeat, eventLine, type LineSegment } from '../src/ui/ActionLog'
import { ActionLogView } from '../src/ui/ActionLog'
import { useCatanStore } from '../src/scene/catan/catanStore'

function textOf(segs: LineSegment[]): string {
  return segs
    .map((s) => (s.t === 'text' ? s.text : s.t === 'res' ? `[${s.n ?? 1} ${s.r}]` : `@${s.seat}`))
    .join('')
}

describe('eventLine', () => {
  it('roll with gains and a robber-blocked resource', () => {
    const line = textOf(
      eventLine({ kind: 'roll', player: 1, dice: [2, 3], total: 5, gains: { 0: { wood: 2 } }, robbed: ['ore'] }),
    )
    expect(line).toContain('rolled 5')
    expect(line).toContain('@0 +[2 wood]')
    expect(line).toContain('robber blocked [1 ore]')
  })

  it('steal renders the resource when present, "a card" when redacted', () => {
    const known = textOf(eventLine({ kind: 'robber', player: 2, victim: 0, stolen: 'wheat' }))
    expect(known).toContain('stole [1 wheat] from @0')
    const redacted = textOf(eventLine({ kind: 'robber', player: 2, victim: 0 }))
    expect(redacted).toContain('stole a card from @0')
  })

  it('discard renders composition when known, count otherwise', () => {
    expect(textOf(eventLine({ kind: 'discard', player: 1, count: 4, resources: { wood: 2, ore: 2 } }))).toContain(
      'discarded [2 wood][2 ore]',
    )
    expect(textOf(eventLine({ kind: 'discard', player: 1, count: 4 }))).toContain('discarded 4 cards')
  })

  it('every event kind produces a non-empty line', () => {
    const samples: CatanEvent[] = [
      { kind: 'roll', player: 0, dice: [3, 4], total: 7, gains: {} },
      { kind: 'discard', player: 1, count: 4 },
      { kind: 'robber', player: 0, victim: null },
      { kind: 'monopoly', player: 0, resource: 'wheat', taken: { 1: 2 } },
      { kind: 'yearOfPlenty', player: 0, take: ['ore', 'ore'] },
      { kind: 'roadBuilding', player: 0, edges: 2 },
      { kind: 'knight', player: 0 },
      { kind: 'buyDev', player: 0 },
      { kind: 'build', player: 0, piece: 'city' },
      { kind: 'bankTrade', player: 0, give: 'wood', giveCount: 4, get: 'ore' },
      { kind: 'offer', player: 0, give: { wood: 1 }, get: { ore: 1 } },
      { kind: 'tradeResponse', player: 1, response: 'counter' },
      { kind: 'tradeSettled', player: 0, partner: 1, gave: { wood: 1 }, got: { ore: 1 } },
      { kind: 'offerCancelled', player: 0 },
      { kind: 'turnEnded', player: 0, turn: 3 },
      { kind: 'win', player: 2 },
    ]
    for (const e of samples) expect(eventLine(e).length, e.kind).toBeGreaterThan(0)
  })
})

describe('affectsSeat', () => {
  it('flags rolls that pay you, steals against you, monopoly hits, and your trades', () => {
    expect(affectsSeat({ kind: 'roll', player: 1, dice: [2, 3], total: 5, gains: { 0: { ore: 1 } } }, 0)).toBe(true)
    expect(affectsSeat({ kind: 'roll', player: 1, dice: [2, 3], total: 5, gains: {} }, 0)).toBe(false)
    expect(affectsSeat({ kind: 'robber', player: 2, victim: 0 }, 0)).toBe(true)
    expect(affectsSeat({ kind: 'monopoly', player: 1, resource: 'wheat', taken: { 0: 2 } }, 0)).toBe(true)
    expect(affectsSeat({ kind: 'tradeSettled', player: 1, partner: 0, gave: {}, got: {} }, 0)).toBe(true)
    expect(affectsSeat({ kind: 'buyDev', player: 1 }, 0)).toBe(false)
  })
})

describe('store eventLog', () => {
  beforeEach(() => useCatanStore.getState().reset())

  function snap(seq: number, events?: CatanEvent[]): CatanSnapshotPayload {
    const view = { seq, turn: { openTrade: null, phase: 'main', current: 0 }, winner: null } as never
    return { seq, view, ...(events ? { events } : {}) }
  }

  it('prepends newest-first, caps at 100, survives event-less snapshots, clears on reset', () => {
    const s = () => useCatanStore.getState()
    s().ingestSnapshot(snap(1, [{ kind: 'buyDev', player: 0 }]))
    s().ingestSnapshot(snap(2, [{ kind: 'knight', player: 1 }]))
    expect(s().eventLog.map((e) => e.kind)).toEqual(['knight', 'buyDev'])
    s().ingestSnapshot(snap(3)) // no events: log untouched
    expect(s().eventLog).toHaveLength(2)
    for (let i = 0; i < 120; i++) s().ingestSnapshot(snap(4 + i, [{ kind: 'turnEnded', player: 0, turn: i }]))
    expect(s().eventLog).toHaveLength(100)
    s().reset()
    expect(s().eventLog).toHaveLength(0)
  })
})

describe('ActionLog render', () => {
  beforeEach(() => useCatanStore.getState().reset())

  it('renders ticker entries with the affects-you highlight', () => {
    // props-injected view: zustand's SSR snapshot is the INITIAL state, so
    // store mutation can't drive a static render
    const html = renderToStaticMarkup(
      <ActionLogView
        seat={0}
        eventLog={[
          { kind: 'robber', player: 2, victim: 0, stolen: 'wheat' },
          { kind: 'buyDev', player: 1 },
        ]}
      />,
    )
    expect(html).toContain('data-testid="action-log-ticker"')
    const entries = html.split('data-testid="action-log-entry"').length - 1
    expect(entries).toBe(2)
    expect(html).toContain('affects-you')
    expect(html).toContain('You')
  })
})
