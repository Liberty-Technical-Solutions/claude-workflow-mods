// Run:  claude plugin test plugins/next-steps
import { expect, mock, test } from 'claude-code/testing'

const PROPS = { hasSurvey: false, bodyColumns: 100 } as any
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 }

function world(on: any, reply: string | null) {
  const sent: string[] = []
  const filled: string[] = []
  const suggested: string[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('model.fork', () => ({ value: reply === null ? { isAnswered: false, reason: 'api-error', usage: USAGE } : { isAnswered: true, text: reply, usage: USAGE } }))
  on('prompt.suggest', ($: any, e: any) => {
    suggested.push(e.text)
    return { value: { isShown: true } }
  })
  on('prompt.fill', ($: any, e: any) => {
    filled.push(e.text)
    return { value: { isFilled: true } }
  })
  on('prompt.submit', ($: any, e: any) => {
    sent.push(e.text)
    return { value: { text: e.text } }
  })
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return (globalThis as any).h(Box, {})
  })
  return { sent, filled, suggested }
}

async function replyDone($: any, clock: any) {
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' } as any)
  await clock.advance(1000)
}

test('options appear as checkboxes; ticking several and pressing Send selected sends one ordered request', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w = world(on, 'Sure:\n["Run the tests", "Commit and push", "Review the diff"]')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

  expect(await ui.find({ key: 'ns-pick-0' })).toBeUndefined()
  await replyDone($, clock)
  await ui.redraw()
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[ ] 1  Run the tests')
  expect((await ui.find({ key: 'ns-pick-2' }))?.props.label).toBe('[ ] 3  Review the diff')
  expect(w.suggested[0]).toBe('Run the tests')

  await ui.press({ key: 'ns-pick-0' })
  await ui.press({ key: 'ns-pick-1' })
  expect((await ui.find({ key: 'ns-pick-1' }))?.props.label).toBe('[x] 2  Commit and push')
  expect((await ui.find({ key: 'ns-send' }))?.props.label).toBe('Send selected (2)')

  await ui.press({ key: 'ns-send' })
  expect(w.sent).toEqual([]) // only a preview so far
  const preview = JSON.stringify(await ui.findAll({ type: 'Text' }))
  expect(preview).toContain('This will be sent as one request:')
  expect(preview).toContain('1. Run the tests')
  expect(preview).toContain('2. Commit and push')

  await ui.press({ key: 'ns-confirm' })
  expect(w.sent).toEqual(['Please do these in order, and tell me when each is done:\n1. Run the tests\n2. Commit and push'])
  expect(await ui.find({ key: 'ns-pick-0' })).toBeUndefined()
})

test('Back from the preview returns to the checkboxes without sending', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w = world(on, '["Run the tests", "Commit and push"]')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await replyDone($, clock)
  await ui.redraw()
  await ui.press({ key: 'ns-pick-0' })
  await ui.press({ key: 'ns-send' })
  expect(await ui.find({ key: 'ns-confirm' })).toBeDefined()
  await ui.press({ key: 'ns-back' })
  expect(await ui.find({ key: 'ns-confirm' })).toBeUndefined()
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[x] 1  Run the tests')
  expect(w.sent).toEqual([])
})

test('each row has a one-click send for just that option', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w = world(on, '["Run the tests", "Commit and push"]')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await replyDone($, clock)
  await ui.redraw()
  await ui.press({ key: 'ns-go-1' })
  expect(w.sent).toEqual(['Commit and push'])
})

test('Send selected does nothing until something is ticked', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w = world(on, '["Run the tests"]')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await replyDone($, clock)
  await ui.redraw()
  await ui.press({ key: 'ns-send' })
  expect(w.sent).toEqual([])
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[ ] 1  Run the tests')
})

test('Edit selected puts the ticked options in the prompt box instead of sending', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w = world(on, '["Run the tests"]')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await replyDone($, clock)
  await ui.redraw()
  await ui.press({ key: 'ns-pick-0' })
  await ui.press({ key: 'ns-edit' })
  expect(w.filled).toEqual(['Run the tests'])
  expect(w.sent).toEqual([])
})

test('when the model gives nothing usable, built-in suggestions are shown', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  world(on, null)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await replyDone($, clock)
  await ui.redraw()
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[ ] 1  Run the tests and show me the results')
  expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).toContain('suggestions')
})

test('Off hides the options and stops asking', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  world(on, '["Run the tests"]')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await replyDone($, clock)
  await ui.redraw()
  await ui.press({ key: 'ns-off' })
  expect(await ui.find({ key: 'ns-pick-0' })).toBeUndefined()
  await replyDone($, clock)
  await ui.redraw()
  expect(await ui.find({ key: 'ns-pick-0' })).toBeUndefined()
})
