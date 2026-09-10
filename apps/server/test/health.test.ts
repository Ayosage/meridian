import { describe, expect, it } from 'vitest'
import { healthBody, versionFrom } from '../src/health'

describe('healthBody', () => {
  it('reports ok with a version, region and uptime', () => {
    const body = healthBody({ env: { GIT_SHA: 'abcdef1234567', FLY_REGION: 'ewr' }, uptimeSeconds: () => 12.6 })
    expect(body).toEqual({ ok: true, version: 'abcdef1', region: 'ewr', uptime: 13 })
  })

  it('falls back to the Fly image tag, then dev', () => {
    expect(versionFrom({ FLY_IMAGE_REF: 'registry.fly.io/meridian-server:deployment-01ABCDEFGHIJKLMNOP' })).toBe(
      'deployment-0',
    )
    expect(versionFrom({})).toBe('dev')
  })

  it('includes the room count only when a counter is supplied', () => {
    expect(healthBody({ env: {}, uptimeSeconds: () => 0, roomCount: () => 3 }).rooms).toBe(3)
    expect('rooms' in healthBody({ env: {}, uptimeSeconds: () => 0 })).toBe(false)
  })
})
