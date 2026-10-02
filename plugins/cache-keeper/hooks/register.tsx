import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheState } from '../types'

const INITIAL: CacheState = {
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
const cache = atom({ plugin: 'cache-keeper', key: 'cache' } as const, INITIAL)

const TICK_MS = 30_000
const AUTO_WITHIN_MS = 5 * 60_000 // auto keep-alive fires when this little is left
const IDLE_CAP_MS = 8 * 3_600_000 // stop keeping the cache alive after this long without a finished turn
const COMPRESS_AT = 70 // percent of context window
const COMPRESS_COLD_AT = 40 // lower bar when the cache is already cold: a rewrite is coming anyway
const CONFIRM_MS = 10_000
const HB_PREFIX = 'cache-keeper.hb.' // one store key per live session: { cwd, startedAt, seenAt }
const HB_FRESH_MS = 2 * 60_000 // a session counts as alive if it checked in this recently
const HB_STALE_MS = 24 * 3_600_000 // dead heartbeats older than this are swept

const CLOSE_OUT_PROMPT =
  "I'm stepping away and this session will be left idle. Close it out: summarize what was done, what is unfinished, and the exact next steps. Save that to this project's handoff or session note (HANDOFF.md or its equivalent) if one exists, otherwise just show it here. Do not commit, push or deploy anything."

const fmtLeft = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return m >= 1 ? `${m}m` : `${Math.max(0, Math.floor(ms / 1000))}s`
}
const fmtK = (n: number | null) => (n === null ? '?' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const normCwd = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

async function patch($: EngineInterface, p: Partial<CacheState>) {
  await update($, cache, c => ({ ...c, ...p }))
}

// Reads context fill and stamps the clock; the redraw follows from the state write.
async function sample($: EngineInterface) {
  const now = await $.clock.now()
  const { context } = await $.session.usage()
  await patch($, {
    now,
    ctxPercent: context.percent ?? null,
    ctxTokens: context.tokens ?? null,
    ctxWindow: context.window,
  })
}

// One tiny tool-less question over the session's own transcript: the cached prefix is read,
// which resets its time-to-live. Adds nothing to the conversation.
async function refreshCache($: EngineInterface) {
  await patch($, { msg: 'refreshing cache…' })
  const r = await $.model.fork({ prompt: 'Reply with the single word: ok' })
  const now = await $.clock.now()
  if (r.isAnswered) {
    const rewritten = r.usage.cache_creation_input_tokens
    await patch($, {
      lastApiAt: now,
      now,
      msg:
        rewritten > 1000
          ? `cache had lapsed: ${fmtK(rewritten)} tokens rewritten at full price`
          : `cache refreshed: ${fmtK(r.usage.cache_read_input_tokens)} tokens read from cache`,
    })
  } else {
    await patch($, { msg: `refresh failed: ${r.reason}` })
  }
  await sample($)
}

async function compress($: EngineInterface) {
  await patch($, { armedAt: null, msg: 'compressing…' })
  const r = await $.session.compact()
  await patch($, {
    lastApiAt: null, // the new, shorter prefix is cold until your next message
    msg: 'skip' in r ? `compress skipped: ${r.skip}` : 'compressed; cache is cold until your next message',
  })
  await sample($)
}

// Asks Claude for a handoff note and parks Auto so the cache is allowed to lapse.
async function closeOut($: EngineInterface) {
  await patch($, { halted: 'idle', msg: 'close-out requested; Auto stays paused. Archive this session from the sidebar when it finishes.' })
  void $.prompt.submit({ text: CLOSE_OUT_PROMPT })
}

async function heartbeat($: EngineInterface, id: string, cwd: string, startedAt: number, now: number) {
  await $.store.set(HB_PREFIX + id, { cwd: normCwd(cwd), startedAt, seenAt: now })
}

// True when a session that started AFTER this one is alive in the same folder.
async function hasNewerSibling($: EngineInterface, id: string, cwd: string, startedAt: number, now: number) {
  const mine = HB_PREFIX + id
  const here = normCwd(cwd)
  let found = false
  for (const key of await $.store.keys()) {
    if (!key.startsWith(HB_PREFIX) || key === mine) continue
    const hb = (await $.store.get(key)) as { cwd?: string; startedAt?: number; seenAt?: number } | undefined
    if (!hb || typeof hb.seenAt !== 'number') continue
    if (now - hb.seenAt > HB_STALE_MS) {
      await $.store.delete(key)
      continue
    }
    if (hb.cwd === here && now - hb.seenAt < HB_FRESH_MS && (hb.startedAt ?? 0) > startedAt) found = true
  }
  return found
}

// The 30-second beat: read the gauges, check in, decide whether Auto should pause, refresh if due.
async function tick($: EngineInterface, id: string, cwd: string, startedAt: number, isBusy: boolean) {
  await sample($)
  const now = await $.clock.now()
  await heartbeat($, id, cwd, startedAt, now)

  const c = await read($, cache)
  if (!c.isAuto) return

  let halted = c.halted
  if (halted === null) {
    const idleSince = Math.max(c.lastActiveAt ?? startedAt, c.resumedAt ?? 0)
    if (now - idleSince > IDLE_CAP_MS) {
      halted = 'idle'
      await patch($, { halted, msg: 'Auto paused: no activity for 8h. Send a message, Resume, or Close out.' })
      $.ui.toast('cache-keeper: Auto paused after 8h idle')
    } else if (!c.allowSibling && (await hasNewerSibling($, id, cwd, startedAt, now))) {
      halted = 'sibling'
      await patch($, { halted, msg: 'Auto paused: a newer session is open in this folder.' })
      $.ui.toast('cache-keeper: Auto paused, newer session in this folder')
    }
  }

  if (halted === null && !isBusy && c.lastApiAt !== null) {
    const left = c.ttlMin * 60_000 - (c.now - c.lastApiAt)
    if (left > 0 && left < AUTO_WITHIN_MS) await refreshCache($)
  }
}

export const register: Register = on => {
  let isBusy = false
  let sessionId = ''
  let sessionCwd = ''
  let startedAt = 0

  on('session.start', async ($, e, next) => {
    const ttl = await $.store.get('cache-keeper.ttlMin')
    const auto = await $.store.get('cache-keeper.isAuto')
    sessionId = await $.session.id()
    sessionCwd = e.cwd
    startedAt = await $.clock.now()
    await patch($, {
      ttlMin: ttl === 5 ? 5 : 60,
      isAuto: auto === true,
      now: startedAt,
      lastActiveAt: startedAt,
    })
    await heartbeat($, sessionId, sessionCwd, startedAt, startedAt).catch(() => {})
    await sample($).catch(() => {})

    $.clock.every(TICK_MS, () => {
      void tick($, sessionId, sessionCwd, startedAt, isBusy).catch(() => {})
    })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (sessionId) await $.store.delete(HB_PREFIX + sessionId).catch(() => {})
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    isBusy = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    isBusy = false
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await patch($, {
        lastApiAt: now,
        now,
        lastActiveAt: now,
        halted: null, // you're back; the next beat re-checks idle and siblings
        readTokens: e.usage?.cache_read_input_tokens ?? 0,
        createdTokens: e.usage?.cache_creation_input_tokens ?? 0,
        isHidden: false,
      })
      await sample($).catch(() => {})
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, cache)
    if (e.props.hasSurvey || c.isHidden) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const ttlMs = c.ttlMin * 60_000
    const left = c.lastApiAt === null ? null : ttlMs - (c.now - c.lastApiAt)
    const isExpired = left !== null && left <= 0
    const isCold = c.lastApiAt === null || isExpired
    const total = c.readTokens + c.createdTokens
    const hit = total > 0 ? Math.round((c.readTokens / total) * 100) : null
    const pct = c.ctxPercent
    const isArmed = c.armedAt !== null && c.now - c.armedAt < CONFIRM_MS
    const shouldCompress = pct !== null && (pct >= COMPRESS_AT || (isCold && pct >= COMPRESS_COLD_AT))

    const cacheText = left === null ? 'cache: cold until next message' : isExpired ? 'cache: EXPIRED' : `cache: ${fmtLeft(left)} left`
    const ctxText = pct === null ? '' : ` · context ${Math.round(pct)}% (${fmtK(c.ctxTokens)}/${fmtK(c.ctxWindow)})`
    const hitText = hit === null ? '' : ` · last turn ${hit}% cached`
    const autoLabel = !c.isAuto ? 'Auto: off · turn on' : c.halted ? 'Auto: paused · turn off' : 'Auto: on · turn off'

    const arm = async () => {
      if (isArmed) return compress($)
      const now = await $.clock.now()
      await patch($, { armedAt: now, now, msg: 'press Confirm within 10s to compress' })
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold={isExpired} dimColor={!isExpired && !shouldCompress}>
            {cacheText} ({c.ttlMin}m){hitText}
            {ctxText}{' '}
          </Text>
          <Button key="refresh" label={isExpired ? 'Refresh (full price)' : 'Refresh'} onPress={() => refreshCache($)} />
          <Button
            key="compress"
            label={isArmed ? 'Confirm compress' : 'Compress'}
            variant={shouldCompress ? 'primary' : undefined}
            onPress={arm}
          />
          <Button
            key="ttl"
            label={`Cache lifetime: ${c.ttlMin}m · switch to ${c.ttlMin === 60 ? 5 : 60}m`}
            onPress={async () => {
              const minutes = c.ttlMin === 60 ? 5 : 60
              await $.store.set('cache-keeper.ttlMin', minutes)
              await patch($, { ttlMin: minutes })
            }}
          />
          <Button
            key="auto"
            label={autoLabel}
            onPress={async () => {
              await $.store.set('cache-keeper.isAuto', !c.isAuto)
              await patch($, { isAuto: !c.isAuto, halted: null })
            }}
          />
          <Button key="hide" label="Hide" onPress={() => patch($, { isHidden: true })} />
        </Box>
        {c.isAuto && c.halted === 'idle' && (
          <Box>
            <Text bold>Auto paused: idle for 8h. </Text>
            <Button key="closeout" label="Close out" variant="primary" onPress={() => closeOut($)} />
            <Button
              key="resume"
              label="Resume (8h more)"
              onPress={async () => {
                const now = await $.clock.now()
                await patch($, { halted: null, resumedAt: now, msg: 'Auto resumed for another 8h' })
              }}
            />
          </Box>
        )}
        {c.isAuto && c.halted === 'sibling' && (
          <Box>
            <Text bold>Auto paused: a newer session is open in this folder. </Text>
            <Button
              key="allow"
              label="Keep Auto here anyway"
              onPress={() => patch($, { halted: null, allowSibling: true, msg: 'Auto allowed alongside the newer session' })}
            />
          </Box>
        )}
        {c.msg && <Text dimColor>{c.msg}</Text>}
      </Box>
    )
  })
}
