import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SAFE_QUESTION_SELECT,
  serializeQuestionForUser,
  assertNoAnswerLeak
} from '../src/lib/userSerializer.js'

// EXPECTED_FORBIDDEN_KEYS — written INDEPENDENTLY of FORBIDDEN_KEYS on
// purpose. Iterating the module's own list to build the cases was
// tautological: it could never catch a key being dropped from (or missing
// in) the implementation, which is the only failure mode that matters here.
//
// Both spellings of every leaky concept are listed because the codebase emits
// both: snake_case at the DB layer (is_correct, correct_option_id) and
// camelCase out of the domain layer (attemptEngine's gradeAnswer/gradeAttempt
// return isCorrect).
const EXPECTED_FORBIDDEN_KEYS = [
  'is_correct',
  'isCorrect',
  'correct_option_id',
  'correctOptionId',
  'correct_option_ids',
  'correctOptionIds',
  'correct_answer_text',
  'correctAnswerText'
]

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

test('assertNoAnswerLeak — throws for every independently-listed forbidden key, one at a time', () => {
  for (const key of EXPECTED_FORBIDDEN_KEYS) {
    assert.throws(() => assertNoAnswerLeak({ nested: { [key]: 'leak' } }), `expected throw for key "${key}"`)
  }
})

test('assertNoAnswerLeak — throws on the camelCase isCorrect that attemptEngine actually emits', () => {
  // gradeAnswer returns { isCorrect, selectedOptionId, answerText }; spreading
  // that straight into a usuario response is the most likely real-world leak.
  assert.throws(() => assertNoAnswerLeak({ answer: { isCorrect: true, answerText: 'x' } }))
})

test('assertNoAnswerLeak — does NOT throw on a clean payload with only safe fields', () => {
  const payload = {
    attempt: { id: 'a1', status: 'completed' },
    questions: [{ id: 'q1', options: [{ id: 'o1', text: 'safe' }] }]
  }
  assert.doesNotThrow(() => assertNoAnswerLeak(payload))
})
