// GENERATED copy of plugins/next-steps/hooks/lib.ts by build-bundle.ps1. Do not edit.
// Pure logic for next-steps: no $ in here, so it is unit-testable with `node --test`.

export const MAX_ITEM_LENGTH = 110

/** Shown when the model gives nothing usable, so there are always options to click. */
export const DEFAULT_STEPS = [
  'Run the tests and show me the results',
  'Review what changed and point out any problems',
  'Commit and push the changes',
  'Update the docs and changelog for this work',
]

export function suggestPrompt(count: number): string {
  return [
    `Suggest up to ${count} things the user might want to do next in this session.`,
    'Rules:',
    '- If your last message proposed options or numbered next steps, use those first, worded as instructions the user would send to you.',
    '- If it did not, suggest sensible next tasks for this work (verify, test, review, fix, commit or push, document, continue the plan).',
    '- Each item is one short imperative instruction, under 12 words, starting with a verb. No numbering, no quotes, no explanation.',
    '- Do not suggest anything destructive (deleting data, force pushes) unless the user already asked for it.',
    'Reply with ONLY a JSON array of strings, for example ["Run the tests", "Commit the changes"].',
  ].join('\n')
}

/** Pulls the first JSON array of strings out of a model reply, tolerating code fences and chatter. */
export function parseSuggestions(text: string, max: number): string[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of parsed) {
    if (typeof item !== 'string') continue
    const t = item.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').replace(/\s+/g, ' ').trim()
    const key = t.toLowerCase()
    if (t.length < 3 || t.length > MAX_ITEM_LENGTH || seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

export function withFallback(items: string[], max: number): { items: string[]; isFallback: boolean } {
  return items.length > 0 ? { items, isFallback: false } : { items: DEFAULT_STEPS.slice(0, max), isFallback: true }
}

/** Turns the ticked options into one request: a single option as written, several as an ordered list. */
export function combineSelected(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  return ['Please do these in order, and tell me when each is done:', ...items.map((t, i) => `${i + 1}. ${t}`)].join('\n')
}

/** Ticks or unticks one option, keeping the list in display order. */
export function togglePick(picked: number[], index: number): number[] {
  return (picked.includes(index) ? picked.filter(i => i !== index) : [...picked, index]).sort((a, b) => a - b)
}
