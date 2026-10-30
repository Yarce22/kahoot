import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.AUTH_MODE = 'jwt'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { app } = await import('../src/index.js')
const { signToken } = await import('../src/lib/jwt.js')
const { default: request } = await import('supertest')

const USER = { id: 'user-1', email: 'u@example.com', full_name: 'Ana', punto_de_venta: 'Cerritos', is_active: true }
const ADMIN = { id: 'admin-a', email: 'a@example.com', role: 'admin', is_active: true, punto_de_venta: 'Cerritos' }
const userToken = () => signToken({ sub: USER.id, email: USER.email, aud: 'usuario' })
const adminToken = () => signToken({ sub: ADMIN.id, email: ADMIN.email })
const AID = '11111111-1111-4111-8111-111111111111'
const PAST = '2020-01-01T00:00:00.000Z'
const FUTURE = '2099-01-01T00:00:00.000Z'

const assignment = (due_at) => ({
  id: AID, quiz_id: 'quiz-1', user_id: USER.id, cycle: 1, status: 'pending',
  quiz: { id: 'quiz-1', total_time_seconds: 3600, due_at }
})
const liveAttempt = { id: 'att-1', status: 'in_progress', started_at: '2030-01-01T00:00:00.000Z', expires_at: '2030-01-01T01:00:00.000Z', time_budget_seconds: 3600 }
const post = () => request(app).post(`/api/user/quizzes/${AID}/attempt`).set('Authorization', `Bearer ${userToken()}`)

test('POST attempt — a past due_at blocks a NEW start with 409 QUIZ_PAST_DUE', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_assignments', result: { data: assignment(PAST), error: null } }
  ])
  try {
    const res = await post()
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'QUIZ_PAST_DUE')
    assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts'), false)
    const sel = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'select')
    assert.match(sel.args[0], /due_at/)
  } finally {
    restore()
  }
})

test('POST attempt — a past due_at also blocks RESUMING an in-progress attempt', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_assignments', result: { data: assignment(PAST), error: null } },
    { table: 'quiz_attempts', result: { data: [liveAttempt], error: null } }
  ])
  try {
    const res = await post()
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'QUIZ_PAST_DUE')
  } finally {
    restore()
  }
})

test("POST attempt — a new attempt's expires_at is clamped to a nearer due_at", async () => {
  const due = new Date(Date.now() + 5 * 60_000).toISOString()
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_assignments', result: { data: assignment(due), error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null } },
    { table: 'quiz_attempts', result: { data: { id: 'att-new', started_at: 'x', expires_at: due, time_budget_seconds: 3600 }, error: null } },
    { table: 'questions', result: { data: [], error: null } }
  ])
  try {
    const res = await post()
    assert.equal(res.status, 201)
    const insert = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'insert')
    assert.equal(insert.args[0].expires_at, due)
  } finally {
    restore()
  }
})

test('POST attempt — a far-future due_at leaves the computed expires_at alone', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_assignments', result: { data: assignment(FUTURE), error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null } },
    { table: 'quiz_attempts', result: { data: { id: 'att-new', started_at: 'x', expires_at: 'y', time_budget_seconds: 3600 }, error: null } },
    { table: 'questions', result: { data: [], error: null } }
  ])
  try {
    const res = await post()
    assert.equal(res.status, 201)
    const insert = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'insert')
    const msFromNow = new Date(insert.args[0].expires_at).getTime() - Date.now()
    assert.ok(msFromNow > 3_500_000 && msFromNow <= 3_600_000)
  } finally {
    restore()
  }
})

test('GET /api/user/quizzes — exposes dueAt (null when the quiz never expires)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: {
        data: [
          { id: 'a1', quiz_id: 'q1', cycle: 1, status: 'pending', assigned_at: 'x', quiz: { id: 'q1', title: 'A', description: null, total_time_seconds: 600, due_at: PAST } },
          { id: 'a2', quiz_id: 'q2', cycle: 1, status: 'pending', assigned_at: 'x', quiz: { id: 'q2', title: 'B', description: null, total_time_seconds: 600 } }
        ],
        error: null
      }
    },
    { table: 'quiz_attempts', result: { data: [], error: null } }
  ])
  try {
    const res = await request(app).get('/api/user/quizzes').set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.quizzes[0].dueAt, PAST)
    assert.equal(res.body.quizzes[1].dueAt, null)
    const sel = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'select')
    assert.match(sel.args[0], /due_at/)
  } finally {
    restore()
  }
})

test('GET /api/user/progress — exposes dueAt', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_assignments', result: { data: [{ id: 'a1', quiz_id: 'q1', quiz: { title: 'A', due_at: PAST }, status: 'pending', cycle: 1, attempts: [] }], error: null } }
  ])
  try {
    const res = await request(app).get('/api/user/progress').set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.body.quizzes[0].dueAt, PAST)
    const sel = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'select')
    assert.match(sel.args[0], /quizzes\(title, due_at\)/)
  } finally {
    restore()
  }
})

test('GET /api/dashboard/progress — exposes dueAt per quiz row', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: [{ id: 'a1', quiz_id: 'q1', quiz: { title: 'A', due_at: PAST }, status: 'pending', cycle: 1, user: { id: 'u1', full_name: 'Z', email: 'z@x', punto_de_venta: 'Cerritos' }, attempts: [] }], error: null }
    }
  ])
  try {
    const res = await request(app).get('/api/dashboard/progress').set('Authorization', `Bearer ${adminToken()}`)
    assert.equal(res.body.users[0].quizzes[0].dueAt, PAST)
    const sel = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'select')
    assert.match(sel.args[0], /quizzes\(title, due_at\)/)
  } finally {
    restore()
  }
})

test('GET /api/assignments — exposes dueAt', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN, error: null } },
    {
      table: 'quiz_assignments',
      result: { data: [{ id: 'a1', quiz_id: 'q1', quiz: { title: 'A', due_at: PAST }, status: 'pending', cycle: 1, assigned_at: 'x', completed_at: null, user: { id: 'u1', full_name: 'Z', email: 'z@x', punto_de_venta: 'Cerritos' } }], error: null, count: 1 }
    },
    { table: 'quiz_attempts', result: { data: [], error: null } }
  ])
  try {
    const res = await request(app).get('/api/assignments').set('Authorization', `Bearer ${adminToken()}`)
    assert.equal(res.body.assignments[0].dueAt, PAST)
    const sel = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'select')
    assert.match(sel.args[0], /quizzes\(title, due_at\)/)
  } finally {
    restore()
  }
})
