import { Router } from 'express'
import supabase from '../lib/supabase.js'
import { requireJwtMode } from '../middleware/jwtGate.js'
import { requireUserAuth } from '../middleware/requireUserAuth.js'
import { httpError } from '../lib/httpError.js'
import { isUniqueViolation, isNoRowsReturned } from '../lib/pgErrors.js'
import { SAFE_QUESTION_SELECT, serializeQuestionForUser } from '../lib/userSerializer.js'
import { gradeAnswer, computeExpiry, gradeAttempt, resolveAttemptStatus } from '../domain/attemptEngine.js'

export const userQuizzesRouter = Router()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ANSWER_TEXT_LENGTH = 500
// quiz_attempt_answers.time_taken_ms is an INT (INT4) column — anything past
// this is a Postgres 22003, not a large number.
const MAX_INT4 = 2147483647

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value)

// Same pagination convention as users.js / assignments.js / attempts.js.
// MAX_PAGE_SIZE doubles as the bound on the `.in('assignment_id', ...)`
// fan-out in GET /quizzes: the id set handed to that lookup is exactly one
// page of assignment ids, so it can never exceed this.
const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.page_size, 10) || DEFAULT_PAGE_SIZE))
  return { page, pageSize }
}

// This namespace has no legacy identity to fall back to — see requireJwtMode
// (design D3). Every route below requires AUTH_MODE=jwt and a usuario token.
userQuizzesRouter.use(requireJwtMode, requireUserAuth)

// serializeAttempt — the attempt sub-object attached to each GET /quizzes
// row and to the start-attempt response. Never spreads the raw row.
function serializeAttempt(a) {
  return {
    id: a.id,
    status: a.status,
    startedAt: a.started_at,
    expiresAt: a.expires_at,
    submittedAt: a.submitted_at,
    correctCount: a.correct_count,
    totalQuestions: a.total_questions,
    scorePercent: a.score_percent
  }
}

// GET /api/user/quizzes — the caller's own assignments only (scoped by
// req.user.id), each with its CURRENT-cycle attempt only — an older cycle's
// attempt belongs to that cycle's history, not this row's live state (spec:
// same "current-cycle attempt only" rule as GET /api/assignments).
userQuizzesRouter.get('/quizzes', async (req, res, next) => {
  const { page, pageSize } = parsePagination(req.query)
  const start = (page - 1) * pageSize

  // Paged server-side with `.range()` + `{ count: 'exact' }`, exactly as
  // assignments.js pages the equivalent admin-side list. Beyond the usual
  // unbounded-list concern, this list FEEDS the `.in('assignment_id', ...)`
  // lookup below, which PostgREST renders as a GET query STRING — without a
  // page bound that fan-out grew with the table and eventually blew past
  // gateway URL limits. Assignments are never deleted (a reactivation bumps
  // `cycle` in place), so a usuario's list only ever grows.
  const { data: assignments, error, count } = await supabase
    .from('quiz_assignments')
    .select('id, quiz_id, cycle, status, assigned_at, quiz:quizzes(id, title, description, total_time_seconds)', { count: 'exact' })
    .eq('user_id', req.user.id)
    .order('assigned_at', { ascending: false })
    // `.range` is inclusive on both ends, hence the -1.
    .range(start, start + pageSize - 1)

  if (error) return next(error)

  const rows = assignments ?? []
  const assignmentIds = rows.map((a) => a.id)

  let attemptByKey = {}
  if (assignmentIds.length) {
    const { data: attempts, error: attemptsError } = await supabase
      .from('quiz_attempts')
      .select('id, assignment_id, cycle, status, started_at, expires_at, submitted_at, correct_count, total_questions, score_percent')
      .in('assignment_id', assignmentIds)

    if (attemptsError) return next(attemptsError)

    for (const attempt of attempts ?? []) {
      attemptByKey[`${attempt.assignment_id}:${attempt.cycle}`] = attempt
    }
  }

  res.json({
    quizzes: rows.map((a) => {
      const attempt = attemptByKey[`${a.id}:${a.cycle}`] ?? null
      return {
        assignmentId: a.id,
        quizId: a.quiz_id,
        title: a.quiz?.title ?? null,
        description: a.quiz?.description ?? null,
        totalTimeSeconds: a.quiz?.total_time_seconds ?? null,
        status: a.status,
        cycle: a.cycle,
        assignedAt: a.assigned_at,
        attempt: attempt ? serializeAttempt(attempt) : null
      }
    }),
    page,
    page_size: pageSize,
    total: count ?? 0
  })
})

// buildQuestionsPayload — the questions array shared by both the 201 (new)
// and 200 (resume) branches below. Always goes through
// serializeQuestionForUser, which is what emits `options: []` for an open
// question (design D5's highest-risk leak vector: the correct answer's
// keyword CSV IS the text of an open question's is_correct option).
async function fetchSerializedQuestions(quizId) {
  const { data: questions, error } = await supabase
    .from('questions')
    .select(SAFE_QUESTION_SELECT)
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: true })

  if (error) throw error
  return (questions ?? []).map(serializeQuestionForUser)
}

// fetchGradingInputs — the two reads grading needs: the quiz's questions
// (their COUNT is total_questions, their text feeds buildAnswersDetail) and
// the attempt's recorded answers. Shared by the explicit submit and by the
// resume path's expiry finalization, so an attempt scores identically however
// it is finalized. Throws like fetchSerializedQuestions above; callers map it
// through next().
async function fetchGradingInputs(quizId, attemptId) {
  const { data: questions, error: questionsError } = await supabase
    .from('questions')
    .select('id, text')
    .eq('quiz_id', quizId)

  if (questionsError) throw questionsError

  const { data: answerRows, error: answersError } = await supabase
    .from('quiz_attempt_answers')
    .select('question_id, answer_text, is_correct, answered_at')
    .eq('attempt_id', attemptId)

  if (answersError) throw answersError

  return { questions: questions ?? [], answerRows: answerRows ?? [] }
}

// POST /api/user/quizzes/:assignmentId/attempt — start a new attempt, or
// idempotently resume the current-cycle one if it is already in_progress
// (design D7: resume-on-restart is a UX call, not a security one — the
// UNIQUE (assignment_id, cycle) constraint makes a second row impossible
// regardless).
userQuizzesRouter.post('/quizzes/:assignmentId/attempt', async (req, res, next) => {
  const { assignmentId } = req.params

  // quiz_assignments.id is a uuid column, so a malformed id reaches Postgres
  // as an UNCASTABLE literal (22P02), not PostgREST's no-rows signal — same
  // contract every other `:id` route in this codebase enforces before the
  // lookup.
  if (!isUuid(assignmentId)) return next(httpError(404, 'Assignment not found'))

  const { data: assignment, error: assignmentError } = await supabase
    .from('quiz_assignments')
    .select('id, quiz_id, user_id, cycle, status, quiz:quizzes(id, total_time_seconds)')
    .eq('id', assignmentId)
    .eq('user_id', req.user.id)
    .single()

  // Scoped by user_id in the query above already, so "not found" and "not
  // mine" collapse into the SAME 404 for free — no separate ownership check
  // needed, and no enumeration oracle either.
  if (isNoRowsReturned(assignmentError) || (!assignmentError && !assignment)) {
    return next(httpError(404, 'Assignment not found'))
  }
  if (assignmentError) return next(assignmentError)

  if (!assignment.quiz || assignment.quiz.total_time_seconds === null) {
    return next(httpError(409, 'QUIZ_NOT_ASSIGNABLE'))
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('quiz_attempts')
    .select('id, status, started_at, expires_at, time_budget_seconds')
    .eq('assignment_id', assignmentId)
    .eq('cycle', assignment.cycle)
    .limit(1)

  if (existingError) return next(existingError)
  const existing = existingRows?.[0]

  if (existing) {
    // 'expired' is checked BEFORE the generic branch: an attempt whose window
    // ran out was never completed, and reporting ATTEMPT_ALREADY_COMPLETED for
    // it contradicts the ATTEMPT_EXPIRED this same route returned when it
    // finalized that attempt moments earlier.
    if (existing.status === 'expired') {
      return next(httpError(409, 'ATTEMPT_EXPIRED'))
    }

    if (existing.status !== 'in_progress') {
      return next(httpError(409, 'ATTEMPT_ALREADY_COMPLETED'))
    }

    // Materialize expiry. 'expired' is a valid quiz_attempts.status per
    // migration 009's CHECK and a real branch of resolveAttemptStatus, but
    // nothing in the codebase ever WROTE it — so a long-past-due attempt
    // resumed happily and served its whole question payload, an abandoned
    // attempt stayed in_progress forever, and the admin
    // GET /api/attempts?status=expired filter could never match a row.
    //
    // resolveAttemptStatus owns the rule (no submit + past expires_at =
    // 'expired'); status === 'in_progress' here means submitted_at is null by
    // definition. An explicit SUBMIT deliberately still lands on 'completed'
    // even past the wire — that is the documented contract of the same
    // function, and late ANSWERS were already discarded by gradeAttempt.
    const now = new Date()
    if (resolveAttemptStatus({ submittedAt: null, expiresAt: existing.expires_at, now }) === 'expired') {
      // GRADE it, don't merely re-label it. A status flip on its own writes
      // 'expired' with NULL totals, and every other route in this flow —
      // submit, answers, and complete_quiz_attempt itself — requires
      // status='in_progress', so the attempt becomes unreachable: submit
      // answers ATTEMPT_ALREADY_SUBMITTED for something never submitted,
      // UNIQUE (assignment_id, cycle) blocks a fresh attempt, and the
      // assignment stays 'pending' forever with no recovery path but an admin
      // reactivation — the exact permanent "never took the quiz" outcome
      // migrations 009 and 013 exist to prevent. The work the usuario already
      // did is right there in quiz_attempt_answers; it gets scored.
      let graded
      try {
        const { questions, answerRows } = await fetchGradingInputs(assignment.quiz_id, existing.id)
        graded = gradeAttempt({
          questions,
          answers: answerRows.map((a) => ({ isCorrect: a.is_correct, answeredAt: a.answered_at })),
          expiresAt: existing.expires_at
        })
      } catch (err) {
        return next(err)
      }

      // The SAME transactional RPC submit uses (migrations 013 + 014), which
      // treats new_status as data rather than hardcoding 'completed'. It is
      // still gated on status='in_progress' inside the function, so a
      // concurrent submit that already finished the attempt cannot be
      // clobbered.
      //
      // new_status is 'expired', not 'completed': the usuario never submitted.
      // That literal is also what decides, inside the function, that
      // quiz_assignments is NOT touched (migration 014). An expiry finalizes
      // the ATTEMPT; it discharges no obligation, so the assignment stays
      // 'pending' on the admin roster — marking it completed reported a usuario
      // who abandoned the quiz with zero answers as having finished their
      // training. The admin still sees what happened through the
      // per-assignment attemptStatus GET /api/assignments derives from the
      // current-cycle attempt.
      //
      // new_submitted_at is null for the same reason. It only ever carried the
      // finalization instant to feed that assignment-side completed_at write,
      // and quiz_attempts.submitted_at is the record of an EXPLICIT submit:
      // resolveAttemptStatus treats any truthy submittedAt as 'completed', so
      // stamping it here would make the row contradict its own status column.
      //
      // target_cycle is assignment.cycle, which is exactly the attempt's own
      // cycle: the lookup above filtered on it.
      const { error: expireError } = await supabase.rpc('complete_quiz_attempt', {
        target_attempt_id: existing.id,
        target_user_id: req.user.id,
        target_cycle: assignment.cycle,
        new_status: 'expired',
        new_submitted_at: null,
        new_total_questions: graded.totalQuestions,
        new_correct_count: graded.correctCount,
        new_score_percent: graded.scorePercent
      })

      if (expireError) {
        // The RPC's conditional write matched nothing: between this route's
        // read and its write, something else moved the attempt off
        // 'in_progress' — in practice a concurrent submit, which now owns a
        // real score. Answering ATTEMPT_EXPIRED anyway would be factually
        // wrong, so the current status is re-read and reported for what it is.
        // Same text-matching pattern as the submit route's mapping of this
        // exception.
        const text = `${expireError.message ?? ''} ${expireError.details ?? ''} ${expireError.hint ?? ''}`
        if (!text.includes('attempt_not_in_progress')) return next(expireError)

        const { data: current, error: rereadError } = await supabase
          .from('quiz_attempts')
          .select('status')
          .eq('id', existing.id)
          .eq('user_id', req.user.id)
          .single()

        // Same `.single()` contract as every other lookup in this file: zero
        // rows arrives as an ERROR, not as `{ data: null, error: null }`, and
        // the honest answer is this file's usual 404 rather than a raw 500
        // carrying the Postgres message.
        if (isNoRowsReturned(rereadError) || (!rereadError && !current)) {
          return next(httpError(404, 'Attempt not found'))
        }
        if (rereadError) return next(rereadError)

        if (current.status === 'completed') return next(httpError(409, 'ATTEMPT_ALREADY_COMPLETED'))
        // Another request finalized the same expiry first.
        if (current.status === 'expired') return next(httpError(409, 'ATTEMPT_EXPIRED'))
        // Anything else — 'in_progress' in particular — means the RPC's guard
        // (id AND user_id AND cycle AND status='in_progress') failed for some
        // OTHER reason than the status having moved, e.g. a user_id or cycle
        // mismatch. Claiming an expiry there reports something that did not
        // happen, so the original exception is surfaced for what it is.
        return next(expireError)
      }

      return next(httpError(409, 'ATTEMPT_EXPIRED'))
    }

    // Resume: identical payload shape to a fresh start, 200 instead of 201.
    let questions
    try {
      questions = await fetchSerializedQuestions(assignment.quiz_id)
    } catch (err) {
      return next(err)
    }

    return res.status(200).json({
      attempt: {
        id: existing.id,
        startedAt: existing.started_at,
        expiresAt: existing.expires_at,
        timeBudgetSeconds: existing.time_budget_seconds
      },
      questions
    })
  }

  const startedAt = new Date()
  let expiresAt
  try {
    expiresAt = computeExpiry(startedAt, assignment.quiz.total_time_seconds)
  } catch (err) {
    return next(err)
  }

  const { data: created, error: createError } = await supabase
    .from('quiz_attempts')
    .insert({
      assignment_id: assignmentId,
      quiz_id: assignment.quiz_id,
      user_id: req.user.id,
      cycle: assignment.cycle,
      status: 'in_progress',
      time_budget_seconds: assignment.quiz.total_time_seconds,
      started_at: startedAt.toISOString(),
      expires_at: expiresAt.toISOString()
    })
    .select('id, started_at, expires_at, time_budget_seconds')
    .single()

  if (createError) {
    // A concurrent double-start races on the SAME (assignment_id, cycle)
    // this route just checked was free — the UNIQUE constraint from
    // migration 009 is the actual source of truth, this check above is only
    // an optimization to avoid the round trip in the common case.
    if (isUniqueViolation(createError)) return next(httpError(409, 'ATTEMPT_ALREADY_COMPLETED'))
    return next(createError)
  }

  let questions
  try {
    questions = await fetchSerializedQuestions(assignment.quiz_id)
  } catch (err) {
    return next(err)
  }

  res.status(201).json({
    attempt: {
      id: created.id,
      startedAt: created.started_at,
      expiresAt: created.expires_at,
      timeBudgetSeconds: created.time_budget_seconds
    },
    questions
  })
})

// POST /api/user/attempts/:id/answers — per-answer upsert on
// (attempt_id, question_id) (design D7: incremental recording, submit only
// aggregates). Graded server-side via attemptEngine.gradeAnswer; correctness
// is NEVER returned to the caller (spec: Structural No-Leak).
userQuizzesRouter.post('/attempts/:id/answers', async (req, res, next) => {
  const { id } = req.params
  const { questionId, selectedOptionId, selectedOptionIds, answerText, timeTakenMs } = req.body ?? {}

  // quiz_attempts.id is a uuid column — same 22P02-avoidance contract every
  // other `:id` route in this codebase enforces before the lookup.
  if (!isUuid(id)) return next(httpError(404, 'Attempt not found'))

  if (!isUuid(questionId)) return next(httpError(400, 'questionId must be a UUID'))

  // Mirrors sockets/index.js:130's length guard, checked before any DB work
  // for the same reason it is checked first there.
  if (answerText !== undefined && answerText !== null) {
    if (typeof answerText !== 'string' || answerText.length > MAX_ANSWER_TEXT_LENGTH) {
      return next(httpError(400, `answerText must be a string of at most ${MAX_ANSWER_TEXT_LENGTH} characters`))
    }
  }

  // selectedOptionIds feeds evaluateMultipleAnswer, which calls array methods
  // on it: a bare string (or an object, or a number) threw a TypeError deep
  // inside the domain layer and surfaced as an uncontrolled 500. An EMPTY
  // array stays valid — a 'multiple' question answered with nothing picked is
  // a legitimate submission that attemptEngine deliberately scores false.
  //
  // Each element must be UUID-shaped for the same reason questionId is: they
  // are compared against answer_options.id, a uuid column, and the winning one
  // is written to selected_option_id, an FK to it.
  if (selectedOptionIds !== undefined && selectedOptionIds !== null) {
    if (!Array.isArray(selectedOptionIds) || !selectedOptionIds.every(isUuid)) {
      return next(httpError(400, 'selectedOptionIds must be an array of UUIDs'))
    }
  }

  if (selectedOptionId !== undefined && selectedOptionId !== null && !isUuid(selectedOptionId)) {
    return next(httpError(400, 'selectedOptionId must be a UUID'))
  }

  // time_taken_ms is an INT column that was taking an arbitrary client-supplied
  // JSON value verbatim: a string or object is a Postgres 22P02, a value past
  // INT4's range is a 22003 — both uncontrolled 500s — and a negative number is
  // silently stored garbage.
  //
  // Validated, NOT derived server-side. The live-PIN flow can compute elapsed
  // time itself (sockets/index.js reads game.questionStartedAt) because the
  // server drives that question loop; the async flow has no equivalent state.
  // A usuario receives every question at once from the start-attempt payload
  // and may answer them in any order, so nothing in this handler's scope knows
  // when THIS question was presented. Deriving from the attempt's started_at
  // would silently redefine the column as elapsed-attempt time, a different
  // metric under the same name — worse than an honest client-reported value.
  // The value stays client-forgeable; it is a UX telemetry field, and no
  // scoring depends on it (gradeAttempt reads answered_at, which IS
  // server-stamped).
  if (timeTakenMs !== undefined && timeTakenMs !== null) {
    const isStorableInt = Number.isSafeInteger(timeTakenMs) && timeTakenMs >= 0 && timeTakenMs <= MAX_INT4
    if (!isStorableInt) {
      return next(httpError(400, `timeTakenMs must be an integer between 0 and ${MAX_INT4}`))
    }
  }

  const { data: attempt, error: attemptError } = await supabase
    .from('quiz_attempts')
    .select('id, quiz_id, user_id, status, expires_at')
    .eq('id', id)
    .eq('user_id', req.user.id)
    .single()

  // Scoped by user_id already, so "not found" and "not mine" collapse into
  // the SAME 404 — no separate ownership check, no enumeration oracle.
  if (isNoRowsReturned(attemptError) || (!attemptError && !attempt)) {
    return next(httpError(404, 'Attempt not found'))
  }
  if (attemptError) return next(attemptError)

  if (attempt.status !== 'in_progress') {
    return next(httpError(409, 'ATTEMPT_NOT_IN_PROGRESS'))
  }

  // ONE timestamp for both the gate below and the answered_at stamp written
  // further down. Reading the clock twice, with two DB round trips in between,
  // let an answer pass the gate and still be recorded AFTER expires_at — and
  // gradeAttempt then silently drops it from correctCount while
  // buildAnswersDetail (which reads the unfiltered rows) still renders it with
  // isCorrect: true. The checkmarks and the total contradicted each other.
  // Accept-the-write and count-toward-the-score must be decided against the
  // same instant.
  const answeredAt = new Date()

  if (answeredAt > new Date(attempt.expires_at)) {
    return next(httpError(409, 'ATTEMPT_EXPIRED'))
  }

  const { data: question, error: questionError } = await supabase
    .from('questions')
    .select('id, quiz_id, type')
    .eq('id', questionId)
    .eq('quiz_id', attempt.quiz_id)
    .single()

  if (isNoRowsReturned(questionError) || (!questionError && !question)) {
    return next(httpError(404, 'Question not found'))
  }
  if (questionError) return next(questionError)

  // Admin-scoped read INCLUDING is_correct — grading needs it, but it must
  // never travel any further than this handler's local scope (design D5).
  const { data: options, error: optionsError } = await supabase
    .from('answer_options')
    .select('id, text, is_correct')
    .eq('question_id', questionId)

  if (optionsError) return next(optionsError)

  const graded = gradeAnswer(question, options ?? [], { selectedOptionId, selectedOptionIds, answerText })

  const { error: upsertError } = await supabase
    .from('quiz_attempt_answers')
    .upsert({
      attempt_id: id,
      question_id: questionId,
      answer_text: graded.answerText,
      selected_option_id: graded.selectedOptionId,
      is_correct: graded.isCorrect,
      time_taken_ms: timeTakenMs ?? null,
      // The SAME instant the expiry gate above approved this write against.
      answered_at: answeredAt.toISOString()
    }, { onConflict: 'attempt_id,question_id' })

  if (upsertError) return next(upsertError)

  res.json({ recorded: true })
})

// buildAnswersDetail — shared by submit and GET result: joins the recorded
// answers with question text. Deliberately NEVER includes the correct
// option's identifier or text (unlike the admin-facing GET /api/attempts/:id,
// which legitimately does) — spec: Result payload has no correct-answer
// data. isCorrect IS included: it is the caller's OWN answer's verdict, not
// an option-level `is_correct` — the one deliberate exception userSerializer
// (design D5) documents as legitimate for a usuario's own result.
function buildAnswersDetail(questions, answers) {
  const textByQuestionId = Object.fromEntries((questions ?? []).map((q) => [q.id, q.text]))
  return (answers ?? []).map((a) => ({
    questionId: a.question_id,
    questionText: textByQuestionId[a.question_id] ?? null,
    answerText: a.answer_text,
    isCorrect: a.is_correct
  }))
}

// POST /api/user/attempts/:id/submit — aggregates via attemptEngine.gradeAttempt,
// persists the totals + 'completed' status on quiz_attempts, and marks the
// assignment status='completed'. An explicit submit is ALWAYS 'completed'
// regardless of expiry (attemptEngine.resolveAttemptStatus: "a submit that
// lands right at the wire still counts") — late ANSWERS were already
// rejected by POST /answers, so this is defense-in-depth, not the primary
// enforcement point.
userQuizzesRouter.post('/attempts/:id/submit', async (req, res, next) => {
  const { id } = req.params

  if (!isUuid(id)) return next(httpError(404, 'Attempt not found'))

  const { data: attempt, error: attemptError } = await supabase
    .from('quiz_attempts')
    .select('id, assignment_id, quiz_id, cycle, status, expires_at, submitted_at')
    .eq('id', id)
    .eq('user_id', req.user.id)
    .single()

  if (isNoRowsReturned(attemptError) || (!attemptError && !attempt)) {
    return next(httpError(404, 'Attempt not found'))
  }
  if (attemptError) return next(attemptError)

  // 'expired' is checked BEFORE the generic branch, exactly as the resume path
  // checks it: the attempt whose window ran out was never submitted (its
  // submitted_at is NULL), so ATTEMPT_ALREADY_SUBMITTED is factually wrong and
  // contradicts the ATTEMPT_EXPIRED the resume route reports for the SAME row.
  if (attempt.status === 'expired') {
    return next(httpError(409, 'ATTEMPT_EXPIRED'))
  }

  if (attempt.status !== 'in_progress') {
    return next(httpError(409, 'ATTEMPT_ALREADY_SUBMITTED'))
  }

  let questions
  let answerRows
  try {
    ;({ questions, answerRows } = await fetchGradingInputs(attempt.quiz_id, id))
  } catch (err) {
    return next(err)
  }

  const graded = gradeAttempt({
    questions,
    answers: answerRows.map((a) => ({ isCorrect: a.is_correct, answeredAt: a.answered_at })),
    expiresAt: attempt.expires_at
  })

  const submittedAt = new Date()
  const status = resolveAttemptStatus({ submittedAt, expiresAt: attempt.expires_at, now: submittedAt })

  // ONE RPC, not two sequential `.update()` calls. Completing an attempt
  // writes both quiz_attempts and quiz_assignments, and supabase-js has no
  // client-side transaction: a failure between the two left the attempt
  // durably 'completed' while the assignment stayed 'pending', and the
  // client's own retry was then rejected by the first write's
  // ATTEMPT_ALREADY_SUBMITTED guard — no recovery path at all. Same fix, same
  // shape as reactivate_quiz_assignments (migration 009) and
  // update_admin_role_status (005); see migration 013.
  //
  // target_cycle carries the ATTEMPT'S OWN cycle, which is what scopes the
  // assignment write inside the function. Migration 009's reactivation
  // contract says in-progress attempts are intentionally not force-expired:
  // they keep their old cycle and finish normally. Without that scope,
  // submitting a cycle-1 attempt after an admin reactivated the quiz marked
  // the CURRENT (cycle-2) assignment completed — a compliance-critical false
  // positive on the admin roster for a cycle the usuario never took.
  const { error: completeError } = await supabase.rpc('complete_quiz_attempt', {
    target_attempt_id: id,
    target_user_id: req.user.id,
    target_cycle: attempt.cycle,
    new_status: status,
    new_submitted_at: submittedAt.toISOString(),
    new_total_questions: graded.totalQuestions,
    new_correct_count: graded.correctCount,
    new_score_percent: graded.scorePercent
  })

  if (completeError) {
    // The function's no-rows-updated case: a concurrent submit won the race.
    // Reported exactly as this route's own pre-check reports it. Same
    // text-matching pattern as assignments.js' quiz_not_found mapping.
    const text = `${completeError.message ?? ''} ${completeError.details ?? ''} ${completeError.hint ?? ''}`
    if (text.includes('attempt_not_in_progress')) return next(httpError(409, 'ATTEMPT_ALREADY_SUBMITTED'))
    return next(completeError)
  }

  res.json({
    result: {
      attemptId: id,
      status,
      totalQuestions: graded.totalQuestions,
      correctCount: graded.correctCount,
      scorePercent: graded.scorePercent,
      submittedAt: submittedAt.toISOString(),
      answers: buildAnswersDetail(questions, answerRows)
    }
  })
})

// GET /api/user/attempts/:id/result — read-only. 409 while the attempt is
// still in_progress (must submit first, per POST /submit above) rather than
// lazily grading on a GET — a GET must not have side effects.
userQuizzesRouter.get('/attempts/:id/result', async (req, res, next) => {
  const { id } = req.params

  if (!isUuid(id)) return next(httpError(404, 'Attempt not found'))

  const { data: attempt, error: attemptError } = await supabase
    .from('quiz_attempts')
    .select('id, quiz_id, status, total_questions, correct_count, score_percent, submitted_at')
    .eq('id', id)
    .eq('user_id', req.user.id)
    .single()

  if (isNoRowsReturned(attemptError) || (!attemptError && !attempt)) {
    return next(httpError(404, 'Attempt not found'))
  }
  if (attemptError) return next(attemptError)

  if (attempt.status === 'in_progress') {
    return next(httpError(409, 'ATTEMPT_STILL_IN_PROGRESS'))
  }

  const { data: questions, error: questionsError } = await supabase
    .from('questions')
    .select('id, text')
    .eq('quiz_id', attempt.quiz_id)

  if (questionsError) return next(questionsError)

  const { data: answerRows, error: answersError } = await supabase
    .from('quiz_attempt_answers')
    .select('question_id, answer_text, is_correct, answered_at')
    .eq('attempt_id', id)

  if (answersError) return next(answersError)

  res.json({
    result: {
      attemptId: attempt.id,
      status: attempt.status,
      totalQuestions: attempt.total_questions,
      correctCount: attempt.correct_count,
      scorePercent: attempt.score_percent,
      submittedAt: attempt.submitted_at,
      answers: buildAnswersDetail(questions, answerRows)
    }
  })
})
