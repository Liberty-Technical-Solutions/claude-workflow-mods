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
  assert.deepEqual(ctxView({ ...base, ctxPercent: 62 }), { text: '62%', tone: 'normal', needs: false })
  assert.deepEqual(ctxView({ ...base, ctxPercent: 70 }), { text: '70%', tone: 'warning', needs: true })
  assert.equal(ctxView({ ...base, ctxPercent: null }).text, '—')
})

test('cacheView: cold, healthy, warning, expired', () => {
  const p = { ttlMin: 60, warnMin: 10 }
  const min = 60_000
  const mk = (ago: number | null) => ({ lastApiAt: ago === null ? null : 1_000_000, ctxPercent: null, ctxTokens: null, ctxWindow: null, now: 1_000_000 + (ago ?? 0) * min })
  assert.deepEqual(cacheView(mk(null), p), { text: 'cold', tone: 'dim', needs: false, isExpired: false, isCold: true })
  assert.deepEqual(cacheView(mk(13), p), { text: '47m left', tone: 'normal', needs: false, isExpired: false, isCold: false })
  assert.deepEqual(cacheView(mk(50), p), { text: '10m left', tone: 'warning', needs: true, isExpired: false, isCold: false })
  assert.deepEqual(cacheView(mk(61), p), { text: 'expired', tone: 'error', needs: true, isExpired: true, isCold: true })
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
