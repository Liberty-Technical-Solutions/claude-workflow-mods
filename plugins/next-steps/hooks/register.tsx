import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NextPrefs, NextSteps } from '../types'
import { combineSelected, parseSuggestions, suggestPrompt, togglePick, withFallback } from './lib'

// After each turn: a short question panel of options for what to do next, with checkboxes. Tick one or more and
// press Send selected (several are sent as one ordered request), or send a single option straight away.
// If Claude proposed options, those come first; otherwise it suggests sensible next tasks, and a built-in list
// covers the case where it cannot. Cost: one small question per turn over the cached conversation (a cache read
// plus about 100 output tokens). Turn it off with the Off button or /next.

const nsStepsInit: NextSteps = { items: [], isFallback: false, isLoading: false, picked: [], gen: 0 }
const nsPrefsInit: NextPrefs = { isOn: true, count: 4 }
const nsSteps = atom({ plugin: 'next-steps', key: 'steps' } as const, nsStepsInit)
const nsPrefs = atom({ plugin: 'next-steps', key: 'prefs' } as const, nsPrefsInit)

const nsDelayMs = 400 // let the finished turn settle before asking

async function nsSetPrefs($: EngineInterface, p: Partial<NextPrefs>) {
  const next = { ...(await read($, nsPrefs)), ...p }
  await update($, nsPrefs, () => next)
  await $.store.set('next-steps.prefs', next)
}

async function nsClear($: EngineInterface) {
  await update($, nsSteps, s => ({ ...s, items: [], picked: [], isLoading: false, gen: s.gen + 1 }))
}

// Asks for the options. A slow answer for an old turn is discarded (gen changed).
async function nsGenerate($: EngineInterface, gen: number) {
  const prefs = await read($, nsPrefs)
  const r = await $.model.fork({ prompt: suggestPrompt(prefs.count) })
  const current = await read($, nsSteps)
  if (current.gen !== gen) return
  const parsed = r.isAnswered ? parseSuggestions(r.text, prefs.count) : []
  const { items, isFallback } = withFallback(parsed, prefs.count)
  await update($, nsSteps, s => ({ ...s, items, isFallback, picked: [], isLoading: false }))
  // Also offer the first one as dim ghost text in the empty box (Tab takes it).
  await $.prompt.suggest({ text: items[0] }).catch(() => {})
}

async function nsToggle($: EngineInterface, index: number) {
  await update($, nsSteps, s => ({ ...s, picked: togglePick(s.picked, index) }))
}

async function nsSelectedText($: EngineInterface) {
  const s = await read($, nsSteps)
  return combineSelected(s.picked.map(i => s.items[i]).filter(Boolean))
}

// Sends one option straight away.
async function nsSend($: EngineInterface, text: string) {
  await nsClear($)
  void $.prompt.submit({ text }).catch(() => {})
}

// Sends every ticked option as one request.
async function nsSendSelected($: EngineInterface) {
  const text = await nsSelectedText($)
  if (text) await nsSend($, text)
}

// Puts the ticked options in the prompt box to tweak before sending.
async function nsEditSelected($: EngineInterface) {
  const text = await nsSelectedText($)
  if (text) await $.prompt.fill({ text, mode: 'replace' }).catch(() => {})
}

async function nsSessionStart($: any, e: any, next: any) {
  const saved = (await $.store.get('next-steps.prefs')) as Partial<NextPrefs> | undefined
  if (saved && typeof saved === 'object') await update($, nsPrefs, p => ({ ...p, ...saved }))
  await $.command.register({ name: 'next', description: 'Turn clickable next-step suggestions on or off' })
  return next(e)
}

async function nsCommandNext($: any) {
  const prefs = await read($, nsPrefs)
  await nsSetPrefs($, { isOn: !prefs.isOn })
  if (prefs.isOn) await nsClear($)
  return { text: prefs.isOn ? 'Next-step suggestions are off. Type /next to turn them back on.' : 'Next-step suggestions are on. They appear after each reply.' }
}

async function nsTurnComplete($: any, e: any, next: any) {
  const prefs = await read($, nsPrefs)
  if (prefs.isOn && e.agentId === undefined && !e.isAborted) {
    const gen = (await read($, nsSteps)).gen + 1
    await update($, nsSteps, s => ({ ...s, items: [], picked: [], isLoading: true, gen }))
    $.clock.after(nsDelayMs, () => {
      void nsGenerate($, gen).catch(() => {})
    })
  }
  return next(e)
}

// Anything you send (typed or clicked) retires the old options; fresh ones follow the next reply.
async function nsPromptSubmit($: any, e: any, next: any) {
  await nsClear($)
  return next(e)
}

async function nsRenderBand($: any, e: any, next: any) {
  const s = await read($, nsSteps)
  const prefs = await read($, nsPrefs)
  if (e.props.hasSurvey || !prefs.isOn || (s.items.length === 0 && !s.isLoading)) return next(e)

  const { Box, Text, Button } = $.ui.resolve(e)
  const rest = await next(e)
  const n = s.picked.length

  return (
    <Box flexDirection="column">
      <Box key="ns-panel" flexDirection="column" marginTop={1} borderStyle="round" paddingX={1}>
        <Box>
          <Text bold>{s.isLoading ? 'Thinking about what to do next…' : 'What would you like to do next?'}</Text>
          <Box flexGrow={1} />
          <Button key="ns-refresh" label="New ideas" plain dimColor onPress={() => void nsGenerate($, s.gen).catch(() => {})} />
          <Box marginLeft={2}>
            <Button key="ns-off" label="Off" plain dimColor onPress={() => void (async () => { await nsSetPrefs($, { isOn: false }); await nsClear($) })()} />
          </Box>
        </Box>
        {s.items.length > 0 && (
          <Text dimColor>{s.isFallback ? 'Suggestions: ' : ''}Tick one or more, then Send. Or just type your own below.</Text>
        )}
        {s.items.map((text: string, i: number) => {
          const isPicked = s.picked.includes(i)
          return (
            <Box key={`ns-row-${i}`} gap={2}>
              <Button key={`ns-pick-${i}`} label={`${isPicked ? '[x]' : '[ ]'} ${i + 1}  ${text}`} hotkey={String(i + 1)} variant={isPicked ? 'primary' : undefined} onPress={() => void nsToggle($, i)} />
              <Button key={`ns-go-${i}`} label="send" plain dimColor onPress={() => void nsSend($, text)} />
            </Box>
          )
        })}
        {s.items.length > 0 && (
          <Box gap={1} marginTop={1}>
            <Button key="ns-send" label={n > 0 ? `Send selected (${n})` : 'Send selected'} hotkey="s" variant={n > 0 ? 'primary' : undefined} dimColor={n === 0} onPress={() => void nsSendSelected($)} />
            <Button key="ns-edit" label="Edit selected" dimColor={n === 0} onPress={() => void nsEditSelected($)} />
            <Button key="ns-clear" label="Clear" plain dimColor onPress={() => void update($, nsSteps, st => ({ ...st, picked: [] }))} />
          </Box>
        )}
      </Box>
      {rest}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', nsSessionStart)
  on('command.run', { command: 'next' }, nsCommandNext)
  on('turn.complete', nsTurnComplete)
  on('prompt.submit', nsPromptSubmit)
  on('ui.render', { component: 'AbovePrompt' }, nsRenderBand)
}
