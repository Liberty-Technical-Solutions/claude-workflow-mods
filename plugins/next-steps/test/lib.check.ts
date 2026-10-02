// Run:  node --test plugins/next-steps/test/lib.check.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_STEPS, parseSuggestions, suggestPrompt, withFallback } from '../hooks/lib.ts'

test('parseSuggestions: plain array, fences and chatter', () => {
  assert.deepEqual(parseSuggestions('["Run the tests", "Commit the changes"]', 4), ['Run the tests', 'Commit the changes'])
  assert.deepEqual(parseSuggestions('Sure!\n```json\n["Run the tests"]\n```', 4), ['Run the tests'])
})

test('parseSuggestions: cleans numbering, dedupes, drops junk, caps the count', () => {
  const raw = JSON.stringify(['1. Run the tests', 'run the tests', 'ok', 5, 'x'.repeat(200), '- Commit and push', 'Update the docs', 'Review the diff'])
  assert.deepEqual(parseSuggestions(raw, 3), ['Run the tests', 'Commit and push', 'Update the docs'])
})

test('parseSuggestions: unusable replies give nothing', () => {
  assert.deepEqual(parseSuggestions('no list here', 4), [])
  assert.deepEqual(parseSuggestions('[not json]', 4), [])
  assert.deepEqual(parseSuggestions('{"a": 1}', 4), [])
})

test('withFallback', () => {
  assert.deepEqual(withFallback(['A thing'], 4), { items: ['A thing'], isFallback: false })
  assert.deepEqual(withFallback([], 2), { items: DEFAULT_STEPS.slice(0, 2), isFallback: true })
})

test('suggestPrompt mentions the count and the JSON-only rule', () => {
  assert.match(suggestPrompt(4), /up to 4/)
  assert.match(suggestPrompt(4), /ONLY a JSON array/)
})
