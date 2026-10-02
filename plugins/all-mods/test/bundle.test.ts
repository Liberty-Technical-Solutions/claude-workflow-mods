// Run:  claude plugin test plugins/all-mods
// The bundle is generated, so this checks the merged result: strip and next-steps share the band, and the
// shared events (session.start, turn.complete, ui.render, prompt.submit) still reach every mod.
import { expect, mock, test } from 'claude-code/testing'

const PROPS = { hasSurvey: false, bodyColumns: 100 } as any
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 }

function world(on: any) {
  const sent: string[] = []
  on('process.run', ($: any, e: any) => {
    const cmd = e.argv.join(' ')
    const out = cmd.includes('status --porcelain=v1 -b') ? '## main...origin/main [ahead 2]\n M a.ts' : cmd.includes('rev-parse HEAD') ? 'abc123' : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [{ kind: 'five_hour', percentUsed: 41 }], context: { percent: 62, tokens: 124000, window: 200000 } } }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => {
    throw new Error('no such file')
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('model.fork', () => ({ value: { isAnswered: true, text: '["Run the tests", "Commit and push"]', usage: USAGE } }))
  on('prompt.suggest', () => ({ value: { isShown: true } }))
  on('prompt.submit', ($: any, e: any) => {
    sent.push(e.text)
    return { value: { text: e.text } }
  })
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return (globalThis as any).h(Box, {})
  })
  return { sent }
}

test('bundle: one band holds the strip and the next-steps list; clicking sends', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w = world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'all-mods', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

  const text = JSON.stringify(await ui.findAll({ type: 'Text' }))
  expect(text).toContain('main ±1 ↑2')
  expect(text).toContain('62%')
  expect(await ui.find({ key: 'ss-compress' })).toBeDefined()

  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' } as any)
  await clock.advance(1000)
  await ui.redraw()
  expect(await ui.find({ key: 'ss-compress' })).toBeDefined()
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[ ] 1  Run the tests')

  await ui.press({ key: 'ns-go-1' })
  expect(w.sent).toEqual(['Commit and push'])
})
