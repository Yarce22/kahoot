import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
// Mirrors src/index.js:2 — without it an async throw inside a route handler
// never reaches errorHandler, so a crash-class bug hangs the request instead
// of surfacing as a clean 500.
import 'express-async-errors'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.AUTH_MODE = 'jwt'

// Cross-cutting integration coverage for task 7.6: the full quiz_attempts
// lifecycle (spec: One Attempt Per Assignment Per Cycle, Reactivation via
// Cycle Bump) exercised across userQuizzes.js (usuario side) and
// assignments.js / attempts.js (admin side) together — rather than the
// single-call-in-isolation cases already covered in userQuizzes.test.js and
// assignments.test.js.

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { userQuizzesRouter } = await import('../src/routes/userQuizzes.js')
const { assignmentsRouter } = await import('../src/routes/assignments.js')
const { attemptsRouter } = await import('../src/routes/attempts.js')
const { errorHandler } = await import('../src/middleware/errorHandler.js')
const { signToken } = await import('../src/lib/jwt.js')
const { default: request } = await import('supertest')

// Standalone app — none of these routers are mounted in src/index.js until
// task 8.1 of this same PR3 batch.
function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/user', userQuizzesRouter)
  app.use('/api/assignments', assignmentsRouter)
  app.use('/api/attempts', attemptsRouter)
  app.use(errorHandler)
  return app
}

// users.id filters attempts.js's user_id query param, a UUID column — must
// be UUID-shaped for the same reason every other :id/user_id fixture in this
// suite is.
const USER = { id: '99999999-9999-4999-8999-999999999999', email: 'u@example.com', full_name: 'Ana Usuaria', punto_de_venta: 'Cerritos', is_active: true }
const SUPER = { id: 'super-1', email: 'boss@example.com', role: 'superadmin', is_active: true, punto_de_venta: 'Cerritos' }
const userToken = () => signToken({ sub: USER.id, email: USER.email, aud: 'usuario' })
const superToken = () => signToken({ sub: SUPER.id, email: SUPER.email })

const QUIZ_ID = 'aabbccdd-5555-4555-8555-eeff55555555'
const ASSIGNMENT_UUID = '11111111-1111-4111-8111-111111111111'
const OLD_ATTEMPT_UUID = '55555555-5555-4555-8555-555555555555'

// --- one attempt per (assignment_id, cycle), enforced at the DB level ---

// The application-level "does an attempt already exist for this cycle"
// pre-check (userQuizzes.js) is only an optimization to avoid the round trip
// in the common case; the ACTUAL enforcement is the UNIQUE(assignment_id,
// cycle) constraint from migration 009. This models the race the constraint
// exists to close: two concurrent starts both pass the pre-check (neither
// sees the other's not-yet-committed row), and the SECOND insert is the one
// that hits the real constraint.
test('attempt lifecycle — a concurrent second start on the same (assignment_id, cycle) is rejected by the UNIQUE constraint', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_assignments', result: { data: { id: ASSIGNMENT_UUID, quiz_id: QUIZ_ID, user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: QUIZ_ID, total_time_seconds: 600 } }, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null } }, // pre-check: no existing row (race window)
    { table: 'quiz_attempts', result: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "quiz_attempts_assignment_id_cycle_key"' } } } // the real constraint fires here
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

// --- reactivation frees exactly one new slot, and prior-cycle history survives ---

test('attempt lifecycle — reactivating a completed assignment frees exactly one new attempt slot', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } }, // requireAuth for POST /reactivate
    { table: 'quizzes', result: { data: { id: QUIZ_ID, owner_id: SUPER.id }, error: null } },
    { rpc: 'reactivate_quiz_assignments', result: { data: [{ assignment_id: ASSIGNMENT_UUID, new_cycle: 2 }], error: null } },
    { table: 'users', result: { data: USER, error: null } }, // requireUserAuth for POST /attempt
    // The assignment now reports the BUMPED cycle — this is what "frees a
    // new slot" means concretely: cycle 2 has no attempt row yet.
    { table: 'quiz_assignments', result: { data: { id: ASSIGNMENT_UUID, quiz_id: QUIZ_ID, user_id: USER.id, cycle: 2, status: 'pending', quiz: { id: QUIZ_ID, total_time_seconds: 600 } }, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null } }, // no attempt yet for cycle 2
    { table: 'quiz_attempts', result: { data: { id: 'attempt-cycle-2', started_at: 'a', expires_at: 'b', time_budget_seconds: 600 }, error: null } },
    { table: 'questions', result: { data: [], error: null } }
  ])
  const app = buildApp()
  try {
    const reactivateRes = await request(app)
      .post('/api/assignments/reactivate')
      .set('Authorization', `Bearer ${superToken()}`)
      .send({ quiz_id: QUIZ_ID })
    assert.equal(reactivateRes.status, 200)
    assert.deepEqual(reactivateRes.body, { reactivated: 1, cycle: 2 })

    const startRes = await request(app)
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(startRes.status, 201)

    const insertCall = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'insert')
    assert.equal(insertCall.args[0].cycle, 2)
  } finally {
    restore()
  }
})

// --- expiry is a reachable state, not just a CHECK-constraint value ---

// The usuario side is the only thing that ever writes status='expired' (the
// resume path, on an attempt found past expires_at). This proves the literal
// it writes is exactly the one the admin history filter matches — i.e. that
// GET /api/attempts?status=expired can finally return a row, which it never
// could while nothing in the codebase produced that status.
test('attempt lifecycle — an attempt expired by the usuario resume path is what the admin status=expired filter matches', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_assignments', result: { data: { id: ASSIGNMENT_UUID, quiz_id: QUIZ_ID, user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: QUIZ_ID, total_time_seconds: 600 } }, error: null } },
    { table: 'quiz_attempts', result: { data: [{ id: OLD_ATTEMPT_UUID, status: 'in_progress', started_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:10:00.000Z', time_budget_seconds: 600 }], error: null } },
    // The expiry transition GRADES the attempt before finalizing it, so it
    // reads the questions and the recorded answers first and then writes
    // through the same complete_quiz_attempt RPC an explicit submit uses.
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }, { id: 'q2', text: 'Q2?' }], error: null } },
    { table: 'quiz_attempt_answers', result: { data: [{ question_id: 'q1', answer_text: 'Yes', is_correct: true, answered_at: '2020-01-01T00:01:00.000Z' }], error: null } },
    { rpc: 'complete_quiz_attempt', result: { data: null, error: null } },
    { table: 'admins', result: { data: SUPER, error: null } },
    {
      table: 'quiz_attempts',
      result: {
        data: [
          {
            id: OLD_ATTEMPT_UUID,
            quiz_id: QUIZ_ID,
            cycle: 1,
            status: 'expired',
            // Real totals: the row the admin filter matches is a GRADED
            // record, not a stranded one with nothing in it.
            total_questions: 2,
            correct_count: 1,
            score_percent: 50,
            started_at: '2020-01-01T00:00:00.000Z',
            submitted_at: '2020-01-01T00:30:00.000Z',
            quiz: { id: QUIZ_ID, title: 'Quiz' },
            user: { id: USER.id, full_name: USER.full_name, email: USER.email, punto_de_venta: USER.punto_de_venta }
          }
        ],
        error: null,
        count: 1
      }
    }
  ])
  const app = buildApp()
  try {
    const resumeRes = await request(app)
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(resumeRes.status, 409)
    assert.equal(resumeRes.body.error, 'ATTEMPT_EXPIRED')

    const written = restore.calls.find((c) => c.method === 'rpc' && c.table === 'complete_quiz_attempt').args[0].new_status

    const historyRes = await request(app)
      .get(`/api/attempts?status=${written}`)
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(historyRes.status, 200)
    assert.equal(historyRes.body.attempts.length, 1)
    assert.equal(historyRes.body.attempts[0].status, 'expired')

    const statusFilter = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'expired')
    assert.ok(statusFilter, 'the admin filter must accept the status the usuario route writes')
  } finally {
    restore()
  }
})

// The compliance half of the same transition. Expiring an attempt finalizes
// the ATTEMPT; it must not close out the ASSIGNMENT, because nobody completed
// anything — the usuario abandoned the quiz, possibly with zero answers.
// quiz_assignments.status only admits 'pending'/'completed' (migration 009's
// CHECK), so "expired" has no assignment-level representation and the row must
// simply be left alone: it stays 'pending' in the admin roster's "who still
// owes me this" query, and the attemptStatus that list already reports per
// assignment is what distinguishes "never started" from "started and ran out".
test('attempt lifecycle — an assignment whose current-cycle attempt just expired is still pending on the admin roster', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_assignments', result: { data: { id: ASSIGNMENT_UUID, quiz_id: QUIZ_ID, user_id: USER.id, cycle: 1, status: 'pending', quiz: { id: QUIZ_ID, total_time_seconds: 600 } }, error: null } },
    { table: 'quiz_attempts', result: { data: [{ id: OLD_ATTEMPT_UUID, status: 'in_progress', started_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T00:10:00.000Z', time_budget_seconds: 600 }], error: null } },
    { table: 'questions', result: { data: [{ id: 'q1', text: 'Q1?' }], error: null } },
    // Zero answers — the worst case for the roster: this usuario did nothing
    // at all, so reporting them as 'completed' is a pure false positive.
    { table: 'quiz_attempt_answers', result: { data: [], error: null } },
    { rpc: 'complete_quiz_attempt', result: { data: null, error: null } },
    { table: 'admins', result: { data: SUPER, error: null } },
    {
      table: 'quiz_assignments',
      result: {
        data: [
          {
            id: ASSIGNMENT_UUID,
            quiz_id: QUIZ_ID,
            quiz: { title: 'Quiz' },
            // Untouched by the expiry above: still pending, still no
            // completed_at.
            status: 'pending',
            cycle: 1,
            assigned_at: '2020-01-01T00:00:00.000Z',
            completed_at: null,
            user: { id: USER.id, full_name: USER.full_name, email: USER.email, punto_de_venta: USER.punto_de_venta }
          }
        ],
        error: null,
        count: 1
      }
    },
    { table: 'quiz_attempts', result: { data: [{ assignment_id: ASSIGNMENT_UUID, cycle: 1, status: 'expired' }], error: null } }
  ])
  const app = buildApp()
  try {
    const resumeRes = await request(app)
      .post(`/api/user/quizzes/${ASSIGNMENT_UUID}/attempt`)
      .set('Authorization', `Bearer ${userToken()}`)
    assert.equal(resumeRes.status, 409)
    assert.equal(resumeRes.body.error, 'ATTEMPT_EXPIRED')

    // The expiry writes the attempt and NOTHING else — the assignment is not
    // part of that transaction at all.
    const rpcArgs = restore.calls.find((c) => c.method === 'rpc' && c.table === 'complete_quiz_attempt').args[0]
    assert.equal(rpcArgs.new_status, 'expired')
    assert.equal(rpcArgs.new_submitted_at, null)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments' && c.method !== 'select' && c.method !== 'eq'), false)

    const rosterRes = await request(app)
      .get('/api/assignments?status=pending')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(rosterRes.status, 200)
    assert.equal(rosterRes.body.assignments.length, 1)
    assert.equal(rosterRes.body.assignments[0].id, ASSIGNMENT_UUID)
    assert.equal(rosterRes.body.assignments[0].status, 'pending')
    assert.equal(rosterRes.body.assignments[0].completedAt, null)
    // ...and the admin can still tell what happened, without the assignment
    // having to carry a status its CHECK constraint does not allow.
    assert.equal(rosterRes.body.assignments[0].attemptStatus, 'expired')
  } finally {
    restore()
  }
})

// Reactivation bumps quiz_assignments.cycle and the quizzes high-water mark —
// it never writes to quiz_attempts (migration 009's RPC only UPDATEs
// quizzes and quiz_assignments). A prior cycle's attempt row is therefore
// left completely untouched, not merely "not visible": it stays queryable in
// full via the admin history endpoint (attempts.js, already implemented in
// PR2), and an in-progress one keeps its own original cycle and status.
test('attempt lifecycle — reactivation never touches quiz_attempts, so prior-cycle history and any in-progress attempt survive untouched', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quizzes', result: { data: { id: QUIZ_ID, owner_id: SUPER.id }, error: null } },
    { rpc: 'reactivate_quiz_assignments', result: { data: [{ assignment_id: ASSIGNMENT_UUID, new_cycle: 2 }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments/reactivate')
      .set('Authorization', `Bearer ${superToken()}`)
      .send({ quiz_id: QUIZ_ID })
    assert.equal(res.status, 200)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts'), false)
  } finally {
    restore()
  }
})

test('attempt lifecycle — a completed prior-cycle attempt remains queryable via the admin history endpoint after reactivation', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    {
      table: 'quiz_attempts',
      result: {
        data: [
          {
            id: 'attempt-cycle-1',
            quiz_id: QUIZ_ID,
            cycle: 1,
            status: 'completed',
            total_questions: 3,
            correct_count: 2,
            score_percent: 67,
            started_at: '2026-01-01T00:00:00.000Z',
            submitted_at: '2026-01-01T00:05:00.000Z',
            quiz: { id: QUIZ_ID, title: 'Quiz' },
            user: { id: USER.id, full_name: USER.full_name, email: USER.email, punto_de_venta: USER.punto_de_venta }
          }
        ],
        error: null,
        count: 1
      }
    }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/attempts?user_id=${USER.id}&cycle=1`)
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.attempts.length, 1)
    assert.equal(res.body.attempts[0].cycle, 1)
    assert.equal(res.body.attempts[0].status, 'completed')
  } finally {
    restore()
  }
})

// The "unaffected" half of the spec scenario, made concrete: an in-progress
// attempt's row is never read OR written by the reactivate call above (the
// prior test already proved quiz_attempts is untouched entirely), so its
// own status/cycle are exactly what a direct read of it would still show —
// modeled here by reading it back unchanged via the admin :id endpoint.
test('attempt lifecycle — an in-progress attempt on the OLD cycle keeps its own status after a reactivation of the quiz', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    {
      table: 'quiz_attempts',
      result: {
        data: {
          id: OLD_ATTEMPT_UUID,
          quiz_id: QUIZ_ID,
          cycle: 1,
          status: 'in_progress',
          total_questions: null,
          correct_count: null,
          score_percent: null,
          started_at: '2026-01-01T00:00:00.000Z',
          submitted_at: null,
          quiz: { id: QUIZ_ID, title: 'Quiz' },
          user: { id: USER.id, full_name: USER.full_name, email: USER.email, punto_de_venta: USER.punto_de_venta }
        },
        error: null
      }
    },
    { table: 'quiz_attempt_answers', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/attempts/${OLD_ATTEMPT_UUID}`)
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.status, 'in_progress')
    assert.equal(res.body.cycle, 1)
  } finally {
    restore()
  }
})
