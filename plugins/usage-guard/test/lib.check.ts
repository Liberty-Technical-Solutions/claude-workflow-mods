// Run:  node --test plugins/usage-guard/test/lib.check.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ugFormatIn, ugLabel, ugRing, ugSummarize, ugWorst } from '../hooks/lib.ts'

test('ugRing: five steps, clamped', () => {
  assert.equal(ugRing(0), '○')
  assert.equal(ugRing(25), '◔')
  assert.equal(ugRing(50), '◑')
  assert.equal(ugRing(75), '◕')
  assert.equal(ugRing(100), '●')
  assert.equal(ugRing(250), '●')
  assert.equal(ugRing(-3), '○')
})

test('ugFormatIn', () => {
  assert.equal(ugFormatIn(20_000), '<1m')
  assert.equal(ugFormatIn(12 * 60_000), '12m')
  assert.equal(ugFormatIn(72 * 60_000), '1h 12m')
  assert.equal(ugFormatIn(65 * 60_000), '1h 05m')
  assert.equal(ugFormatIn(26 * 3_600_000), '1d 2h')
  assert.equal(ugFormatIn(-500), '<1m')
})

test('ugSummarize: circles, rounded numbers, and the 5-hour reset time', () => {
  const now = Date.parse('2026-10-06T10:00:00Z')
  const limits = [
    { kind: 'five_hour', percentUsed: 62.4, resetsAt: '2026-10-06T11:12:00Z' },
    { kind: 'seven_day', percentUsed: 31, resetsAt: '2026-10-09T10:00:00Z' },
  ]
  assert.equal(ugSummarize(limits, now), '5h ◑ 62% (resets 1h 12m) · 7d ◔ 31%')
  assert.equal(ugSummarize([{ kind: 'five_hour', percentUsed: 90 }], now), '5h ● 90%') // no reset time known
  assert.equal(ugSummarize([{ kind: 'five_hour', percentUsed: 10, resetsAt: '2020-01-01T00:00:00Z' }], now), '5h ○ 10%') // reset in the past
  assert.equal(ugSummarize([], now), '')
})

test('ugWorst and ugLabel', () => {
  assert.equal(ugWorst([]), null)
  assert.equal(ugWorst([{ kind: 'a', percentUsed: 10 }, { kind: 'b', percentUsed: 90 }])?.kind, 'b')
  assert.equal(ugLabel('five_hour'), '5h')
  assert.equal(ugLabel('weird'), 'weird')
})
