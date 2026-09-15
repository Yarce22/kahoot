import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Mirrors src/index.js:2 — without it an async throw inside a route handler
// never reaches errorHandler, so a crash-class bug hangs the request instead
// of surfacing as a clean 500.
import 'express-async-errors'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.AUTH_MODE = 'jwt'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { userQuizzesRouter } = await import('../src/routes/userQuizzes.js')
const { errorHandler } = await import('../src/middleware/errorHandler.js')
const { signToken } = await import('../src/lib/jwt.js')
const { default: request } = await import('supertest')

// Standalone app — userQuizzesRouter is not mounted in src/index.js until
// Phase 8 (task 8.1) of this same PR3 batch.
function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/user', userQuizzesRouter)
  app.use(errorHandler)
  return app
}

const USER = { id: 'user-1', email: 'u@example.com', full_name: 'Ana Usuaria', punto_de_venta: 'Cerritos', is_active: true }
const userToken = () => signToken({ sub: USER.id, email: USER.email, aud: 'usuario' })

// --- GET /quizzes (task 7.1) ---

test('GET /api/user/quizzes — an admin-audience token is rejected 401', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const adminToken = signToken({ sub: 'admin-1', email: 'a@example.com' })
    const res = await request(buildApp()).get('/api/user/quizzes').set('Authorization', `Bearer ${adminToken}`)
    assert.equal(res.status, 401)
    assert.deepEqual(restore.calls, [])
  } finally {
    restore()
  }
})

test('GET /api/user/quizzes — returns only the caller\'s own assignments', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } }, // requireUserAuth
    {
      table: 'quiz_assignments',
      result: {
        data: [
          {
            id: 'assign-1',
            quiz_id: 'quiz-1',
            cycle: 1,
            status: 'pending',
            assigned_at: '2026-01-01T00:00:00.000Z',
            quiz: { id: 'quiz-1', title: 'Quiz 1', description: 'desc', total_time_seconds: 600 }
          }
        ],
        error: null
      }
    },
    { table: 'quiz_attempts', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp()).get('/api/user/quizzes').set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.quizzes.length, 1)
    assert.deepEqual(res.body.quizzes[0], {
      assignmentId: 'assign-1',
      quizId: 'quiz-1',
      title: 'Quiz 1',
      description: 'desc',
      totalTimeSeconds: 600,
      status: 'pending',
      cycle: 1,
      assignedAt: '2026-01-01T00:00:00.000Z',
      attempt: null
    })
    const eqCall = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'eq')
    assert.deepEqual(eqCall.args, ['user_id', USER.id])
  } finally {
    restore()
  }
})

// The "current-cycle attempt only" rule: an assignment reactivated to cycle 2
// must not surface a stale cycle-1 attempt as its current attempt.
test('GET /api/user/quizzes — only the CURRENT-cycle attempt is attached, not a prior cycle\'s', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: {
        data: [
          {
            id: 'assign-1',
            quiz_id: 'quiz-1',
            cycle: 2,
            status: 'pending',
            assigned_at: '2026-01-01T00:00:00.000Z',
            quiz: { id: 'quiz-1', title: 'Quiz 1', description: null, total_time_seconds: 600 }
          }
        ],
        error: null
      }
    },
    {
      table: 'quiz_attempts',
      result: {
        data: [
          { id: 'attempt-old', assignment_id: 'assign-1', cycle: 1, status: 'completed', started_at: 'x', expires_at: 'y', submitted_at: 'z', correct_count: 3, total_questions: 4, score_percent: 75 }
        ],
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp()).get('/api/user/quizzes').set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.quizzes[0].attempt, null)
  } finally {
    restore()
  }
})

test('GET /api/user/quizzes — attaches the current-cycle attempt when one exists', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: {
        data: [
          {
            id: 'assign-1',
            quiz_id: 'quiz-1',
            cycle: 1,
            status: 'pending',
            assigned_at: '2026-01-01T00:00:00.000Z',
            quiz: { id: 'quiz-1', title: 'Quiz 1', description: null, total_time_seconds: 600 }
          }
        ],
        error: null
      }
    },
    {
      table: 'quiz_attempts',
      result: {
        data: [
          { id: 'attempt-1', assignment_id: 'assign-1', cycle: 1, status: 'in_progress', started_at: 'a', expires_at: 'b', submitted_at: null, correct_count: null, total_questions: null, score_percent: null }
        ],
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp()).get('/api/user/quizzes').set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.quizzes[0].attempt, {
      id: 'attempt-1',
      status: 'in_progress',
      startedAt: 'a',
      expiresAt: 'b',
      submittedAt: null,
      correctCount: null,
      totalQuestions: null,
      scorePercent: null
    })
  } finally {
    restore()
  }
})

test('GET /api/user/quizzes — no assignments skips the attempts lookup entirely', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_assignments', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp()).get('/api/user/quizzes').set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.quizzes, [])
    assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts'), false)
  } finally {
    restore()
  }
})

// The assignment read was unbounded, and its (unbounded) id list then fed the
// `.in('assignment_id', ...)` attempts fan-out — the exact pattern PR2's
// assignments.js caps at MAX_PAGE_SIZE because PostgREST renders `.in()` as a
// GET query string that can exceed gateway URL limits. Assignments are never
// deleted (reactivation bumps `cycle` in place), so this grows monotonically
// for the life of a usuario's account.
test('GET /api/user/quizzes — the assignment read is paged, and the attempts fan-out is bounded by that page', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: {
        data: [
          { id: 'assign-1', quiz_id: 'quiz-1', cycle: 1, status: 'pending', assigned_at: '2026-01-01T00:00:00.000Z', quiz: { id: 'quiz-1', title: 'Quiz 1', description: null, total_time_seconds: 600 } }
        ],
        error: null,
        count: 137
      }
    },
    { table: 'quiz_attempts', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp()).get('/api/user/quizzes').set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.page, 1)
    assert.equal(res.body.page_size, 25)
    // A real row count, not the length of the page.
    assert.equal(res.body.total, 137)

    const selectCall = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'select')
    assert.deepEqual(selectCall.args[1], { count: 'exact' })

    // `.range` is inclusive on both ends.
    const rangeCall = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'range')
    assert.deepEqual(rangeCall.args, [0, 24])

    // The fan-out can only ever carry one page's worth of ids.
    const inCall = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'in')
    assert.deepEqual(inCall.args, ['assignment_id', ['assign-1']])
  } finally {
    restore()
  }
})

test('GET /api/user/quizzes — page/page_size follow the convention, and page_size is capped', async () => {
  for (const [query, expectedRange, expectedPage, expectedPageSize] of [
    ['?page=2&page_size=10', [10, 19], 2, 10],
    ['?page_size=500', [0, 99], 1, 100],
    ['?page=0&page_size=0', [0, 24], 1, 25],
    ['?page=abc&page_size=abc', [0, 24], 1, 25]
  ]) {
    const restore = mockSupabaseSequence([
      { table: 'users', result: { data: USER, error: null } },
      { table: 'quiz_assignments', result: { data: [], error: null, count: 0 } }
    ])
    try {
      const res = await request(buildApp()).get(`/api/user/quizzes${query}`).set('Authorization', `Bearer ${userToken()}`)
      assert.equal(res.status, 200, query)
      assert.equal(res.body.page, expectedPage, query)
      assert.equal(res.body.page_size, expectedPageSize, query)
      const rangeCall = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'range')
      assert.deepEqual(rangeCall.args, expectedRange, query)
    } finally {
      restore()
    }
  }
})

// --- POST /quizzes/:assignmentId/attempt (task 7.2) ---

const ASSIGNMENT_UUID = '11111111-1111-4111-8111-111111111111'
const OTHER_ASSIGNMENT_UUID = '22222222-2222-4222-8222-222222222222'

test('POST /api/user/quizzes/:assignmentId/attempt — a malformed assignmentId returns 404 before any lookup', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/user/quizzes/not-a-uuid/attempt')
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 404)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments'), false)
  } finally {
    restore()
  }
})

test('POST /api/user/quizzes/:assignmentId/attempt — an assignment that is not the caller\'s returns 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_assignments', result: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${OTHER_ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 404)
    const eqUserCall = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'eq' && c.args[0] === 'user_id')
    assert.deepEqual(eqUserCall.args, ['user_id', USER.id])
  } finally {
    restore()
  }
})

test('POST /api/user/quizzes/:assignmentId/attempt — a quiz with no total_time_seconds returns 409 QUIZ_NOT_ASSIGNABLE', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: 'quiz-1', total_time_seconds: null } }, error: null }
    }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'QUIZ_NOT_ASSIGNABLE')
    assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts'), false)
  } finally {
    restore()
  }
})

test('POST /api/user/quizzes/:assignmentId/attempt — a completed current-cycle attempt returns 409 ATTEMPT_ALREADY_COMPLETED', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'completed', quiz: { id: 'quiz-1', total_time_seconds: 600 } }, error: null }
    },
    { table: 'quiz_attempts', result: { data: [{ id: 'attempt-1', status: 'completed', started_at: 'a', expires_at: 'b', time_budget_seconds: 600 }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'ATTEMPT_ALREADY_COMPLETED')
  } finally {
    restore()
  }
})

test('POST /api/user/quizzes/:assignmentId/attempt — an in_progress attempt resumes idempotently with 200', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: 'quiz-1', total_time_seconds: 600 } }, error: null }
    },
    // expires_at is in the FUTURE — this case is about a still-live attempt.
    // The past-due counterpart is the ATTEMPT_EXPIRED test below.
    { table: 'quiz_attempts', result: { data: [{ id: 'attempt-1', status: 'in_progress', started_at: '2030-01-01T00:00:00.000Z', expires_at: '2030-01-01T00:10:00.000Z', time_budget_seconds: 600 }], error: null } },
    {
      table: 'questions',
      result: {
        data: [
          { id: 'q1', text: 'Q1?', type: 'closed', order_index: 1, answer_options: [{ id: 'o1', text: 'Yes' }] },
          { id: 'q2', text: 'Q2?', type: 'open', order_index: 2, answer_options: [{ id: 'o2', text: 'lechuga' }] }
        ],
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.attempt, {
      id: 'attempt-1',
      startedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:10:00.000Z',
      timeBudgetSeconds: 600
    })
    assert.equal(res.body.questions.length, 2)
    // Open questions never expose options, even mid-resume (spec: Structural No-Leak).
    assert.deepEqual(res.body.questions[1].options, [])
    assert.deepEqual(res.body.questions[0].options, [{ id: 'o1', text: 'Yes' }])
    // A live attempt is never written to on resume — resume is idempotent.
    assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts' && c.method === 'update'), false)
  } finally {
    restore()
  }
})

// 'expired' is a valid quiz_attempts.status per migration 009's CHECK and a
// real branch of attemptEngine's resolveAttemptStatus, but nothing in the
// codebase ever WROTE it. Consequences: a long-past-due attempt resumed
// happily and served its full question payload; an abandoned attempt stayed
// in_progress forever; and the admin GET /api/attempts?status=expired filter
// could never match a row. The resume path is where a stale attempt is
// actually observed, so that is where the transition is materialized.
//
// Flipping the status ALONE, though, is worse than not flipping it: every
// other route (submit, answers, and the RPC itself) requires
// status='in_progress', so an attempt moved to 'expired' with NULL totals is
// stranded forever — submit answers 409 ATTEMPT_ALREADY_SUBMITTED for an
// attempt that was never submitted, UNIQUE (assignment_id, cycle) blocks a
// fresh one, and the assignment stays 'pending' with no recovery path but an
// admin reactivation. The transition therefore has to GRADE the work it is
// finalizing, in the same atomic write complete_quiz_attempt already performs
// for submit.
test('POST /api/user/quizzes/:assignmentId/attempt — resuming a past-due attempt grades and finalizes it instead of stranding it', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: 'quiz-1', total_time_seconds: 600 } }, error: null }
    },
    { table: 'quiz_attempts', result: { data: [{ id: 'attempt-1', status: 'in_progress', started_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:10:00.000Z', time_budget_seconds: 600 }], error: null } },
    // The grading reads — the same pair submit performs.
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }, { id: 'q2', text: 'Q2?' }], error: null } },
    {
      table: 'quiz_attempt_answers',
      result: {
        data: [
          { question_id: 'q1', answer_text: 'Yes', is_correct: true, answered_at: '2020-01-01T00:01:00.000Z' },
          // Past expires_at — gradeAttempt discards it, exactly as it does on
          // an explicit submit.
          { question_id: 'q2', answer_text: 'No', is_correct: true, answered_at: '2020-01-01T00:20:00.000Z' }
        ],
        error: null
      }
    },
    { rpc: 'complete_quiz_attempt', result: { data: null, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'ATTEMPT_EXPIRED')

    // Finalized through the SAME transactional RPC as submit — attempt totals
    // and assignment status move together or not at all.
    const rpcCall = restore.calls.find((c) => c.method === 'rpc')
    assert.equal(rpcCall.table, 'complete_quiz_attempt')
    assert.equal(rpcCall.args[0].target_attempt_id, 'attempt-1')
    assert.equal(rpcCall.args[0].target_user_id, USER.id)
    assert.equal(rpcCall.args[0].target_cycle, 1)
    // 'expired', not 'completed': this was never an explicit submit.
    assert.equal(rpcCall.args[0].new_status, 'expired')
    // The whole point — real totals, not the NULLs a bare status flip left.
    assert.equal(rpcCall.args[0].new_total_questions, 2)
    assert.equal(rpcCall.args[0].new_correct_count, 1)
    assert.equal(rpcCall.args[0].new_score_percent, 50)
    // NULL, not a timestamp: submitted_at is the record of an EXPLICIT submit,
    // and this attempt never had one. attemptEngine's resolveAttemptStatus
    // treats ANY truthy submittedAt as 'completed', so stamping the
    // finalization instant here would make the persisted row describe itself as
    // completed while its status column says 'expired'.
    assert.equal(rpcCall.args[0].new_submitted_at, null)

    // One write, and it is the RPC: a status flip that is not accompanied by
    // the totals is exactly the stranding bug this test exists to prevent.
    assert.equal(restore.calls.filter((c) => c.method === 'rpc').length, 1)
    assert.equal(restore.calls.some((c) => c.method === 'update'), false)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments' && c.method === 'update'), false)

    // Still no question payload for an attempt past its deadline. The body is
    // the error and NOTHING else — asserted whole, because checking a single
    // absent field is vacuously true for any 409 shape and can never fail.
    assert.deepEqual(res.body, { error: 'ATTEMPT_EXPIRED' })

    // EVERY read of the questions table, not just the first: the grading read
    // is answer-free, but a regression that adds the resume path's
    // fetchSerializedQuestions call AFTER it would leak the whole payload and
    // a `.find()`-based check would never see it. Exactly one select, and it is
    // the grading-scoped (id, text) one — never the answer_options-bearing
    // SAFE_QUESTION_SELECT the resume path serves.
    const questionSelects = restore.calls.filter((c) => c.table === 'questions' && c.method === 'select')
    assert.equal(questionSelects.length, 1)
    assert.equal(questionSelects.every((c) => c.args[0] === 'id, text'), true)
    assert.equal(questionSelects.every((c) => c.args[0].includes('answer_options') === false), true)
    // answer_options is never read directly either — the other way to obtain
    // the same correct-answer data.
    assert.equal(restore.calls.some((c) => c.table === 'answer_options'), false)
  } finally {
    restore()
  }
})

// The finalization is conditional on the attempt still being in_progress
// (inside the RPC), so it can lose a race with a concurrent submit. Reporting
// ATTEMPT_EXPIRED regardless of whether that conditional write matched
// anything tells the caller their attempt expired while it is in fact
// completed and carries a real score.
test('POST /api/user/quizzes/:assignmentId/attempt — a concurrent submit that wins the expiry race is reported as completed, not expired', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: 'quiz-1', total_time_seconds: 600 } }, error: null }
    },
    { table: 'quiz_attempts', result: { data: [{ id: 'attempt-1', status: 'in_progress', started_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:10:00.000Z', time_budget_seconds: 600 }], error: null } },
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: [{ question_id: 'q1', answer_text: 'Yes', is_correct: true, answered_at: '2020-01-01T00:01:00.000Z' }], error: null } },
    // The conditional write matched zero rows: a submit landed first, so the
    // RPC's own `AND status = 'in_progress'` guard raised instead of
    // clobbering the completed attempt.
    { rpc: 'complete_quiz_attempt', result: { data: null, error: { code: 'P0001', message: 'attempt_not_in_progress' } } },
    // ...so the route re-reads what the attempt actually is now.
    { table: 'quiz_attempts', result: { data: { id: 'attempt-1', status: 'completed' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'ATTEMPT_ALREADY_COMPLETED')
  } finally {
    restore()
  }
})

// The re-read is a `.single()` like every other lookup in this file, so zero
// matching rows arrives as an ERROR (PGRST116), not as `{ data: null }`.
// Reading it as a generic failure returned a raw 500 with the Postgres message
// in the body where the honest answer is the same 404 every other lookup here
// gives — see lib/pgErrors.js.
test('POST /api/user/quizzes/:assignmentId/attempt — an expiry re-read that matches no row returns 404, not 500', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: 'quiz-1', total_time_seconds: 600 } }, error: null }
    },
    { table: 'quiz_attempts', result: { data: [{ id: 'attempt-1', status: 'in_progress', started_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:10:00.000Z', time_budget_seconds: 600 }], error: null } },
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: [], error: null } },
    { rpc: 'complete_quiz_attempt', result: { data: null, error: { code: 'P0001', message: 'attempt_not_in_progress' } } },
    { table: 'quiz_attempts', result: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 404)
    assert.equal(res.body.error, 'Attempt not found')
  } finally {
    restore()
  }
})

// A re-read that FAILS says nothing about the attempt's status, so neither 409
// may be asserted from it: the caller would be told their attempt expired (or
// completed) on the strength of a connection error.
test('POST /api/user/quizzes/:assignmentId/attempt — an expiry re-read that fails propagates, it is not reported as a 409', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: 'quiz-1', total_time_seconds: 600 } }, error: null }
    },
    { table: 'quiz_attempts', result: { data: [{ id: 'attempt-1', status: 'in_progress', started_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:10:00.000Z', time_budget_seconds: 600 }], error: null } },
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: [], error: null } },
    { rpc: 'complete_quiz_attempt', result: { data: null, error: { code: 'P0001', message: 'attempt_not_in_progress' } } },
    { table: 'quiz_attempts', result: { data: null, error: { code: '08006', message: 'connection failure' } } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 500)
    assert.equal(res.body.error, 'Internal server error')
  } finally {
    restore()
  }
})

// The RPC's guard is `id AND user_id AND cycle AND status='in_progress'`, so
// attempt_not_in_progress does NOT prove the status moved — a user_id or cycle
// mismatch raises the same exception. A re-read that still says 'in_progress'
// is exactly that case, and answering ATTEMPT_EXPIRED for it reports an expiry
// that never happened instead of surfacing the real failure.
test('POST /api/user/quizzes/:assignmentId/attempt — an expiry re-read that still says in_progress is not reported as expired', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: 'quiz-1', total_time_seconds: 600 } }, error: null }
    },
    { table: 'quiz_attempts', result: { data: [{ id: 'attempt-1', status: 'in_progress', started_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:10:00.000Z', time_budget_seconds: 600 }], error: null } },
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: [], error: null } },
    { rpc: 'complete_quiz_attempt', result: { data: null, error: { code: 'P0001', message: 'attempt_not_in_progress' } } },
    { table: 'quiz_attempts', result: { data: { id: 'attempt-1', status: 'in_progress' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 500)
    assert.equal(res.body.error, 'Internal server error')
  } finally {
    restore()
  }
})

// The finalized attempt is a real, readable record — that is the difference
// between "expired" and "stranded". A usuario whose window ran out still gets
// the score their answers earned, and GET /result renders it exactly as it
// renders a submitted one instead of pairing NULL totals with green
// checkmarks.
test('GET /api/user/attempts/:id/result — a graded expired attempt reads back like any finalized one', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'expired', total_questions: 2, correct_count: 1, score_percent: 50, submitted_at: '2020-01-01T00:30:00.000Z' }, error: null } },
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }, { id: 'q2', text: 'Q2?' }], error: null } },
    {
      table: 'quiz_attempt_answers',
      result: {
        data: [
          { question_id: 'q1', answer_text: 'Yes', is_correct: true, answered_at: '2020-01-01T00:01:00.000Z' },
          { question_id: 'q2', answer_text: 'No', is_correct: false, answered_at: '2020-01-01T00:02:00.000Z' }
        ],
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/user/attempts/${ATTEMPT_UUID}/result`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.result.status, 'expired')
    assert.equal(res.body.result.totalQuestions, 2)
    assert.equal(res.body.result.correctCount, 1)
    assert.equal(res.body.result.scorePercent, 50)
    assert.equal(res.body.result.answers.length, 2)
  } finally {
    restore()
  }
})

// Once finalized, a further resume must report what actually happened. The
// generic "not in progress" branch called every non-in_progress attempt
// ATTEMPT_ALREADY_COMPLETED — telling a usuario their attempt was completed
// when it expired unanswered, and contradicting the code the very same route
// returned on the first resume.
test('POST /api/user/quizzes/:assignmentId/attempt — resuming an already-expired attempt reports ATTEMPT_EXPIRED, not ATTEMPT_ALREADY_COMPLETED', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'completed', quiz: { id: 'quiz-1', total_time_seconds: 600 } }, error: null }
    },
    { table: 'quiz_attempts', result: { data: [{ id: 'attempt-1', status: 'expired', started_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:10:00.000Z', time_budget_seconds: 600 }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'ATTEMPT_EXPIRED')
    // Already finalized — nothing left to re-grade or re-write.
    assert.equal(restore.calls.some((c) => c.method === 'rpc'), false)
    assert.equal(restore.calls.some((c) => c.method === 'update'), false)
  } finally {
    restore()
  }
})

test('POST /api/user/quizzes/:assignmentId/attempt — starts a new attempt with 201 when none exists', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 3, status: 'pending', quiz: { id: 'quiz-1', total_time_seconds: 300 } }, error: null }
    },
    { table: 'quiz_attempts', result: { data: [], error: null } },
    { table: 'quiz_attempts', result: { data: { id: 'attempt-new', started_at: '2026-01-01T00:00:00.000Z', expires_at: '2026-01-01T00:05:00.000Z', time_budget_seconds: 300 }, error: null } },
    { table: 'questions', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 201)
    assert.equal(res.body.attempt.id, 'attempt-new')
    assert.deepEqual(res.body.questions, [])

    const insertCall = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'insert')
    assert.equal(insertCall.args[0].assignment_id, ASSIGNMENT_UUID)
    assert.equal(insertCall.args[0].quiz_id, 'quiz-1')
    assert.equal(insertCall.args[0].user_id, USER.id)
    assert.equal(insertCall.args[0].cycle, 3)
    assert.equal(insertCall.args[0].status, 'in_progress')
    assert.equal(insertCall.args[0].time_budget_seconds, 300)
  } finally {
    restore()
  }
})

test('POST /api/user/quizzes/:assignmentId/attempt — a concurrent double-start (unique violation) returns 409', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: { id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: 'quiz-1', total_time_seconds: 300 } }, error: null }
    },
    { table: 'quiz_attempts', result: { data: [], error: null } },
    { table: 'quiz_attempts', result: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 409)
  } finally {
    restore()
  }
})

// --- POST /attempts/:id/answers (task 7.3) ---

const ATTEMPT_UUID = '33333333-3333-4333-8333-333333333333'
const QUESTION_UUID = '44444444-4444-4444-8444-444444444444'
// answer_options.id is a uuid column, and selected_option_id is an FK to it —
// the option-id fixtures are therefore UUID-shaped, like every other id
// fixture in this suite.
const OPTION_UUID = '66666666-6666-4666-8666-666666666666'
const OTHER_OPTION_UUID = '77777777-7777-4777-8777-777777777777'

test('POST /api/user/attempts/:id/answers — a malformed attempt id returns 404 before any lookup', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/user/attempts/not-a-uuid/answers')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: QUESTION_UUID })
    assert.equal(res.status, 404)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts'), false)
  } finally {
    restore()
  }
})

test('POST /api/user/attempts/:id/answers — an answerText over 500 chars returns 400 before any lookup', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: QUESTION_UUID, answerText: 'x'.repeat(501) })
    assert.equal(res.status, 400)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts'), false)
  } finally {
    restore()
  }
})

test('POST /api/user/attempts/:id/answers — a missing/malformed questionId returns 400', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: 'not-a-uuid' })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

// selectedOptionIds feeds evaluateMultipleAnswer, which calls array methods on
// it — a bare string or an object therefore threw a TypeError deep inside the
// domain layer and surfaced as an uncontrolled 500. questionId and answerText
// were already validated in this same handler; these were the gap.
for (const [label, body] of [
  ['a bare string', { selectedOptionIds: OPTION_UUID }],
  ['an object', { selectedOptionIds: { 0: OPTION_UUID } }],
  ['an array containing a non-UUID', { selectedOptionIds: [OPTION_UUID, 'o2'] }],
  ['a number', { selectedOptionIds: 3 }]
]) {
  test(`POST /api/user/attempts/:id/answers — selectedOptionIds as ${label} returns 400 before any lookup`, async () => {
    const restore = mockSupabaseSequence([
      { table: 'users', result: { data: USER, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
        .set('Authorization', `Bearer ${userToken()}`)
        .send({ questionId: QUESTION_UUID, ...body })
      assert.equal(res.status, 400)
      assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts'), false)
      assert.equal(restore.calls.some((c) => c.table === 'answer_options'), false)
      assert.equal(restore.calls.some((c) => c.table === 'quiz_attempt_answers'), false)
    } finally {
      restore()
    }
  })
}

// time_taken_ms is an INT column. An arbitrary client-supplied JSON value
// landed in it unvalidated: a string or object is a Postgres 22P02, a value
// past INT4's range is a 22003 — both uncontrolled 500s — and a negative
// number is silently stored garbage.
for (const [label, timeTakenMs] of [
  ['a string', '1200'],
  ['an object', { ms: 1200 }],
  ['a negative number', -1],
  ['a fractional number', 12.5],
  ['a value past INT4 range', 2147483648],
  ['NaN-producing null-ish garbage', true]
]) {
  test(`POST /api/user/attempts/:id/answers — timeTakenMs as ${label} returns 400 before any lookup`, async () => {
    const restore = mockSupabaseSequence([
      { table: 'users', result: { data: USER, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
        .set('Authorization', `Bearer ${userToken()}`)
        .send({ questionId: QUESTION_UUID, timeTakenMs })
      assert.equal(res.status, 400)
      assert.equal(restore.calls.some((c) => c.table === 'quiz_attempt_answers'), false)
    } finally {
      restore()
    }
  })
}

test('POST /api/user/attempts/:id/answers — an omitted timeTakenMs is still persisted as null', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'in_progress', expires_at: '2030-01-01T00:00:00.000Z' }, error: null } },
    { table: 'questions', result: { data: { id: QUESTION_UUID, quiz_id: 'quiz-1', type: 'closed' }, error: null } },
    { table: 'answer_options', result: { data: [{ id: OPTION_UUID, text: 'Yes', is_correct: true }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: { id: 'ans-1' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: QUESTION_UUID, selectedOptionId: OPTION_UUID })
    assert.equal(res.status, 200)
    const upsert = restore.calls.find((c) => c.table === 'quiz_attempt_answers' && c.method === 'upsert')
    assert.equal(upsert.args[0].time_taken_ms, null)
  } finally {
    restore()
  }
})

// selected_option_id is an FK to answer_options.id, a uuid column — same
// 22P02-avoidance contract every other id in this handler already enforces.
test('POST /api/user/attempts/:id/answers — a non-UUID selectedOptionId returns 400 before any lookup', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: QUESTION_UUID, selectedOptionId: 'o1' })
    assert.equal(res.status, 400)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts'), false)
  } finally {
    restore()
  }
})

test('POST /api/user/attempts/:id/answers — an empty selectedOptionIds array is still accepted', async () => {
  // A 'multiple' question answered with nothing picked is a legitimate
  // submission (attemptEngine scores it false); the shape check must not
  // reject it.
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'in_progress', expires_at: '2030-01-01T00:00:00.000Z' }, error: null } },
    { table: 'questions', result: { data: { id: QUESTION_UUID, quiz_id: 'quiz-1', type: 'multiple' }, error: null } },
    { table: 'answer_options', result: { data: [{ id: OPTION_UUID, text: 'Yes', is_correct: true }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: { id: 'ans-1' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: QUESTION_UUID, selectedOptionIds: [] })
    assert.equal(res.status, 200)
  } finally {
    restore()
  }
})

test('POST /api/user/attempts/:id/answers — an attempt that is not the caller\'s returns 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: QUESTION_UUID })
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

test('POST /api/user/attempts/:id/answers — a completed attempt returns 409 ATTEMPT_NOT_IN_PROGRESS', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'completed', expires_at: '2030-01-01T00:00:00.000Z' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: QUESTION_UUID })
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'ATTEMPT_NOT_IN_PROGRESS')
  } finally {
    restore()
  }
})

test('POST /api/user/attempts/:id/answers — an attempt past expires_at returns 409 ATTEMPT_EXPIRED', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'in_progress', expires_at: '2000-01-01T00:00:00.000Z' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: QUESTION_UUID })
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'ATTEMPT_EXPIRED')
    assert.equal(restore.calls.some((c) => c.table === 'quiz_attempt_answers'), false)
  } finally {
    restore()
  }
})

test('POST /api/user/attempts/:id/answers — a question outside this attempt\'s quiz returns 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'in_progress', expires_at: '2030-01-01T00:00:00.000Z' }, error: null } },
    { table: 'questions', result: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: QUESTION_UUID })
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

test('POST /api/user/attempts/:id/answers — records a graded answer via upsert, never returning correctness', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'in_progress', expires_at: '2030-01-01T00:00:00.000Z' }, error: null } },
    { table: 'questions', result: { data: { id: QUESTION_UUID, quiz_id: 'quiz-1', type: 'closed' }, error: null } },
    { table: 'answer_options', result: { data: [{ id: OPTION_UUID, text: 'Yes', is_correct: true }, { id: OTHER_OPTION_UUID, text: 'No', is_correct: false }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: { id: 'ans-1' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: QUESTION_UUID, selectedOptionId: OPTION_UUID, timeTakenMs: 1200 })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { recorded: true })
    assert.equal(JSON.stringify(res.body).includes('isCorrect'), false)
    assert.equal(JSON.stringify(res.body).includes('is_correct'), false)

    const upsert = restore.calls.find((c) => c.table === 'quiz_attempt_answers' && c.method === 'upsert')
    assert.equal(upsert.args[0].attempt_id, ATTEMPT_UUID)
    assert.equal(upsert.args[0].question_id, QUESTION_UUID)
    assert.equal(upsert.args[0].is_correct, true)
    assert.equal(upsert.args[0].selected_option_id, OPTION_UUID)
    assert.equal(upsert.args[0].time_taken_ms, 1200)
    assert.deepEqual(upsert.args[1], { onConflict: 'attempt_id,question_id' })
  } finally {
    restore()
  }
})

// The expiry gate and the answered_at stamp used to read the clock TWICE,
// with two DB round trips in between. An answer submitted just before
// expires_at could pass the gate and still be stamped after it — and then
// gradeAttempt silently drops it from correctCount while buildAnswersDetail
// (which reads the unfiltered rows) still renders it with isCorrect: true.
// The displayed checkmarks and the total contradict each other.
test('POST /api/user/attempts/:id/answers — an answer the expiry gate accepted is never stamped late', async () => {
  const EXPIRES_IN_MS = 200
  const LOOKUP_DELAY_MS = 600
  const expiresAt = new Date(Date.now() + EXPIRES_IN_MS).toISOString()

  // A `result` that is a Promise flows straight through the mock's
  // `Promise.resolve(result)`, which is what lets this test put real latency
  // exactly where the two round trips are.
  const delayed = (value) => new Promise((resolve) => setTimeout(() => resolve(value), LOOKUP_DELAY_MS))

  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'in_progress', expires_at: expiresAt }, error: null } },
    { table: 'questions', result: delayed({ data: { id: QUESTION_UUID, quiz_id: 'quiz-1', type: 'closed' }, error: null }) },
    { table: 'answer_options', result: delayed({ data: [{ id: OPTION_UUID, text: 'Yes', is_correct: true }], error: null }) },
    { table: 'quiz_attempt_answers', result: { data: { id: 'ans-1' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ questionId: QUESTION_UUID, selectedOptionId: OPTION_UUID })
    assert.equal(res.status, 200)

    const upsert = restore.calls.find((c) => c.table === 'quiz_attempt_answers' && c.method === 'upsert')
    assert.ok(
      new Date(upsert.args[0].answered_at) <= new Date(expiresAt),
      `answered_at (${upsert.args[0].answered_at}) must not be later than the expires_at (${expiresAt}) the gate just approved it against`
    )
  } finally {
    restore()
  }
})

// --- POST /attempts/:id/submit and GET /attempts/:id/result (task 7.4) ---

test('POST /api/user/attempts/:id/submit — a malformed attempt id returns 404 before any lookup', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/user/attempts/not-a-uuid/submit')
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 404)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts'), false)
  } finally {
    restore()
  }
})

test('POST /api/user/attempts/:id/submit — an attempt that is not the caller\'s returns 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/submit`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

test('POST /api/user/attempts/:id/submit — an already-completed attempt returns 409', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, assignment_id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'completed', expires_at: '2030-01-01T00:00:00.000Z', submitted_at: '2026-01-01T00:00:00.000Z' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/submit`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'ATTEMPT_ALREADY_SUBMITTED')
  } finally {
    restore()
  }
})

// The resume path finalizes a past-due attempt as 'expired' and reports
// ATTEMPT_EXPIRED. Submit saw the same row and answered ATTEMPT_ALREADY_SUBMITTED
// through its generic "not in progress" branch — factually wrong (nothing was
// ever submitted; submitted_at is NULL) and contradicting what the other route
// says about the very same attempt.
test('POST /api/user/attempts/:id/submit — an expired attempt reports ATTEMPT_EXPIRED, not ATTEMPT_ALREADY_SUBMITTED', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, assignment_id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'expired', expires_at: '2020-01-01T00:10:00.000Z', submitted_at: null }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/submit`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'ATTEMPT_EXPIRED')
    // Already finalized — nothing to re-grade and nothing to re-write.
    assert.equal(restore.calls.some((c) => c.method === 'rpc'), false)
    assert.equal(restore.calls.some((c) => c.method === 'update'), false)
  } finally {
    restore()
  }
})

test('POST /api/user/attempts/:id/submit — grades, persists totals, and completes the assignment', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    // `cycle` is part of every real quiz_attempts row and is a REQUIRED RPC
    // parameter — omitting it here left target_cycle undefined, which
    // JSON.stringify drops on the way out, so the call PostgREST would have
    // received had no matching signature (PGRST202).
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, assignment_id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'in_progress', expires_at: '2030-01-01T00:00:00.000Z', submitted_at: null }, error: null } },
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }, { id: 'q2', text: 'Q2?' }], error: null } },
    {
      table: 'quiz_attempt_answers',
      result: {
        data: [
          { question_id: 'q1', answer_text: 'Yes', is_correct: true, answered_at: '2026-01-01T00:01:00.000Z' },
          { question_id: 'q2', answer_text: 'No', is_correct: false, answered_at: '2026-01-01T00:02:00.000Z' }
        ],
        error: null
      }
    },
    { rpc: 'complete_quiz_attempt', result: { data: null, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/submit`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.result.attemptId, ATTEMPT_UUID)
    assert.equal(res.body.result.status, 'completed')
    assert.equal(res.body.result.totalQuestions, 2)
    assert.equal(res.body.result.correctCount, 1)
    assert.equal(res.body.result.scorePercent, 50)
    assert.equal('passed' in res.body.result, false)
    assert.deepEqual(res.body.result.answers.find((a) => a.questionId === 'q1'), {
      questionId: 'q1',
      questionText: 'Q1?',
      answerText: 'Yes',
      isCorrect: true
    })
    // Never the correct option's own identifier/text (D9's admin-only field).
    assert.equal(JSON.stringify(res.body.result).includes('correctAnswer'), false)

    const rpcCall = restore.calls.find((c) => c.method === 'rpc')
    assert.equal(rpcCall.table, 'complete_quiz_attempt')
    assert.equal(rpcCall.args[0].target_attempt_id, ATTEMPT_UUID)
    assert.equal(rpcCall.args[0].target_user_id, USER.id)
    assert.equal(rpcCall.args[0].target_cycle, 1)
    assert.equal(rpcCall.args[0].new_status, 'completed')
    assert.equal(rpcCall.args[0].new_total_questions, 2)
    assert.equal(rpcCall.args[0].new_correct_count, 1)
    assert.equal(rpcCall.args[0].new_score_percent, 50)
  } finally {
    restore()
  }
})

// Migration 009's documented contract: a reactivation bumps the assignment to
// a new cycle and sets it back to 'pending', while in-progress attempts are
// intentionally NOT force-expired — they keep their OLD cycle and finish
// normally. Submitting such an attempt must therefore never mark the
// CURRENT-cycle assignment completed: the usuario never took that cycle, and
// the admin roster would carry a compliance-critical false positive.
test('POST /api/user/attempts/:id/submit — a stale-cycle submit cannot complete a newer cycle\'s assignment', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, assignment_id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'in_progress', expires_at: '2030-01-01T00:00:00.000Z', submitted_at: null }, error: null } },
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: [{ question_id: 'q1', answer_text: 'Yes', is_correct: true, answered_at: '2026-01-01T00:01:00.000Z' }], error: null } },
    // The assignment has already moved on to cycle 2, so the cycle-scoped
    // update inside the RPC matches zero rows. That is a correct outcome,
    // not an error.
    { rpc: 'complete_quiz_attempt', result: { data: null, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/submit`)
      .set('Authorization', `Bearer ${userToken()}`)

    // The attempt itself is still a legitimate historical record: graded,
    // submitted, completed.
    assert.equal(res.status, 200)
    assert.equal(res.body.result.status, 'completed')

    // The attempt's own cycle has to be READ for the guard to exist at all.
    const attemptSelect = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'select')
    assert.ok(attemptSelect.args[0].split(',').map((s) => s.trim()).includes('cycle'))

    // ...and handed to the RPC, which is what scopes the assignment write by
    // it. The route itself must never write quiz_assignments directly, or the
    // guard could be bypassed.
    const rpcCall = restore.calls.find((c) => c.method === 'rpc')
    assert.equal(rpcCall.args[0].target_cycle, 1)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments'), false)
  } finally {
    restore()
  }
})

// The submit handler used to perform two independent, unguarded, sequential
// writes with no transaction and no compensation: if the assignment write
// failed, the attempt was already persisted as 'completed' and the client's
// own retry was then rejected by the first write's ATTEMPT_ALREADY_SUBMITTED
// guard — no recovery path at all. supabase-js has no client-side
// transactions, which is exactly why reactivate_quiz_assignments and
// update_admin_role_status are RPCs (migration 009's header says so
// explicitly).
test('POST /api/user/attempts/:id/submit — a failed completion strands nothing and a retry recovers', async () => {
  const submitSequence = (final) => [
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, assignment_id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'in_progress', expires_at: '2030-01-01T00:00:00.000Z', submitted_at: null }, error: null } },
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: [{ question_id: 'q1', answer_text: 'Yes', is_correct: true, answered_at: '2026-01-01T00:01:00.000Z' }], error: null } },
    final
  ]

  const app = buildApp()

  const restore = mockSupabaseSequence(submitSequence({
    rpc: 'complete_quiz_attempt',
    result: { data: null, error: { code: '08006', message: 'connection failure' } }
  }))
  try {
    const failed = await request(app)
      .post(`/api/user/attempts/${ATTEMPT_UUID}/submit`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(failed.status, 500)

    // One write call, and it is the RPC — a half-applied completion is not
    // representable, so there is nothing to compensate for.
    assert.equal(restore.calls.filter((c) => c.method === 'rpc').length, 1)
    assert.equal(restore.calls.some((c) => c.method === 'update'), false)
  } finally {
    restore()
  }

  // The failed transaction rolled back, so the attempt is STILL in_progress
  // and the retry goes all the way through.
  const restoreRetry = mockSupabaseSequence(submitSequence({
    rpc: 'complete_quiz_attempt',
    result: { data: null, error: null }
  }))
  try {
    const retried = await request(app)
      .post(`/api/user/attempts/${ATTEMPT_UUID}/submit`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(retried.status, 200)
    assert.equal(retried.body.result.status, 'completed')
  } finally {
    restoreRetry()
  }
})

test('POST /api/user/attempts/:id/submit — the RPC\'s attempt_not_in_progress exception maps to 409, not 500', async () => {
  // A concurrent submit that won the race is the RPC's own no-rows-updated
  // case; the route must report it the same way its pre-check does.
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, assignment_id: ASSIGNMENT_UUID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'in_progress', expires_at: '2030-01-01T00:00:00.000Z', submitted_at: null }, error: null } },
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: [], error: null } },
    { rpc: 'complete_quiz_attempt', result: { data: null, error: { code: 'P0001', message: 'attempt_not_in_progress' } } }
  ])
  try {
    const res = await request(buildApp())
      .post(`/api/user/attempts/${ATTEMPT_UUID}/submit`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'ATTEMPT_ALREADY_SUBMITTED')
  } finally {
    restore()
  }
})

test('GET /api/user/attempts/:id/result — a malformed attempt id returns 404 before any lookup', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/user/attempts/not-a-uuid/result')
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

test('GET /api/user/attempts/:id/result — an attempt that is not the caller\'s returns 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/user/attempts/${ATTEMPT_UUID}/result`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

test('GET /api/user/attempts/:id/result — a still-in-progress attempt returns 409', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'in_progress', total_questions: null, correct_count: null, score_percent: null, submitted_at: null }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/user/attempts/${ATTEMPT_UUID}/result`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'ATTEMPT_STILL_IN_PROGRESS')
  } finally {
    restore()
  }
})

test('GET /api/user/attempts/:id/result — returns the same result shape as submit, with no verdict field', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_attempts', result: { data: { id: ATTEMPT_UUID, quiz_id: 'quiz-1', user_id: USER.id, status: 'completed', total_questions: 2, correct_count: 1, score_percent: 50, submitted_at: '2026-01-01T00:05:00.000Z' }, error: null } },
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }, { id: 'q2', text: 'Q2?' }], error: null } },
    {
      table: 'quiz_attempt_answers',
      result: {
        data: [
          { question_id: 'q1', answer_text: 'Yes', is_correct: true, answered_at: '2026-01-01T00:01:00.000Z' },
          { question_id: 'q2', answer_text: 'No', is_correct: false, answered_at: '2026-01-01T00:02:00.000Z' }
        ],
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/user/attempts/${ATTEMPT_UUID}/result`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.result.attemptId, ATTEMPT_UUID)
    assert.equal(res.body.result.totalQuestions, 2)
    assert.equal(res.body.result.correctCount, 1)
    assert.equal(res.body.result.scorePercent, 50)
    assert.equal(res.body.result.submittedAt, '2026-01-01T00:05:00.000Z')
    assert.equal('passed' in res.body.result, false)
    assert.equal('verdict' in res.body.result, false)
    // No admin-only fields — reuses the same field vocabulary as the submit response.
    assert.equal(JSON.stringify(res.body.result).includes('correctAnswer'), false)
  } finally {
    restore()
  }
})

// --- complete_quiz_attempt: the assignment side is for submits only ---

// The RPC takes new_status as data for the ATTEMPT update but hardcoded
// `status = 'completed'` on the ASSIGNMENT update, so finalizing an expiry
// through it (new_status='expired') still marked the assignment completed. A
// usuario who abandoned a quiz with zero answers then appeared on the admin
// roster as having completed their training and disappeared from
// `GET /api/assignments?status=pending` — the "who still owes me this"
// compliance query. quiz_assignments.status only admits 'pending'/'completed'
// (migration 009's CHECK), so the expiry path must leave the assignment
// ALONE rather than write a third value: it stays 'pending', and the
// per-assignment `attemptStatus` the admin list already surfaces is what tells
// the admin the current-cycle attempt expired.
//
// There is no live database in this suite (see test/README.md), so the
// predicate is pinned against the SQL sources themselves — the authoritative
// migration and the consolidated schema, which this repo keeps in sync. Same
// approach as the reactivate_quiz_assignments pin in assignments.test.js.

const SUPABASE_DIR = fileURLToPath(new URL('../../supabase/', import.meta.url))
const COMPLETE_MARKER = 'CREATE OR REPLACE FUNCTION complete_quiz_attempt'

// The LAST definition in a file wins in Postgres too, so read the same one.
function completeFunctionBody(sql) {
  const start = sql.lastIndexOf(COMPLETE_MARKER)
  if (start === -1) return null
  const end = sql.indexOf('$$;', start)
  return sql.slice(start, end === -1 ? sql.length : end + 3)
}

function readSql(...segments) {
  return readFileSync(path.join(SUPABASE_DIR, ...segments), 'utf8')
}

test('complete_quiz_attempt — the live SQL only touches quiz_assignments when the attempt was really submitted', () => {
  // The authoritative definition is the one in the HIGHEST-numbered migration
  // that redefines the function — an earlier migration's copy is already
  // superseded by the time the schema is current.
  const migrations = readdirSync(path.join(SUPABASE_DIR, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const latest = [...migrations].reverse().find((f) => completeFunctionBody(readSql('migrations', f)) !== null)
  assert.ok(latest, 'no migration defines complete_quiz_attempt')

  const sources = [
    [`migrations/${latest}`, completeFunctionBody(readSql('migrations', latest))],
    ['schema.sql', completeFunctionBody(readSql('schema.sql'))]
  ]

  const guard = /IF\s+new_status\s*=\s*'completed'\s+THEN/

  for (const [name, body] of sources) {
    assert.ok(body, `${name} must define complete_quiz_attempt`)

    const guardAt = body.search(guard)
    assert.notEqual(guardAt, -1, `${name}: the assignment write must be guarded by new_status = 'completed'`)

    // EVERY assignment write, not merely the first: a second, unguarded one
    // would reintroduce the exact bug this pins.
    let from = 0
    let writes = 0
    for (;;) {
      const at = body.indexOf('UPDATE quiz_assignments', from)
      if (at === -1) break
      writes += 1
      assert.ok(
        guardAt < at,
        `${name}: UPDATE quiz_assignments at offset ${at} is not inside the new_status = 'completed' guard`
      )
      from = at + 1
    }
    assert.equal(writes, 1, `${name}: expected exactly one UPDATE quiz_assignments in complete_quiz_attempt`)
  }
})
