// attemptEngine.js — pure domain functions for async (PIN-less) quiz
// attempts. Zero I/O, zero socket/timer awareness — that is the whole
// reason this is not gameEngine.js, which owns the live-PIN-mode
// question-by-question timer loop.
//
// gradeAnswer reproduces the EXACT scoring semantics of
// sockets/index.js:147-169, minus every live-mode-only concept: no speed
// bonus, no first-correct +1 bonus. An async attempt is solo — both bonuses
// are meaningless without other players racing the same question.

import { evaluateMultipleAnswer } from './multipleChoice.js'
import { matchOpenAnswer } from './openAnswer.js'

// gradeAnswer — dispatches on question.type.
//
// `options` MUST be the ADMIN-scoped read including is_correct; it must
// never travel to a user-facing payload (see server/src/lib/userSerializer.js).
//
// Returns { isCorrect, selectedOptionId, answerText } ready to upsert into
// quiz_attempt_answers. isCorrect defaults to false (never null/undefined)
// since the column is NOT NULL.
export function gradeAnswer(question, options, submission = {}) {
  const { selectedOptionId, selectedOptionIds, answerText } = submission

  if ((question.type === 'closed' || question.type === 'true_false') && selectedOptionId) {
    const option = options.find((o) => o.id === selectedOptionId)
    return {
      isCorrect: option?.is_correct ?? false,
      selectedOptionId,
      answerText: null
    }
  }

  if (question.type === 'multiple') {
    // All-or-nothing: the picked set must match the correct set exactly —
    // no missing correct option, no extra incorrect one.
    const { picked, isCorrect } = evaluateMultipleAnswer(options, selectedOptionIds ?? [])
    // Guard the degenerate match: with no option flagged is_correct, an empty
    // submission compares an empty pick set against an empty correct set and
    // scores TRUE. A misconfigured question can never be answered correctly,
    // and answering nothing is never correct either.
    const hasCorrectOption = options.some((o) => o.is_correct)
    return {
      isCorrect: hasCorrectOption && picked.length > 0 && isCorrect,
      selectedOptionId: null,
      answerText: picked.length
        ? options.filter((o) => picked.includes(o.id)).map((o) => o.text).join(', ')
        : null
    }
  }

  if (question.type === 'open' && answerText) {
    // The correct option's TEXT holds the comma-separated required
    // keywords — matchOpenAnswer/multipleChoice.js are reused unmodified.
    const correctOption = options.find((o) => o.is_correct)
    return {
      isCorrect: correctOption ? matchOpenAnswer(answerText, correctOption.text) : false,
      selectedOptionId: null,
      answerText
    }
  }

  return { isCorrect: false, selectedOptionId: null, answerText: answerText ?? null }
}

// computeExpiry — started_at + time_budget_seconds, snapshotted at start so
// a mid-attempt quiz edit can neither shorten nor extend an in-flight
// attempt (spec: Async attempt bound by total_time_seconds).
export function computeExpiry(startedAt, timeBudgetSeconds) {
  return new Date(new Date(startedAt).getTime() + timeBudgetSeconds * 1000)
}

// isAnswerLate — server-side truth for the countdown; the client's own timer
// is UX only and must never be trusted to enforce the cutoff.
export function isAnswerLate(answeredAt, expiresAt) {
  return new Date(answeredAt) > new Date(expiresAt)
}

// gradeAttempt — aggregate. Late answers (answeredAt > expiresAt) are
// DISCARDED entirely: not counted wrong, not counted at all beyond
// totalQuestions (spec: Late answers discarded at expiry). No pass/fail
// verdict exists anywhere in the product — only these three numbers.
export function gradeAttempt({ questions, answers, expiresAt }) {
  const totalQuestions = questions.length
  const onTimeAnswers = answers.filter((a) => !isAnswerLate(a.answeredAt, expiresAt))
  const discardedCount = answers.length - onTimeAnswers.length
  const correctCount = onTimeAnswers.filter((a) => a.isCorrect).length
  const scorePercent = totalQuestions === 0 ? 0 : Math.round((correctCount / totalQuestions) * 100)

  return { totalQuestions, correctCount, scorePercent, discardedCount }
}

// resolveAttemptStatus — 'completed' on an explicit submit (regardless of
// expiry — a submit that lands right at the wire still counts), 'expired'
// when evaluated past expiresAt without one, otherwise 'in_progress'.
export function resolveAttemptStatus({ submittedAt, expiresAt, now }) {
  if (submittedAt) return 'completed'
  if (new Date(now) > new Date(expiresAt)) return 'expired'
  return 'in_progress'
}
