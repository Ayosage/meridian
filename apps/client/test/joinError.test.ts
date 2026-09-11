import { describe, expect, it } from 'vitest'
import { DEAD_LINK_MESSAGE, describeJoinError } from '../src/net/catan'

describe('describeJoinError', () => {
  it('names a bad code when the matchmaker cannot find the room', () => {
    expect(describeJoinError({ code: 4212, message: 'room "ZZZZ" not found' })).toMatch(/No match with that code/)
    expect(describeJoinError(new Error('invalid room id'))).toMatch(/No match with that code/)
  })
  it('blames the connection for anything else', () => {
    expect(describeJoinError(new Error('WebSocket closed'))).toMatch(/Could not reach the game server/)
    expect(describeJoinError(undefined)).toMatch(/Could not reach the game server/)
  })
  it('keeps the dead-link message a plain sentence', () => {
    expect(DEAD_LINK_MESSAGE).not.toMatch(/—/)
  })
})
