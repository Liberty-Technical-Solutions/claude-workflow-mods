// Run:  node --test plugins/status-strip/test/lib.check.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cacheView, ctxView, deployKind, deployView, docsMissing, docsView, fmtClock, fmtElapsed, fmtK, fmtLeft, parseStatus, repoView } from '../hooks/lib.ts'

test('parseStatus: branch, dirty, ahead, behind', () => {
  assert.deepEqual(parseStatus('## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n M c.ts'), { isRepo: true, branch: 'main', dirty: 3, ahead: 2, behind: 1 })
  assert.deepEqual(parseStatus('## main'), { isRepo: true, branch: 'main', dirty: 0, ahead: 0, behind: 0 })
  assert.deepEqual(parseStatus('## feature/x...origin/feature/x'), { isRepo: true, branch: 'feature/x', dirty: 0, ahead: 0, behind: 0 })
  assert.equal(parseStatus('## No commits yet on main').branch, 'main')
  assert.equal(parseStatus(null).isRepo, false)
})

test('repoView', () => {
  assert.deepEqual(repoView({ isRepo: true, branch: 'main', dirty: 3, ahead: 2, behind: 0 }), { text: 'main ±3 ↑2', tone: 'normal', needs: false })
  assert.deepEqual(repoView({ isRepo: true, branch: 'main', dirty: 0, ahead: 0, behind: 1 }), { text: 'main ✓ ↓1', tone: 'warning', needs: true })
  assert.equal(repoView({ isRepo: false, branch: '', dirty: 0, ahead: 0, behind: 0 }).tone, 'dim')
})

test('docsView', () => {
  assert.equal(docsView(null).text, '—')
  assert.deepEqual(docsView({ files: 3, stat: '', missing: [] }), { text: 'current', tone: 'normal', needs: false })
  assert.deepEqual(docsView({ files: 3, stat: '', missing: ['a', 'b'] }), { text: '2 stale', tone: 'warning', needs: true })
})

test('ctxView and the 70% compress threshold', () => {
  const base = { lastApiAt: null, ctxTokens: null, ctxWindow: null, now: 0 }
  assert.deepEqual(ctxView({ ...base, ctxPercent: 62 }), { text: '62%', tone: 'normal', needs: false, ring: '◑' })
  assert.deepEqual(ctxView({ ...base, ctxPercent: 70 }), { text: '70%', tone: 'warning', needs: true, ring: '◕' })
  assert.equal(ctxView({ ...base, ctxPercent: null }).text, '—')
})

test('cacheView: cold, healthy, warning, expired', () => {
  const p = { ttlMin: 60, warnMin: 10 }
  const min = 60_000
  const mk = (ago: number | null) => ({ lastApiAt: ago === null ? null : 1_000_000, ctxPercent: null, ctxTokens: null, ctxWindow: null, now: 1_000_000 + (ago ?? 0) * min })
  assert.deepEqual(cacheView(mk(null), p), { text: 'cold', tone: 'dim', needs: false, isExpired: false, isCold: true, ring: '○' })
  assert.deepEqual(cacheView(mk(13), p), { text: '47m left', tone: 'normal', needs: false, isExpired: false, isCold: false, ring: '◕' }) // 78% of the lifetime left
  assert.deepEqual(cacheView(mk(50), p), { text: '10m left', tone: 'warning', needs: true, isExpired: false, isCold: false, ring: '◔' })
  assert.deepEqual(cacheView(mk(61), p), { text: 'expired', tone: 'error', needs: true, isExpired: true, isCold: true, ring: '○' })
  assert.equal(cacheView(mk(3), { ttlMin: 5, warnMin: 5 }).text, '2m left')
  assert.equal(cacheView(mk(3), { ttlMin: 5, warnMin: 5 }).needs, true)
})

test('deployView: shows how long it has been going, and how long it took', () => {
  const MIN = 60_000
  const d = { ci: 'running', note: '', ciName: '', healthUrl: null, live: null, expected: null, isDone: false, kind: 'deploy', startedAt: 1_000_000, endedAt: null }
  const at = (m: number) => 1_000_000 + m * MIN
  assert.equal(deployView(null, at(0)), null)
  assert.equal(deployView(d, at(0))?.text, 'CI running · <1m')
  assert.equal(deployView(d, at(7))?.text, 'CI running · 7m')
  assert.equal(deployView({ ...d, ci: 'waiting' }, at(2))?.text, 'CI queued · 2m')
  assert.equal(deployView({ ...d, ci: 'failed', endedAt: at(3) }, at(30))?.text, 'CI failed · after 3m')
  assert.equal(deployView({ ...d, ci: 'failed', endedAt: at(3) }, at(30))?.tone, 'error')
  assert.equal(deployView({ ...d, ci: 'passed', endedAt: at(4) }, at(30))?.text, 'CI passed · 4m')
  assert.equal(deployView({ ...d, ci: 'passed', healthUrl: 'u', live: '3.22', expected: '3.22', endedAt: at(5) }, at(30))?.text, '✔ v3.22 live · 5m')
  assert.equal(deployView({ ...d, ci: 'passed', healthUrl: 'u', live: '3.21', expected: '3.22', isDone: true, endedAt: at(5) }, at(30))?.needs, true)
})

test('fmtElapsed, fmtClock and deployKind', () => {
  assert.equal(fmtElapsed(0), '<1m')
  assert.equal(fmtElapsed(59_000), '<1m')
  assert.equal(fmtElapsed(61_000), '1m')
  assert.equal(fmtElapsed(59 * 60_000), '59m')
  assert.equal(fmtElapsed(65 * 60_000), '1h 05m')
  assert.equal(fmtElapsed(-5), '<1m')
  assert.match(fmtClock(Date.now()), /^\d\d:\d\d$/)
  assert.equal(fmtClock(new Date(2026, 9, 6, 9, 5).getTime()), '09:05')
  assert.equal(deployKind('gh pr merge 42 --squash'), 'merge')
  assert.equal(deployKind('git push origin main'), 'push')
  assert.equal(deployKind('npm run deploy'), 'deploy')
})

test('docsMissing', () => {
  const base = { docOnly: /\.(md|txt|mdx)$/i, changelogs: ['CHANGELOG.md'], hasVersionField: true, handoffs: ['HANDOFF.md'] }
  assert.equal(docsMissing({ ...base, changed: ['README.md'] }), null)
  assert.deepEqual(docsMissing({ ...base, changed: ['src/a.ts'] }), ['CHANGELOG not updated', 'version not bumped', 'HANDOFF.md not updated'])
  assert.deepEqual(docsMissing({ ...base, changed: ['src/a.ts', 'CHANGELOG.md', 'package.json', 'docs/HANDOFF.md'] }), [])
})

test('formatters', () => {
  assert.equal(fmtLeft(47 * 60_000), '47m')
  assert.equal(fmtLeft(30_000), '30s')
  assert.equal(fmtK(156000), '156k')
  assert.equal(fmtK(null), '?')
})

test('ringGlyph: five steps, clamped', async () => {
  const { ringGlyph } = await import('../hooks/lib.ts')
  assert.equal(ringGlyph(null), '○')
  assert.equal(ringGlyph(0), '○')
  assert.equal(ringGlyph(12), '○')
  assert.equal(ringGlyph(25), '◔')
  assert.equal(ringGlyph(50), '◑')
  assert.equal(ringGlyph(62), '◑')
  assert.equal(ringGlyph(75), '◕')
  assert.equal(ringGlyph(88), '●')
  assert.equal(ringGlyph(140), '●')
  assert.equal(ringGlyph(-5), '○')
})

test('parseProfile: cells and show mode; junk is ignored', async () => {
  const { parseProfile, showCell } = await import('../hooks/lib.ts')
  assert.deepEqual(parseProfile(null), { cells: null, show: null })
  assert.deepEqual(parseProfile('not json'), { cells: null, show: null })
  assert.deepEqual(parseProfile('{"cells":["context","repo","nope"],"show":"always"}'), { cells: ['repo', 'context'], show: 'always' })
  assert.deepEqual(parseProfile('{"cells":[],"show":"weird"}'), { cells: null, show: null })
  const p = parseProfile('{"cells":["repo","cache"]}')
  assert.equal(showCell(p, 'repo'), true)
  assert.equal(showCell(p, 'docs'), false)
  assert.equal(showCell({ cells: null, show: null }, 'docs'), true)
})

test('isShipRequest, stepForCommand, stepForEdit', async () => {
  const { isShipRequest, stepForCommand, stepForEdit } = await import('../hooks/lib.ts')
  assert.equal(isShipRequest('deploy it'), true)
  assert.equal(isShipRequest('Ship it!'), true)
  assert.equal(isShipRequest('merge it'), true)
  assert.equal(isShipRequest('include the fix and deploy it'), true)
  assert.equal(isShipRequest('please explain how to deploy'), false)
  assert.equal(stepForCommand('pnpm test', -1), 0)
  assert.equal(stepForCommand('claude plugin test plugins/x', -1), 0)
  assert.equal(stepForCommand('git commit -m x', 0), 2)
  assert.equal(stepForCommand('gh pr create --fill', 1), 2)
  assert.equal(stepForCommand('gh pr merge 5 --squash', 2), 3)
  assert.equal(stepForCommand('git push origin main', 1), 2) // before the merge a push is part of the PR step
  assert.equal(stepForCommand('git push origin main', 3), 4) // after the merge it is the deploy
  assert.equal(stepForCommand('npm run deploy', 3), 4)
  assert.equal(stepForCommand('ls -la', 2), null)
  assert.equal(stepForEdit('/repo/CHANGELOG.md'), 1)
  assert.equal(stepForEdit('C:\\repo\\package.json'), 1)
  assert.equal(stepForEdit('/repo/src/a.ts'), null)
})

test('ship stepper: moves forward only, times each step, skips are shown, finishes', async () => {
  const { newShip, advanceShip, finishShip, shipView } = await import('../hooks/lib.ts')
  const M = 60_000
  let s = newShip(0)
  assert.equal(shipView(s, 0).head, 'shipping · <1m')
  s = advanceShip(s, 0, 0)
  s = advanceShip(s, 2, 2 * M) // version step never happened
  s = advanceShip(s, 1, 3 * M) // going backwards is ignored
  assert.equal(s.current, 2)
  s = advanceShip(s, 3, 3 * M)
  const mid = shipView(s, 5 * M)
  assert.equal(mid.head, 'shipping · 5m')
  assert.deepEqual(mid.steps.map(x => x.mark), ['✔', '–', '✔', '▶', '·', '·'])
  assert.equal(mid.steps[0].text, 'tests 2m')
  assert.equal(mid.steps[1].text, 'version skipped')
  assert.equal(mid.steps[3].text, 'merge 2m')
  s = advanceShip(s, 4, 5 * M)
  s = finishShip(s, 9 * M, false)
  const done = shipView(s, 99 * M)
  assert.equal(done.head, 'shipped in 9m')
  assert.equal(done.tone, 'success')
  assert.deepEqual(done.steps.map(x => x.mark), ['✔', '–', '✔', '✔', '✔', '✔'])
  assert.equal(advanceShip(s, 5, 10 * M), s) // finished: nothing moves
})

test('ship stepper: a failure stops it and says so', async () => {
  const { newShip, advanceShip, finishShip, shipView } = await import('../hooks/lib.ts')
  const M = 60_000
  let s = advanceShip(advanceShip(newShip(0), 3, M), 4, 2 * M)
  s = finishShip(s, 4 * M, true)
  const v = shipView(s, 50 * M)
  assert.equal(v.head, 'ship stopped after 4m')
  assert.equal(v.tone, 'error')
  assert.equal(v.steps[4].mark, '✘') // the step it died on is marked failed
  assert.equal(v.steps[4].text, 'deploy failed after 2m')
  assert.equal(v.steps[5].mark, '·')
})

test('shouldWarnCache: once per cache fill, only inside the warning window', async () => {
  const { shouldWarnCache } = await import('../hooks/lib.ts')
  const warn = 10 * 60_000
  assert.equal(shouldWarnCache(30 * 60_000, warn, null, 1), false)
  assert.equal(shouldWarnCache(9 * 60_000, warn, null, 1), true)
  assert.equal(shouldWarnCache(9 * 60_000, warn, 1, 1), false) // already told for this fill
  assert.equal(shouldWarnCache(9 * 60_000, warn, 1, 2), true) // a new fill, new warning
  assert.equal(shouldWarnCache(0, warn, null, 1), false) // expired is the cell's job, not a heads-up
  assert.equal(shouldWarnCache(null, warn, null, null), false)
})
