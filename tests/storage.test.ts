import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULTS, migrateSettings, withDefaults, type Settings } from '../src/lib/storage.ts'

describe('withDefaults', () => {
  it('fills in what a stored value has never heard of', () => {
    const stored = { token: 'ghp_x', pollIntervalMs: 0 }
    const merged = withDefaults(DEFAULTS.settings, stored)

    assert.equal(merged.token, 'ghp_x')
    assert.equal(merged.pollIntervalMs, 0)
    assert.equal(merged.openIn, DEFAULTS.settings.openIn)
  })

  it('reaches into nested settings, so a new switch is not born off', () => {
    // Exactly what an upgrade leaves behind: a features blob written before a
    // feature existed. A shallow merge would take the whole object as final.
    const stored = { features: { changes: false } }
    const merged = withDefaults(DEFAULTS.settings, stored) as Settings

    assert.equal(merged.features.changes, false)
    assert.equal(merged.features.keyboard, true)
    assert.equal(merged.notifications.enabled, false)
    assert.equal(merged.notifications.sounds.reminder, 'chime')
  })

  it('leaves records whose keys are data alone', () => {
    const memory = { PR_1: { seen: {}, seenAt: 5 } }
    assert.deepEqual(withDefaults(DEFAULTS.itemMemory, memory), memory)
  })
})

describe('migrateSettings', () => {
  it('carries notifications forward into the section they now live in', () => {
    // Written before everything about being interrupted was gathered in one
    // place. Losing this quietly would switch off the one setting that took a
    // permission to turn on — and whose whole job is to speak up.
    const old = {
      features: { changes: true, notifications: true, sound: false, badge: true },
      sounds: { reminder: 'bell', change: 'knock', volume: 0.4 },
    }

    const merged = withDefaults(DEFAULTS.settings, migrateSettings(old)) as Settings

    assert.equal(merged.notifications.enabled, true)
    // Sound was switched off, and silence is now one of the sounds rather than
    // a switch beside them — so both kinds arrive silent rather than chiming
    // at someone who had asked for quiet.
    assert.equal(merged.notifications.sounds.reminder, 'none')
    assert.equal(merged.notifications.sounds.change, 'none')
    assert.equal(merged.notifications.sounds.volume, 0.4)
    // The kinds are new, so they arrive at their defaults rather than off.
    assert.equal(merged.notifications.reminders, true)
    assert.equal(merged.notifications.changes, true)
  })

  it('leaves anything already written in the new shape alone', () => {
    const both = {
      features: { notifications: true },
      notifications: { enabled: false, sounds: { reminder: 'knock', change: 'ping', volume: 1 } },
    }

    const merged = withDefaults(DEFAULTS.settings, migrateSettings(both)) as Settings
    assert.equal(merged.notifications.enabled, false)
    assert.equal(merged.notifications.sounds.reminder, 'knock')
  })

  it('carries a sound switched off in the shape between the two', () => {
    // The build that had notifications gathered but sound still a switch.
    const between = {
      notifications: { enabled: true, sound: false, sounds: { reminder: 'bell', change: 'bell', volume: 0.5 } },
    }

    const merged = withDefaults(DEFAULTS.settings, migrateSettings(between)) as Settings
    assert.equal(merged.notifications.enabled, true)
    assert.equal(merged.notifications.sounds.reminder, 'none')
    assert.equal(merged.notifications.sounds.volume, 0.5)
  })

  it('does nothing at all to settings that never had the old shape', () => {
    const current = { features: { changes: false } }
    assert.deepEqual(migrateSettings(current), current)
  })
})
