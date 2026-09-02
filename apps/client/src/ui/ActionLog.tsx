import { memo, useState } from 'react'
import type { CatanEvent } from '@meridian/protocol'
import { RESOURCES, type Resource } from '@meridian/rules'
import { seatColor } from '../scene/catan/palette'
import { useCatanStore, type EventLogEntry } from '../scene/catan/catanStore'
import { ResourceIcon } from './ResourceIcon'
import './hud.css'

/** One renderable piece of a log line: plain text, a resource icon, or a player name chip. */
export type LineSegment =
  | { t: 'text'; text: string }
  | { t: 'res'; r: Resource; n?: number }
  | { t: 'seat'; seat: number }

function res(r: Resource, n?: number): LineSegment {
  return { t: 'res', r, ...(n !== undefined && n !== 1 ? { n } : {}) }
}
function seatSeg(seat: number): LineSegment {
  return { t: 'seat', seat }
}
function text(s: string): LineSegment {
  return { t: 'text', text: s }
}

function mapSegs(map: Partial<Record<Resource, number>>): LineSegment[] {
  const out: LineSegment[] = []
  for (const r of RESOURCES) {
    const n = map[r]
    if (n) out.push(res(r, n))
  }
  return out
}

/**
 * Event -> line segments. Pure — unit-tested directly. Events arrive
 * pre-redacted, so a missing secret field (steal's resource, a discard's
 * composition) means this seat may not know it; "You" labeling is the
 * renderer's concern, not the line builder's.
 */
export function eventLine(event: CatanEvent): LineSegment[] {
  switch (event.kind) {
    case 'roll': {
      const segs: LineSegment[] = [seatSeg(event.player), text(` rolled ${event.total}`)]
      const gainEntries = Object.entries(event.gains)
      // A bank-shortage wipe explains the silence better than "no production"
      if (gainEntries.length === 0 && !event.denied?.length) segs.push(text(' — no production'))
      for (const [s, gain] of gainEntries) {
        segs.push(text(' · '), seatSeg(Number(s)), text(' +'), ...mapSegs(gain))
      }
      if (event.denied?.length) {
        segs.push(text(' — '), ...event.denied.map((r) => res(r)), text(' exhausted — nobody paid'))
      }
      if (event.robbed?.length) {
        segs.push(text(' · robber blocked '), ...event.robbed.map((r) => res(r)))
      }
      return segs
    }
    case 'discard':
      return event.resources
        ? [seatSeg(event.player), text(' discarded '), ...mapSegs(event.resources)]
        : [seatSeg(event.player), text(` discarded ${event.count} cards`)]
    case 'robber': {
      const segs: LineSegment[] = [seatSeg(event.player), text(' moved the robber')]
      if (event.victim !== null) {
        segs.push(text(' — stole '))
        segs.push(event.stolen ? res(event.stolen) : text('a card'))
        segs.push(text(' from '), seatSeg(event.victim))
      }
      return segs
    }
    case 'monopoly': {
      const segs: LineSegment[] = [seatSeg(event.player), text(' played Monopoly on '), res(event.resource)]
      for (const [s, n] of Object.entries(event.taken)) {
        segs.push(text(' · '), seatSeg(Number(s)), text(` −${n}`))
      }
      return segs
    }
    case 'yearOfPlenty':
      return [seatSeg(event.player), text(' took '), res(event.take[0]), res(event.take[1]), text(' (Year of Plenty)')]
    case 'roadBuilding':
      return [seatSeg(event.player), text(` played Road Building (${event.edges} roads)`)]
    case 'knight':
      return [seatSeg(event.player), text(' played a Knight')]
    case 'buyDev':
      return [seatSeg(event.player), text(' bought a development card')]
    case 'build':
      return [seatSeg(event.player), text(` built a ${event.piece}`)]
    case 'bankTrade':
      return [seatSeg(event.player), text(' bank-traded '), res(event.give, event.giveCount), text(' → '), res(event.get)]
    case 'offer':
      return [seatSeg(event.player), text(' offered '), ...mapSegs(event.give), text(' for '), ...mapSegs(event.get)]
    case 'tradeResponse':
      return [
        seatSeg(event.player),
        text(
          event.response === 'accept' ? ' accepted the offer' : event.response === 'reject' ? ' declined the offer' : ' countered the offer',
        ),
      ]
    case 'tradeSettled':
      return [
        seatSeg(event.player),
        text(' traded '),
        ...mapSegs(event.gave),
        text(' for '),
        ...mapSegs(event.got),
        text(' with '),
        seatSeg(event.partner),
      ]
    case 'offerCancelled':
      return [seatSeg(event.player), text(' withdrew the offer')]
    case 'turnEnded':
      return [seatSeg(event.player), text(` ended turn ${event.turn}`)]
    case 'win':
      return [seatSeg(event.player), text(' wins the game')]
  }
}

/** Does this event touch `seat`'s resources or seat directly? Drives the highlight. */
export function affectsSeat(event: CatanEvent, seat: number | null): boolean {
  if (seat === null) return false
  switch (event.kind) {
    case 'roll':
      return event.gains[seat] !== undefined || (event.player === seat && !!event.robbed?.length)
    case 'discard':
      return event.player === seat
    case 'robber':
      return event.victim === seat || event.player === seat
    case 'monopoly':
      return event.player === seat || event.taken[seat] !== undefined
    case 'tradeSettled':
      return event.player === seat || event.partner === seat
    case 'yearOfPlenty':
    case 'bankTrade':
      return event.player === seat
    default:
      return false
  }
}

/**
 * Memoized: an entry's `event` object never changes once logged, so the
 * open history panel (up to 100 lines) doesn't re-render on every snapshot.
 */
const Line = memo(function Line({
  event,
  seat,
  seatNames,
}: {
  event: CatanEvent
  seat: number | null
  seatNames: readonly string[]
}) {
  return (
    <div
      className={affectsSeat(event, seat) ? 'action-log-entry affects-you' : 'action-log-entry'}
      data-testid="action-log-entry"
    >
      {eventLine(event).map((seg, i) => {
        if (seg.t === 'text') return <span key={i}>{seg.text}</span>
        if (seg.t === 'res')
          return (
            <span className="log-res" key={i}>
              {seg.n !== undefined && `${seg.n} `}
              <ResourceIcon r={seg.r} />
            </span>
          )
        return (
          <span className="log-seat" key={i} style={{ color: seatColor(seg.seat) }}>
            {seg.seat === seat ? 'You' : seatNames[seg.seat] || `P${seg.seat + 1}`}
          </span>
        )
      })}
    </div>
  )
})

const TICKER_LINES = 4

/**
 * Always-visible action ticker anchored under the player cards (Task 15
 * design): the latest few events, newest on top; the header toggles a
 * scrollable full-history panel. Events come pre-redacted from the server.
 * Presentational half is exported separately: zustand's SSR snapshot is the
 * INITIAL state, so render tests must inject props rather than mutate the store.
 */
export function ActionLog() {
  const eventLog = useCatanStore((s) => s.eventLog)
  const seat = useCatanStore((s) => s.seat)
  const seatNames = useCatanStore((s) => s.seatNames)
  return <ActionLogView eventLog={eventLog} seat={seat} seatNames={seatNames} />
}

export function ActionLogView({
  eventLog,
  seat,
  seatNames = [],
}: {
  eventLog: readonly EventLogEntry[]
  seat: number | null
  seatNames?: readonly string[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="action-log" data-testid="action-log-ticker">
      <button type="button" className="action-log-header" data-testid="action-log-toggle" onClick={() => setOpen((o) => !o)}>
        Log {open ? '▾' : '▸'}
      </button>
      {!open && eventLog.slice(0, TICKER_LINES).map((e) => <Line event={e.event} seat={seat} seatNames={seatNames} key={e.id} />)}
      {open && (
        <div className="action-log-panel" data-testid="action-log-panel">
          {eventLog.map((e) => (
            <Line event={e.event} seat={seat} seatNames={seatNames} key={e.id} />
          ))}
        </div>
      )}
    </div>
  )
}
