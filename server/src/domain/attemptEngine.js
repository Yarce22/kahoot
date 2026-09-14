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
      // An id that belongs to no option of THIS question is dropped, mirroring
      // the 'multiple' branch's validIds sanitation. selected_option_id is an
      // FK to answer_options at large, so a foreign id would satisfy the
      // constraint and corrupt that other question's per-option stats.
      selectedOptionId: option ? selectedOptionId : null,
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

// toValidDate — the shared date-coercion guard for this module. An unparseable
// date THROWS: every comparison against NaN is false, so the old behaviour
// silently answered "not late" and turned a corrupt/missing expires_at into a
// disabled cutoff — fail-open on exactly the check isAnswerLate exists to
// perform — while computeExpiry turned a missing started_at into an Invalid
// Date expiry that only blew up later, far from its cause.
//
// The NaN check ALONE is not enough: `new Date(null)` is epoch-0, a perfectly
// valid Date, so a null expires_at sailed through and made every answer late —
// scoring the attempt 0% — while a null started_at anchored the window in 1970.
// The accepted shapes are therefore allowlisted BEFORE coercion: a Date, an ISO
// string (what supabase-js returns for timestamptz), or an epoch number.
// Anything else — null, undefined, {}, [], true — is rejected outright.
function toValidDate(value, label) {
  const isCoercible =
    value instanceof Date ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))

  if (!isCoercible) {
    throw new Error(`invalid date for ${label} (${value})`)
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid date for ${label} (${value})`)
  }
  return date
}

// computeExpiry — started_at + time_budget_seconds, snapshotted at start so
// a mid-attempt quiz edit can neither shorten nor extend an in-flight
// attempt (spec: Async attempt bound by total_time_seconds).
//
// A non-positive or non-finite budget THROWS rather than silently producing a
// degenerate window: quizzes.total_time_seconds is nullable by design (NULL =
// not assignable async), and passing that through yielded expires_at ===
// started_at (every answer instantly late) or an Invalid Date.
//
// startedAt goes through the same guard, for the same reason: validating only
// the budget still let computeExpiry(undefined, 60) return an Invalid Date.
export function computeExpiry(startedAt, timeBudgetSeconds) {
  if (!Number.isFinite(timeBudgetSeconds) || timeBudgetSeconds <= 0) {
    throw new Error(`computeExpiry: time budget must be a positive finite number of seconds, got ${timeBudgetSeconds}`)
  }
  const start = toValidDate(startedAt, 'computeExpiry startedAt')
  return new Date(start.getTime() + timeBudgetSeconds * 1000)
}

// isAnswerLate — server-side truth for the countdown; the client's own timer
// is UX only and must never be trusted to enforce the cutoff.
export function isAnswerLate(answeredAt, expiresAt) {
  return toValidDate(answeredAt, 'isAnswerLate answeredAt') > toValidDate(expiresAt, 'isAnswerLate expiresAt')
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
