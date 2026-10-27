import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trueFalseOptions } from '../src/domain/trueFalse.js'

test('trueFalseOptions — labels are in Spanish, Verdadero first', () => {
  const rows = trueFalseOptions('q1', 'true')
  assert.deepEqual(rows, [
    { question_id: 'q1', text: 'Verdadero', is_correct: true },
    { question_id: 'q1', text: 'Falso', is_correct: false }
  ])
})

test('trueFalseOptions — correct_answer false marks Falso as correct', () => {
  const [verdadero, falso] = trueFalseOptions('q1', 'false')
  assert.equal(verdadero.is_correct, false)
  assert.equal(falso.is_correct, true)
})
