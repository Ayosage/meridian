import { describe, expect, it } from 'vitest'
import { DEAD_LINK_MESSAGE, describeInviteError, describeJoinError } from '../src/net/catan'

describe('describeJoinError', () => {
  it('names a bad code when the matchmaker cannot find the room', () => {
    expect(describeJoinError({ code: 4212, message: 'room "ZZZZ" not found' })).toMatch(/No match with that code/)
    expect(describeJoinError(new Error('invalid room id'))).toMatch(/No match with that code/)
  })
  it('blames the connection for anything else', () => {
    expect(describeJoinError(new Error('WebSocket closed'))).toMatch(/Could not reach the game server/)
    expect(describeJoinError(undefined)).toMatch(/Could not reach the game server/)
  })
  it('names a full or already started match', () => {
    expect(describeJoinError(Object.assign(new Error('match is full'), { code: 'FULL' }))).toMatch(/full/i)
    expect(describeJoinError(Object.assign(new Error('match already started'), { code: 'NOT_WAITING' }))).toMatch(/already started/i)
  })
  it('keeps the dead-link message a plain sentence', () => {
    expect(DEAD_LINK_MESSAGE).not.toMatch(/—/)
  })
})

describe('describeInviteError', () => {
  it('calls an unknown code a dead link, since nobody typed it', () => {
    expect(describeInviteError(Object.assign(new Error('no such match (404)'), { code: 'NOT_FOUND' }))).toBe(
      DEAD_LINK_MESSAGE,
    )
    expect(describeInviteError({ code: 4212, message: 'room "ZZZZ" not found' })).toBe(DEAD_LINK_MESSAGE)
  })
  it('keeps the real reason for every other refusal', () => {
    expect(describeInviteError(Object.assign(new Error('match is full'), { code: 'FULL' }))).toMatch(/full/i)
    expect(describeInviteError(Object.assign(new Error('started'), { code: 'NOT_WAITING' }))).toMatch(/already started/i)
    expect(describeInviteError(new Error('lobby lookup failed (500)'))).toMatch(/Could not reach the game server/)
  })
})
