import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SAFE_QUESTION_SELECT,
  FORBIDDEN_KEYS,
  serializeQuestionForUser,
  assertNoAnswerLeak
} from '../src/lib/userSerializer.js'

test('SAFE_QUESTION_SELECT — never selects answer_options.is_correct', () => {
  assert.equal(SAFE_QUESTION_SELECT.includes('is_correct'), false)
})

test('SAFE_QUESTION_SELECT — does select the option id/text needed to render choices', () => {
  assert.match(SAFE_QUESTION_SELECT, /answer_options\s*\(/)
  assert.match(SAFE_QUESTION_SELECT, /\btext\b/)
})

test('serializeQuestionForUser — closed question exposes its options with id/text only', () => {
  const question = {
    id: 'q1',
    text: 'What is 2+2?',
    type: 'closed',
    order_index: 0,
    answer_options: [
      { id: 'o1', text: '3' },
      { id: 'o2', text: '4' }
    ]
  }
  const result = serializeQuestionForUser(question)
  assert.equal(result.id, 'q1')
  assert.equal(result.orderIndex, 0)
  assert.deepEqual(result.options, [
    { id: 'o1', text: '3' },
    { id: 'o2', text: '4' }
  ])
})

test('serializeQuestionForUser — open question ALWAYS emits options: [] (highest-risk leak vector)', () => {
  // For type 'open', the correct option's TEXT is the plaintext keyword CSV
  // (see attemptEngine/openAnswer). Even without an is_correct field, the
  // options array itself must never reach a usuario for this type.
  const question = {
    id: 'q2',
    text: 'Name a vegetable',
    type: 'open',
    order_index: 1,
    answer_options: [{ id: 'o3', text: 'lechuga, tomate, cebolla' }]
  }
  const result = serializeQuestionForUser(question)
  assert.deepEqual(result.options, [])
})

test('assertNoAnswerLeak — throws when is_correct appears at the top level', () => {
  assert.throws(() => assertNoAnswerLeak({ id: 'o1', is_correct: true }))
})

test('assertNoAnswerLeak — throws when a forbidden key appears nested inside an array of objects', () => {
  const payload = { questions: [{ id: 'q1', options: [{ id: 'o1', text: 'x', is_correct: false }] }] }
  assert.throws(() => assertNoAnswerLeak(payload))
})

test('assertNoAnswerLeak — throws for every declared forbidden key, one at a time', () => {
  for (const key of FORBIDDEN_KEYS) {
    assert.throws(() => assertNoAnswerLeak({ nested: { [key]: 'leak' } }), `expected throw for key "${key}"`)
  }
})

test('assertNoAnswerLeak — does NOT throw on a clean payload with only safe fields', () => {
  const payload = {
    attempt: { id: 'a1', status: 'completed' },
    questions: [{ id: 'q1', options: [{ id: 'o1', text: 'safe' }] }]
  }
  assert.doesNotThrow(() => assertNoAnswerLeak(payload))
})
