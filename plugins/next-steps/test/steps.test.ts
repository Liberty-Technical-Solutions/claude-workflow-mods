// Run:  claude plugin test plugins/next-steps
import { expect, mock, test } from 'claude-code/testing'

const PROPS = { hasSurvey: false, bodyColumns: 100 } as any
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 }

// `slow`: the model answers only once the test calls release(), to exercise the "show the built-in options first" path.
function world(on: any, reply: string | null, slow = false) {
  const sent: string[] = []
  const filled: string[] = []
  const suggested: string[] = []
  const prompts: string[] = []
  const models: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('model.complete', async ($: any, e: any) => {
    prompts.push(e.prompt)
    models.push(e.model)
    if (slow) await gate
    return { value: reply === null ? { isAnswered: false, reason: 'api-error', usage: USAGE } : { isAnswered: true, text: reply, usage: USAGE } }
  })
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
  return { sent, filled, suggested, prompts, models, release }
}

async function replyDone($: any, clock: any, answer = 'done', ms = 1000) {
  await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1' } as any)
  await clock.advance(ms)
}

test('options appear as checkboxes; ticking several and pressing Send selected sends one ordered request', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w = world(on, 'Sure:\n["Run the tests", "Commit and push", "Review the diff"]')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

  // Idle at the start: the starting points are already there.
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[ ] Show me where this project stands and what is left')
  await replyDone($, clock)
  await ui.redraw()
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[ ] Run the tests')
  expect((await ui.find({ key: 'ns-pick-2' }))?.props.label).toBe('[ ] Review the diff')
  expect(w.suggested[0]).toBe('Run the tests')

  await ui.press({ key: 'ns-pick-0' })
  await ui.press({ key: 'ns-pick-1' })
  expect((await ui.find({ key: 'ns-pick-1' }))?.props.label).toBe('[x] Commit and push')
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
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[x] Run the tests')
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
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[ ] Run the tests')
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
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[ ] Run the tests and show me the results')
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

test('it asks the small fast model, using only the latest reply', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w = world(on, '["Run the tests"]')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await replyDone($, clock, 'I added the login page. Next I could add tests.')
  expect(w.models).toEqual(['claude-haiku-4-5-20251001'])
  expect(w.prompts[0]).toContain('I added the login page.')
  expect(w.prompts[0]).not.toContain('Thinking')
})

test('slow model: built-in options show after 1.5s, then the tailored ones replace them', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w = world(on, '["Add a login test", "Deploy to staging"]', true)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

  await replyDone($, clock, 'done', 1000) // under 1.5s: nothing yet, and no "Thinking" text
  await ui.redraw()
  expect(await ui.find({ key: 'ns-pick-0' })).toBeUndefined()
  expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).not.toContain('Thinking')

  await clock.advance(1000) // past 1.5s: the built-in options appear
  await ui.redraw()
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[ ] Run the tests and show me the results')

  w.release() // the tailored answer arrives
  await clock.advance(10)
  await ui.redraw()
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[ ] Add a login test')
})

test('a tailored answer never replaces a list you have started ticking', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w = world(on, '["Add a login test"]', true)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await replyDone($, clock, 'done', 2000)
  await ui.redraw()
  await ui.press({ key: 'ns-pick-0' })
  w.release()
  await clock.advance(10)
  await ui.redraw()
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[x] Run the tests and show me the results')
})

test('an idle session shows starting points with no reply and no model call', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000 })
  const w = world(on, '["Never used"]')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[ ] Show me where this project stands and what is left')
  expect((await ui.find({ key: 'ns-pick-3' }))?.props.label).toBe('[ ] Pick up where we left off last time')
  expect(w.prompts).toEqual([])
})

test('a stopped reply leaves the session idle, so the basics appear', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  const w = world(on, '["Never used"]')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'ns-go-0' }) // sending clears the panel while the reply runs
  expect(await ui.find({ key: 'ns-pick-0' })).toBeUndefined()
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1' } as any)
  await clock.advance(10)
  await ui.redraw()
  expect((await ui.find({ key: 'ns-pick-0' }))?.props.label).toBe('[ ] Run the tests and show me the results')
  expect(w.prompts).toEqual([])
})

test('/next turns it off and back on; back on shows options right away', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000 })
  world(on, '[]')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const run = () => $.command.run({ command: 'next', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } as any })
  await run()
  await ui.redraw()
  expect(await ui.find({ key: 'ns-pick-0' })).toBeUndefined()
  await run()
  await ui.redraw()
  expect(await ui.find({ key: 'ns-pick-0' })).toBeDefined()
})

test('laid out like a question prompt: title, "Something else" row, Skip and × dismiss until the next idle moment', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000 })
  world(on, '["Run the tests", "Commit and push"]')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await replyDone($, clock)
  await ui.redraw()
  const text = JSON.stringify(await ui.findAll({ type: 'Text' }))
  expect(text).toContain('What would you like to do next?')
  expect(text).toContain('Something else: just type below')
  expect(text).toContain('tick any')
  await ui.press({ key: 'ns-pick-0' })
  expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).toContain('1 selected')

  await ui.press({ key: 'ns-skip' })
  expect(await ui.find({ key: 'ns-pick-0' })).toBeUndefined()

  await replyDone($, clock) // the next idle moment brings the options back
  await ui.redraw()
  expect(await ui.find({ key: 'ns-pick-0' })).toBeDefined()
  await ui.press({ key: 'ns-close' })
  expect(await ui.find({ key: 'ns-pick-0' })).toBeUndefined()
})
