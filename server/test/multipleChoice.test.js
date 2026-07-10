import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateMultipleAnswer } from '../src/domain/multipleChoice.js'

const options = [
  { id: 'a', is_correct: true },
  { id: 'b', is_correct: false },
  { id: 'c', is_correct: true },
  { id: 'd', is_correct: false }
]

test('evaluateMultipleAnswer — exact correct set scores', () => {
  const { isCorrect, picked } = evaluateMultipleAnswer(options, ['a', 'c'])
  assert.equal(isCorrect, true)
  assert.deepEqual(picked.sort(), ['a', 'c'])
})

test('evaluateMultipleAnswer — order does not matter', () => {
  assert.equal(evaluateMultipleAnswer(options, ['c', 'a']).isCorrect, true)
})

test('evaluateMultipleAnswer — missing a correct option fails (all-or-nothing)', () => {
  assert.equal(evaluateMultipleAnswer(options, ['a']).isCorrect, false)
})

test('evaluateMultipleAnswer — an extra incorrect option fails', () => {
  assert.equal(evaluateMultipleAnswer(options, ['a', 'c', 'd']).isCorrect, false)
})

test('evaluateMultipleAnswer — no selection fails', () => {
  const { isCorrect, picked } = evaluateMultipleAnswer(options, [])
  assert.equal(isCorrect, false)
  assert.deepEqual(picked, [])
})

test('evaluateMultipleAnswer — unknown ids are ignored, not counted as picks', () => {
  const { isCorrect, picked } = evaluateMultipleAnswer(options, ['a', 'c', 'zzz'])
  assert.equal(isCorrect, true)
  assert.deepEqual(picked.sort(), ['a', 'c'])
})

test('evaluateMultipleAnswer — duplicate ids are deduped', () => {
  const { isCorrect, picked } = evaluateMultipleAnswer(options, ['a', 'a', 'c'])
  assert.equal(isCorrect, true)
  assert.deepEqual(picked.sort(), ['a', 'c'])
})
