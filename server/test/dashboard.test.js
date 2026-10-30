import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import 'express-async-errors'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.AUTH_MODE = 'jwt'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { dashboardRouter } = await import('../src/routes/dashboard.js')
const { errorHandler } = await import('../src/middleware/errorHandler.js')
const { signToken } = await import('../src/lib/jwt.js')
const { default: request } = await import('supertest')

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/dashboard', dashboardRouter)
  app.use(errorHandler)
  return app
}

const STORE_A = 'Cerritos'
const STORE_B = 'Campestre'
const PLAIN_A = { id: 'admin-a', email: 'a@example.com', role: 'admin', is_active: true, punto_de_venta: STORE_A }
const SUPER = { id: 'super-1', email: 'boss@example.com', role: 'superadmin', is_active: true, punto_de_venta: STORE_A }
const plainToken = () => signToken({ sub: PLAIN_A.id, email: PLAIN_A.email })
const superToken = () => signToken({ sub: SUPER.id, email: SUPER.email })

const row = (over) => ({
  id: 'as-1',
  quiz_id: 'q-1',
  quiz: { title: 'Quiz 1' },
  status: 'completed',
  cycle: 1,
  user: { id: 'u-1', full_name: 'Zoe Zapata', email: 'z@example.com', punto_de_venta: STORE_A },
  attempts: [{ id: 'att-1', cycle: 1, status: 'completed', score_percent: 80, submitted_at: '2026-01-01T00:00:00Z' }],
  ...over
})

test('GET /api/dashboard/progress — no token is rejected 401', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const res = await request(buildApp()).get('/api/dashboard/progress')
    assert.equal(res.status, 401)
    assert.deepEqual(restore.calls, [])
  } finally {
    restore()
  }
})

test('GET /api/dashboard/progress — a usuario-audience token is rejected 401', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
    const res = await request(buildApp()).get('/api/dashboard/progress').set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 401)
    assert.deepEqual(restore.calls, [])
  } finally {
    restore()
  }
})

test('GET /api/dashboard/progress — aggregates per usuario, sorted by name, current cycle only', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    {
      table: 'quiz_assignments',
      result: {
        data: [
          row({ id: 'as-1' }),
          row({
            id: 'as-2',
            quiz_id: 'q-2',
            quiz: { title: 'Quiz 2' },
            status: 'pending',
            cycle: 2,
            // The cycle-1 completed attempt must be ignored; cycle 2 is expired.
            attempts: [
              { cycle: 1, status: 'completed', score_percent: 100, submitted_at: 'x' },
              { id: 'att-2', cycle: 2, status: 'expired', score_percent: 0, submitted_at: null }
            ]
          }),
          row({
            id: 'as-3',
            user: { id: 'u-2', full_name: 'Ana Abad', email: 'a@x.com', punto_de_venta: STORE_A },
            status: 'pending',
            attempts: []
          })
        ],
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp()).get('/api/dashboard/progress').set('Authorization', `Bearer ${plainToken()}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.users.map((u) => u.fullName), ['Ana Abad', 'Zoe Zapata'])

    const [ana, zoe] = res.body.users
    assert.deepEqual(
      { assigned: ana.assigned, completed: ana.completed, completionPercent: ana.completionPercent, averageScore: ana.averageScore },
      { assigned: 1, completed: 0, completionPercent: 0, averageScore: null }
    )
    assert.equal(ana.quizzes[0].attemptStatus, null)
    assert.equal(ana.quizzes[0].attemptId, null)
    const sel = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'select')
    assert.ok(sel.args[0].includes('quiz_attempts(id, '))

    assert.equal(zoe.userId, 'u-1')
    assert.equal(zoe.email, 'z@example.com')
    assert.equal(zoe.puntoDeVenta, STORE_A)
    assert.equal(zoe.assigned, 2)
    assert.equal(zoe.completed, 1)
    assert.equal(zoe.completionPercent, 50)
    assert.equal(zoe.averageScore, 80)
    assert.deepEqual(zoe.quizzes[1], {
      assignmentId: 'as-2',
      quizId: 'q-2',
      quizTitle: 'Quiz 2',
      status: 'pending',
      cycle: 2,
      attemptId: 'att-2',
      attemptStatus: 'expired',
      scorePercent: 0,
      submittedAt: null
    })
  } finally {
    restore()
  }
})

test('GET /api/dashboard/progress — a plain admin is forced to their own store', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_assignments', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp()).get('/api/dashboard/progress').set('Authorization', `Bearer ${plainToken()}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { users: [] })
    const eq = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'eq')
    assert.deepEqual(eq.args, ['user.punto_de_venta', STORE_A])
  } finally {
    restore()
  }
})

test('GET /api/dashboard/progress — a plain admin naming another store gets 403', async () => {
  const restore = mockSupabaseSequence([{ table: 'admins', result: { data: PLAIN_A, error: null } }])
  try {
    const res = await request(buildApp())
      .get(`/api/dashboard/progress?punto_de_venta=${STORE_B}`)
      .set('Authorization', `Bearer ${plainToken()}`)
    assert.equal(res.status, 403)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments'), false)
  } finally {
    restore()
  }
})

test('GET /api/dashboard/progress — superadmin sees every store, or filters by one', async () => {
  let restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_assignments', result: { data: [], error: null } }
  ])
  try {
    await request(buildApp()).get('/api/dashboard/progress?punto_de_venta=').set('Authorization', `Bearer ${superToken()}`)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments' && c.method === 'eq'), false)
  } finally {
    restore()
  }

  restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_assignments', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/dashboard/progress?punto_de_venta=${STORE_B}`)
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    const eq = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'eq')
    assert.deepEqual(eq.args, ['user.punto_de_venta', STORE_B])
  } finally {
    restore()
  }
})

test('GET /api/dashboard/progress — a database error propagates as 500', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_assignments', result: { data: null, error: { message: 'boom' } } }
  ])
  try {
    const res = await request(buildApp()).get('/api/dashboard/progress').set('Authorization', `Bearer ${plainToken()}`)
    assert.equal(res.status, 500)
  } finally {
    restore()
  }
})

test('GET /api/dashboard/progress — a usuario with no full_name does not break the sort, and the capped read is ordered', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    {
      table: 'quiz_assignments',
      result: {
        data: [
          row({ id: 'as-1' }),
          row({ id: 'as-2', user: { id: 'u-2', full_name: null, email: 'n@example.com', punto_de_venta: STORE_A } })
        ],
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp()).get('/api/dashboard/progress').set('Authorization', `Bearer ${plainToken()}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.users.map((u) => u.userId), ['u-2', 'u-1'])
    // Deterministic truncation at MAX_ROWS and a stable per-user quiz order.
    const order = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'order')
    assert.ok(order, 'expected the assignments read to be ordered')
    assert.equal(order.args[0], 'assigned_at')
  } finally {
    restore()
  }
})
