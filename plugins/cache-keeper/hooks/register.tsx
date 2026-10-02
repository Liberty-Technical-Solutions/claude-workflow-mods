import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheState } from '../types'

const ckInitial: CacheState = {
  lastApiAt: null,
  readTokens: 0,
  createdTokens: 0,
  ctxPercent: null,
  ctxTokens: null,
  ctxWindow: null,
  ttlMin: 60,
  isAuto: false,
  halted: null,
  allowSibling: false,
  lastActiveAt: null,
  resumedAt: null,
  armedAt: null,
  msg: '',
  now: 0,
  isHidden: false,
}
const ckCache = atom({ plugin: 'cache-keeper', key: 'cache' } as const, ckInitial)

const ckTickMs = 30_000
const ckAutoWithinMs = 5 * 60_000 // auto keep-alive fires when this little is left
const ckIdleCapMs = 8 * 3_600_000 // stop keeping the cache alive after this long without a finished turn
const ckCompressAt = 70 // percent of context window
const ckCompressColdAt = 40 // lower bar when the cache is already cold: a rewrite is coming anyway
const ckConfirmMs = 10_000
const ckHbPrefix = 'cache-keeper.hb.' // one store key per live session: { cwd, startedAt, seenAt }
const ckHbFreshMs = 2 * 60_000 // a session counts as alive if it checked in this recently
const ckHbStaleMs = 24 * 3_600_000 // dead heartbeats older than this are swept

const ckCloseOutPrompt =
  "I'm stepping away and this session will be left idle. Close it out: summarize what was done, what is unfinished, and the exact next steps. Save that to this project's handoff or session note (HANDOFF.md or its equivalent) if one exists, otherwise just show it here. Do not commit, push or deploy anything."

let ckIsBusy = false
let ckSessionId = ''
let ckSessionCwd = ''
let ckStartedAt = 0

const ckFmtLeft = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return m >= 1 ? `${m}m` : `${Math.max(0, Math.floor(ms / 1000))}s`
}
const ckFmtK = (n: number | null) => (n === null ? '?' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const ckNormCwd = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

async function ckPatch($: EngineInterface, p: Partial<CacheState>) {
  await update($, ckCache, c => ({ ...c, ...p }))
}

// Reads context fill and stamps the clock; the redraw follows from the state write.
async function ckSample($: EngineInterface) {
  const now = await $.clock.now()
  const { context } = await $.session.usage()
  await ckPatch($, {
    now,
    ctxPercent: context.percent ?? null,
    ctxTokens: context.tokens ?? null,
    ctxWindow: context.window,
  })
}

// One tiny tool-less question over the session's own transcript: the cached prefix is read,
// which resets its time-to-live. Adds nothing to the conversation.
async function ckRefreshCache($: EngineInterface) {
  await ckPatch($, { msg: 'refreshing cache…' })
  const r = await $.model.fork({ prompt: 'Reply with the single word: ok' })
  const now = await $.clock.now()
  if (r.isAnswered) {
    const rewritten = r.usage.cache_creation_input_tokens
    await ckPatch($, {
      lastApiAt: now,
      now,
      msg:
        rewritten > 1000
          ? `cache had lapsed: ${ckFmtK(rewritten)} tokens rewritten at full price`
          : `cache refreshed: ${ckFmtK(r.usage.cache_read_input_tokens)} tokens read from cache`,
    })
  } else {
    await ckPatch($, { msg: `refresh failed: ${r.reason}` })
  }
  await ckSample($)
}

async function ckCompress($: EngineInterface) {
  await ckPatch($, { armedAt: null, msg: 'compressing…' })
  const r = await $.session.compact()
  await ckPatch($, {
    lastApiAt: null, // the new, shorter prefix is cold until your next message
    msg: 'skip' in r ? `compress skipped: ${r.skip}` : 'compressed; cache is cold until your next message',
  })
  await ckSample($)
}

// Asks Claude for a handoff note and parks Auto so the cache is allowed to lapse.
async function ckCloseOut($: EngineInterface) {
  await ckPatch($, { halted: 'idle', msg: 'close-out requested; Auto stays paused. Archive this session from the sidebar when it finishes.' })
  void $.prompt.submit({ text: ckCloseOutPrompt })
}

async function ckHeartbeat($: EngineInterface, id: string, cwd: string, startedAt: number, now: number) {
  await $.store.set(ckHbPrefix + id, { cwd: ckNormCwd(cwd), startedAt, seenAt: now })
}

// True when a session that started AFTER this one is alive in the same folder.
async function ckHasNewerSibling($: EngineInterface, id: string, cwd: string, startedAt: number, now: number) {
  const mine = ckHbPrefix + id
  const here = ckNormCwd(cwd)
  let found = false
  for (const key of await $.store.keys()) {
    if (!key.startsWith(ckHbPrefix) || key === mine) continue
    const hb = (await $.store.get(key)) as { cwd?: string; startedAt?: number; seenAt?: number } | undefined
    if (!hb || typeof hb.seenAt !== 'number') continue
    if (now - hb.seenAt > ckHbStaleMs) {
      await $.store.delete(key)
      continue
    }
    if (hb.cwd === here && now - hb.seenAt < ckHbFreshMs && (hb.startedAt ?? 0) > startedAt) found = true
  }
  return found
}

// The 30-second beat: read the gauges, check in, decide whether Auto should pause, refresh if due.
async function ckTick($: EngineInterface, id: string, cwd: string, startedAt: number, isBusy: boolean) {
  await ckSample($)
  const now = await $.clock.now()
  await ckHeartbeat($, id, cwd, startedAt, now)

  const c = await read($, ckCache)
  if (!c.isAuto) return

  let halted = c.halted
  if (halted === null) {
    const idleSince = Math.max(c.lastActiveAt ?? startedAt, c.resumedAt ?? 0)
    if (now - idleSince > ckIdleCapMs) {
      halted = 'idle'
      await ckPatch($, { halted, msg: 'Auto paused: no activity for 8h. Send a message, Resume, or Close out.' })
      $.ui.toast('cache-keeper: Auto paused after 8h idle')
    } else if (!c.allowSibling && (await ckHasNewerSibling($, id, cwd, startedAt, now))) {
      halted = 'sibling'
      await ckPatch($, { halted, msg: 'Auto paused: a newer session is open in this folder.' })
      $.ui.toast('cache-keeper: Auto paused, newer session in this folder')
    }
  }

  if (halted === null && !isBusy && c.lastApiAt !== null) {
    const left = c.ttlMin * 60_000 - (c.now - c.lastApiAt)
    if (left > 0 && left < ckAutoWithinMs) await ckRefreshCache($)
  }
}

async function ckSessionStart($: any, e: any, next: any) {
  const ttl = await $.store.get('cache-keeper.ttlMin')
  const auto = await $.store.get('cache-keeper.isAuto')
  ckSessionId = await $.session.id()
  ckSessionCwd = e.cwd
  ckStartedAt = await $.clock.now()
  await ckPatch($, {
    ttlMin: ttl === 5 ? 5 : 60,
    isAuto: auto === true,
    now: ckStartedAt,
    lastActiveAt: ckStartedAt,
  })
  await ckHeartbeat($, ckSessionId, ckSessionCwd, ckStartedAt, ckStartedAt).catch(() => {})
  await ckSample($).catch(() => {})

  $.clock.every(ckTickMs, () => {
    void ckTick($, ckSessionId, ckSessionCwd, ckStartedAt, ckIsBusy).catch(() => {})
  })

  return next(e)
}

async function ckSessionEnd($: any, e: any, next: any) {
  if (ckSessionId) await $.store.delete(ckHbPrefix + ckSessionId).catch(() => {})
  return next(e)
}

function ckTurnStart($: any, e: any, next: any) {
  ckIsBusy = true
  return next(e)
}

async function ckTurnComplete($: any, e: any, next: any) {
  ckIsBusy = false
  if (e.agentId === undefined) {
    const now = await $.clock.now()
    await ckPatch($, {
      lastApiAt: now,
      now,
      lastActiveAt: now,
      halted: null, // you're back; the next beat re-checks idle and siblings
      readTokens: e.usage?.cache_read_input_tokens ?? 0,
      createdTokens: e.usage?.cache_creation_input_tokens ?? 0,
      isHidden: false,
    })
    await ckSample($).catch(() => {})
  }
  return next(e)
}

async function ckRenderBand($: any, e: any, next: any) {
  const c = await read($, ckCache)
  if (e.props.hasSurvey || c.isHidden) return next(e)

  const { Box, Text, Button } = $.ui.resolve(e)
  const ttlMs = c.ttlMin * 60_000
  const left = c.lastApiAt === null ? null : ttlMs - (c.now - c.lastApiAt)
  const isExpired = left !== null && left <= 0
  const isCold = c.lastApiAt === null || isExpired
  const total = c.readTokens + c.createdTokens
  const hit = total > 0 ? Math.round((c.readTokens / total) * 100) : null
  const pct = c.ctxPercent
  const isArmed = c.armedAt !== null && c.now - c.armedAt < ckConfirmMs
  const shouldCompress = pct !== null && (pct >= ckCompressAt || (isCold && pct >= ckCompressColdAt))

  const cacheText = left === null ? 'cache: cold until next message' : isExpired ? 'cache: EXPIRED' : `cache: ${ckFmtLeft(left)} left`
  const ctxText = pct === null ? '' : ` · context ${Math.round(pct)}% (${ckFmtK(c.ctxTokens)}/${ckFmtK(c.ctxWindow)})`
  const hitText = hit === null ? '' : ` · last turn ${hit}% cached`
  const autoLabel = !c.isAuto ? 'Auto: off · turn on' : c.halted ? 'Auto: paused · turn off' : 'Auto: on · turn off'

  const arm = async () => {
    if (isArmed) return ckCompress($)
    const now = await $.clock.now()
    await ckPatch($, { armedAt: now, now, msg: 'press Confirm within 10s to compress' })
  }

  // Several bands share this slot: draw ours and stack whatever sits beneath it.
  const rest = await next(e)

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold={isExpired} dimColor={!isExpired && !shouldCompress}>
          {cacheText} ({c.ttlMin}m){hitText}
          {ctxText}{' '}
        </Text>
        <Button key="ck-refresh" label={isExpired ? 'Refresh (full price)' : 'Refresh'} onPress={() => ckRefreshCache($)} />
        <Button
          key="ck-compress"
          label={isArmed ? 'Confirm compress' : 'Compress'}
          variant={shouldCompress ? 'primary' : undefined}
          onPress={arm}
        />
        <Button
          key="ck-ttl"
          label={`Cache lifetime: ${c.ttlMin}m · switch to ${c.ttlMin === 60 ? 5 : 60}m`}
          onPress={async () => {
            const minutes = c.ttlMin === 60 ? 5 : 60
            await $.store.set('cache-keeper.ttlMin', minutes)
            await ckPatch($, { ttlMin: minutes })
          }}
        />
        <Button
          key="ck-auto"
          label={autoLabel}
          onPress={async () => {
            await $.store.set('cache-keeper.isAuto', !c.isAuto)
            await ckPatch($, { isAuto: !c.isAuto, halted: null })
          }}
        />
        <Button key="ck-hide" label="Hide" onPress={() => ckPatch($, { isHidden: true })} />
      </Box>
      {c.isAuto && c.halted === 'idle' && (
        <Box>
          <Text bold>Auto paused: idle for 8h. </Text>
          <Button key="ck-closeout" label="Close out" variant="primary" onPress={() => ckCloseOut($)} />
          <Button
            key="ck-resume"
            label="Resume (8h more)"
            onPress={async () => {
              const now = await $.clock.now()
              await ckPatch($, { halted: null, resumedAt: now, msg: 'Auto resumed for another 8h' })
            }}
          />
        </Box>
      )}
      {c.isAuto && c.halted === 'sibling' && (
        <Box>
          <Text bold>Auto paused: a newer session is open in this folder. </Text>
          <Button
            key="ck-allow"
            label="Keep Auto here anyway"
            onPress={() => ckPatch($, { halted: null, allowSibling: true, msg: 'Auto allowed alongside the newer session' })}
          />
        </Box>
      )}
      {c.msg && <Text dimColor>{c.msg}</Text>}
      {rest}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', ckSessionStart)
  on('session.end', ckSessionEnd)
  on('turn.start', ckTurnStart)
  on('turn.complete', ckTurnComplete)
  on('ui.render', { component: 'AbovePrompt' }, ckRenderBand)
}
