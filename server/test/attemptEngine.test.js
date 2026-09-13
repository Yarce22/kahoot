import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  gradeAnswer,
  computeExpiry,
  isAnswerLate,
  gradeAttempt,
  resolveAttemptStatus
} from '../src/domain/attemptEngine.js'

// ---- gradeAnswer ----

test('gradeAnswer — closed question: correct option scores true and records selectedOptionId', () => {
  const question = { id: 'q1', type: 'closed' }
  const options = [
    { id: 'o1', text: 'Yes', is_correct: true },
    { id: 'o2', text: 'No', is_correct: false }
  ]
  const result = gradeAnswer(question, options, { selectedOptionId: 'o1' })
  assert.equal(result.isCorrect, true)
  assert.equal(result.selectedOptionId, 'o1')
  assert.equal(result.answerText, null)
})

test('gradeAnswer — closed question: wrong option scores false', () => {
  const question = { id: 'q1', type: 'closed' }
  const options = [
    { id: 'o1', text: 'Yes', is_correct: true },
    { id: 'o2', text: 'No', is_correct: false }
  ]
  const result = gradeAnswer(question, options, { selectedOptionId: 'o2' })
  assert.equal(result.isCorrect, false)
})

// quiz_attempt_answers.selected_option_id is an FK to answer_options at
// large, NOT scoped to this question — so an id borrowed from another
// question/quiz satisfies the constraint and lands in the per-option stats.
// The 'multiple' branch already sanitizes via validIds; this one must too.
test('gradeAnswer — closed question: an id not among this question options is nulled out, not persisted', () => {
  const question = { id: 'q1', type: 'closed' }
  const options = [
    { id: 'o1', text: 'Yes', is_correct: true },
    { id: 'o2', text: 'No', is_correct: false }
  ]
  const result = gradeAnswer(question, options, { selectedOptionId: 'option-from-another-quiz' })
  assert.equal(result.isCorrect, false)
  assert.equal(result.selectedOptionId, null)
})

test('gradeAnswer — true_false question: a foreign option id is nulled out too', () => {
  const question = { id: 'q4', type: 'true_false' }
  const options = [
    { id: 't1', text: 'True', is_correct: true },
    { id: 'f1', text: 'False', is_correct: false }
  ]
  const result = gradeAnswer(question, options, { selectedOptionId: 'f-from-elsewhere' })
  assert.equal(result.isCorrect, false)
  assert.equal(result.selectedOptionId, null)
})

test('gradeAnswer — multiple question: exact correct set scores true, all-or-nothing', () => {
  const question = { id: 'q2', type: 'multiple' }
  const options = [
    { id: 'a', text: 'A', is_correct: true },
    { id: 'b', text: 'B', is_correct: false },
    { id: 'c', text: 'C', is_correct: true }
  ]
  const result = gradeAnswer(question, options, { selectedOptionIds: ['a', 'c'] })
  assert.equal(result.isCorrect, true)
  assert.equal(result.selectedOptionId, null)
  assert.equal(result.answerText, 'A, C')
})

test('gradeAnswer — multiple question: missing a correct option fails', () => {
  const question = { id: 'q2', type: 'multiple' }
  const options = [
    { id: 'a', text: 'A', is_correct: true },
    { id: 'b', text: 'B', is_correct: false },
    { id: 'c', text: 'C', is_correct: true }
  ]
  const result = gradeAnswer(question, options, { selectedOptionIds: ['a'] })
  assert.equal(result.isCorrect, false)
})

// A question whose options are ALL is_correct: false is misconfigured; the
// naive set comparison scores an empty submission against an empty correct
// set as a match (0 === 0, and [].every is vacuously true), handing a free
// point to someone who answered nothing.
test('gradeAnswer — multiple question with ZERO correct options and an empty submission is NOT correct', () => {
  const question = { id: 'q2', type: 'multiple' }
  const options = [
    { id: 'a', text: 'A', is_correct: false },
    { id: 'b', text: 'B', is_correct: false }
  ]
  const result = gradeAnswer(question, options, {})
  assert.equal(result.isCorrect, false)
})

test('gradeAnswer — multiple question with ZERO correct options is never correct, whatever is picked', () => {
  const question = { id: 'q2', type: 'multiple' }
  const options = [{ id: 'a', text: 'A', is_correct: false }]
  assert.equal(gradeAnswer(question, options, { selectedOptionIds: ['a'] }).isCorrect, false)
})

test('gradeAnswer — multiple question with real correct options but an empty submission is NOT correct', () => {
  const question = { id: 'q2', type: 'multiple' }
  const options = [
    { id: 'a', text: 'A', is_correct: true },
    { id: 'b', text: 'B', is_correct: false }
  ]
  const result = gradeAnswer(question, options, { selectedOptionIds: [] })
  assert.equal(result.isCorrect, false)
})

test('gradeAnswer — open question: keyword-CSV path matches via matchOpenAnswer (reused unmodified)', () => {
  const question = { id: 'q3', type: 'open' }
  const options = [{ id: 'o1', text: 'lechuga, tomate, cebolla', is_correct: true }]
  const result = gradeAnswer(question, options, { answerText: 'Ensalada con lechuga, tomate y cebolla' })
  assert.equal(result.isCorrect, true)
  assert.equal(result.selectedOptionId, null)
  assert.equal(result.answerText, 'Ensalada con lechuga, tomate y cebolla')
})

test('gradeAnswer — open question: missing a required keyword fails', () => {
  const question = { id: 'q3', type: 'open' }
  const options = [{ id: 'o1', text: 'lechuga, tomate, cebolla', is_correct: true }]
  const result = gradeAnswer(question, options, { answerText: 'Ensalada con lechuga y tomate' })
  assert.equal(result.isCorrect, false)
})

test('gradeAnswer — no submission at all defaults to isCorrect: false (never null)', () => {
  const question = { id: 'q1', type: 'closed' }
  const options = [{ id: 'o1', text: 'Yes', is_correct: true }]
  const result = gradeAnswer(question, options, {})
  assert.equal(result.isCorrect, false)
})

// ---- computeExpiry ----

test('computeExpiry — adds timeBudgetSeconds to startedAt', () => {
  const started = new Date('2026-01-01T00:00:00.000Z')
  const expiry = computeExpiry(started, 600)
  assert.equal(expiry.toISOString(), '2026-01-01T00:10:00.000Z')
})

test('computeExpiry — different budget produces a different expiry (triangulation)', () => {
  const started = new Date('2026-01-01T00:00:00.000Z')
  const expiry = computeExpiry(started, 60)
  assert.equal(expiry.toISOString(), '2026-01-01T00:01:00.000Z')
})

// quizzes.total_time_seconds is nullable by design (NULL = not assignable
// async), so a bad budget CAN reach here — and silently produced a
// zero-length window (null -> expires_at === started_at, every answer late)
// or an Invalid Date (undefined). Both must be loud failures.
test('computeExpiry — throws on a null time budget instead of a zero-length window', () => {
  assert.throws(() => computeExpiry(new Date('2026-01-01T00:00:00.000Z'), null), /time budget/i)
})

test('computeExpiry — throws on an undefined time budget instead of an Invalid Date', () => {
  assert.throws(() => computeExpiry(new Date('2026-01-01T00:00:00.000Z'), undefined), /time budget/i)
})

test('computeExpiry — throws on a zero time budget', () => {
  assert.throws(() => computeExpiry(new Date('2026-01-01T00:00:00.000Z'), 0), /time budget/i)
})

test('computeExpiry — throws on a negative time budget', () => {
  assert.throws(() => computeExpiry(new Date('2026-01-01T00:00:00.000Z'), -60), /time budget/i)
})

test('computeExpiry — throws on a non-finite time budget', () => {
  assert.throws(() => computeExpiry(new Date('2026-01-01T00:00:00.000Z'), Infinity), /time budget/i)
  assert.throws(() => computeExpiry(new Date('2026-01-01T00:00:00.000Z'), NaN), /time budget/i)
})

// startedAt is the OTHER half of the window and was never validated: an
// unparseable or missing value produced an Invalid Date expiry, which then made
// every isAnswerLate comparison against it throw (or, worse, silently pass)
// far away from the call that actually caused it.
test('computeExpiry — throws on an undefined startedAt instead of an Invalid Date', () => {
  assert.throws(() => computeExpiry(undefined, 60), /invalid date/i)
})

test('computeExpiry — throws on an unparseable startedAt', () => {
  assert.throws(() => computeExpiry('not-a-date', 60), /invalid date/i)
})

test('computeExpiry — throws on an Invalid Date startedAt', () => {
  assert.throws(() => computeExpiry(new Date(NaN), 60), /invalid date/i)
})

test('computeExpiry — still names the offending argument', () => {
  assert.throws(() => computeExpiry('not-a-date', 60), /startedAt/)
})

// ---- isAnswerLate ----

test('isAnswerLate — true when answeredAt is after expiresAt', () => {
  const expiresAt = new Date('2026-01-01T00:10:00.000Z')
  assert.equal(isAnswerLate(new Date('2026-01-01T00:10:01.000Z'), expiresAt), true)
})

test('isAnswerLate — false when answeredAt is before expiresAt', () => {
  const expiresAt = new Date('2026-01-01T00:10:00.000Z')
  assert.equal(isAnswerLate(new Date('2026-01-01T00:09:59.000Z'), expiresAt), false)
})

// Any comparison against NaN is false, so an invalid date silently reported
// "not late" and disabled the server-side cutoff this module exists to
// enforce. A malformed date here is a data-integrity bug, not a valid answer.
test('isAnswerLate — throws on an invalid expiresAt instead of reporting "not late"', () => {
  assert.throws(() => isAnswerLate('2030-01-01T00:00:00Z', new Date(NaN)), /invalid date/i)
})

test('isAnswerLate — throws on an invalid answeredAt', () => {
  assert.throws(() => isAnswerLate('not-a-date', new Date('2026-01-01T00:10:00.000Z')), /invalid date/i)
})

test('isAnswerLate — throws on a null expiresAt', () => {
  assert.throws(() => isAnswerLate(new Date('2026-01-01T00:00:00.000Z'), undefined), /invalid date/i)
})

// ---- gradeAttempt ----

test('gradeAttempt — computes correctCount/scorePercent, rounding to nearest integer', () => {
  const expiresAt = new Date('2026-01-01T01:00:00.000Z')
  const questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }]
  const answers = [
    { questionId: 'q1', isCorrect: true, answeredAt: new Date('2026-01-01T00:01:00.000Z') },
    { questionId: 'q2', isCorrect: false, answeredAt: new Date('2026-01-01T00:02:00.000Z') },
    { questionId: 'q3', isCorrect: true, answeredAt: new Date('2026-01-01T00:03:00.000Z') }
  ]
  const result = gradeAttempt({ questions, answers, expiresAt })
  assert.equal(result.totalQuestions, 3)
  assert.equal(result.correctCount, 2)
  assert.equal(result.scorePercent, 67) // 2/3 = 66.66... rounds to 67
  assert.equal(result.discardedCount, 0)
})

test('gradeAttempt — zero questions scores 0%, not NaN/division-by-zero', () => {
  const expiresAt = new Date('2026-01-01T01:00:00.000Z')
  const result = gradeAttempt({ questions: [], answers: [], expiresAt })
  assert.equal(result.totalQuestions, 0)
  assert.equal(result.correctCount, 0)
  assert.equal(result.scorePercent, 0)
})

test('gradeAttempt — late answers (answeredAt > expiresAt) are discarded: not counted correct, not counted at all', () => {
  const expiresAt = new Date('2026-01-01T00:10:00.000Z')
  const questions = [{ id: 'q1' }, { id: 'q2' }]
  const answers = [
    { questionId: 'q1', isCorrect: true, answeredAt: new Date('2026-01-01T00:05:00.000Z') },
    { questionId: 'q2', isCorrect: true, answeredAt: new Date('2026-01-01T00:15:00.000Z') } // late
  ]
  const result = gradeAttempt({ questions, answers, expiresAt })
  assert.equal(result.totalQuestions, 2)
  assert.equal(result.correctCount, 1)
  assert.equal(result.discardedCount, 1)
})

test('gradeAttempt — result has no pass/fail verdict field of any kind', () => {
  const expiresAt = new Date('2026-01-01T01:00:00.000Z')
  const result = gradeAttempt({ questions: [{ id: 'q1' }], answers: [], expiresAt })
  assert.equal('passed' in result, false)
  assert.equal('verdict' in result, false)
})

// ---- resolveAttemptStatus ----

test('resolveAttemptStatus — "completed" when submittedAt is set, regardless of expiry', () => {
  const status = resolveAttemptStatus({
    submittedAt: new Date('2026-01-01T00:05:00.000Z'),
    expiresAt: new Date('2026-01-01T00:10:00.000Z'),
    now: new Date('2026-01-01T00:20:00.000Z')
  })
  assert.equal(status, 'completed')
})

test('resolveAttemptStatus — "expired" when past expiresAt without an explicit submit', () => {
  const status = resolveAttemptStatus({
    submittedAt: null,
    expiresAt: new Date('2026-01-01T00:10:00.000Z'),
    now: new Date('2026-01-01T00:20:00.000Z')
  })
  assert.equal(status, 'expired')
})
