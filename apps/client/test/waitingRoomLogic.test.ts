import { describe, expect, it } from 'vitest'
import { friendlyRuleMessage, humanTarget, inviteLink, maxBots, startPlan, tableSummary } from '../src/ui/waitingRoomLogic'

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

describe('startPlan (mirrors the object: the host starts whenever; bots take the empty seats)', () => {
  it('is hidden for everyone but the host, and until the table is known', () => {
    expect(startPlan({ isHost: false, seated: 3, targetPlayers: 4, botCount: 0 })).toEqual({ kind: 'hidden' })
    expect(startPlan({ isHost: true, seated: 1, targetPlayers: null, botCount: 0 })).toEqual({ kind: 'hidden' })
  })
  it('tells the host how many empty seats bots would take right now', () => {
    expect(startPlan({ isHost: true, seated: 2, targetPlayers: 4, botCount: 0 })).toEqual({ kind: 'ready', fill: 2 })
    expect(startPlan({ isHost: true, seated: 1, targetPlayers: 4, botCount: 2 })).toEqual({ kind: 'ready', fill: 3 })
    expect(startPlan({ isHost: true, seated: 5, targetPlayers: 8, botCount: 0 })).toEqual({ kind: 'ready', fill: 3 })
  })
})

describe('maxBots', () => {
  it('leaves a seat for everyone already here and one for the host', () => {
    expect(maxBots(4, 2)).toBe(2)
    expect(maxBots(4, 1)).toBe(3)
    expect(maxBots(3, 3)).toBe(0)
    expect(maxBots(8, 1)).toBe(7)
    expect(maxBots(4, 0)).toBe(3)
  })
})

describe('tableSummary', () => {
  it('reads as a sentence fragment for the non-host view', () => {
    expect(tableSummary(4, 1)).toBe('4 players, 1 bot')
    expect(tableSummary(3, 0)).toBe('3 players, no bots')
    expect(tableSummary(5, 2)).toBe('5 players, 2 bots')
  })
})

describe('friendlyRuleMessage', () => {
  it('capitalises the first letter and leaves the rest alone', () => {
    expect(friendlyRuleMessage('not a legal road edge')).toBe('Not a legal road edge')
    expect(friendlyRuleMessage('  building happens in the main phase')).toBe('Building happens in the main phase')
    expect(friendlyRuleMessage('')).toBe('')
  })
})
