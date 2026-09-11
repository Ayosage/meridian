import { describe, expect, it } from 'vitest'
import { earlyStart, friendlyRuleMessage, humanTarget, inviteLink } from '../src/ui/waitingRoomLogic'

describe('inviteLink', () => {
  it('is the ?join= deep link App.tsx accepts', () => {
    expect(inviteLink('https://play.example', 'ABCD')).toBe('https://play.example/?join=ABCD')
  })
})

describe('humanTarget', () => {
  it('is the seats bots do not fill', () => {
    expect(humanTarget(4, 3)).toBe(1)
    expect(humanTarget(4, 0)).toBe(4)
    expect(humanTarget(null, 0)).toBe(0)
  })
})

describe('earlyStart (mirrors CatanRoom.handleStart)', () => {
  it('is hidden for everyone but the host', () => {
    expect(earlyStart({ isHost: false, seated: 3, targetPlayers: 4, botCount: 0 })).toEqual({ kind: 'hidden' })
  })
  it('is automatic when bots fill the room', () => {
    expect(earlyStart({ isHost: true, seated: 1, targetPlayers: 4, botCount: 3 })).toEqual({ kind: 'auto' })
  })
  it('is ready only at exactly target-1 humans, at least 3', () => {
    expect(earlyStart({ isHost: true, seated: 3, targetPlayers: 4, botCount: 0 })).toEqual({ kind: 'ready' })
    expect(earlyStart({ isHost: true, seated: 2, targetPlayers: 3, botCount: 0 })).toEqual({ kind: 'needs', players: 2 })
  })
  it('tells the host how many players the rule needs', () => {
    expect(earlyStart({ isHost: true, seated: 1, targetPlayers: 4, botCount: 0 })).toEqual({ kind: 'needs', players: 3 })
    expect(earlyStart({ isHost: true, seated: 5, targetPlayers: 8, botCount: 0 })).toEqual({ kind: 'needs', players: 7 })
  })
})

describe('friendlyRuleMessage', () => {
  it('capitalises the first letter and leaves the rest alone', () => {
    expect(friendlyRuleMessage('not a legal road edge')).toBe('Not a legal road edge')
    expect(friendlyRuleMessage('  building happens in the main phase')).toBe('Building happens in the main phase')
    expect(friendlyRuleMessage('')).toBe('')
  })
})
