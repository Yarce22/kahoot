import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import 'express-async-errors'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.AUTH_MODE = 'jwt'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { userQuizzesRouter } = await import('../src/routes/userQuizzes.js')
const { errorHandler } = await import('../src/middleware/errorHandler.js')
const { signToken } = await import('../src/lib/jwt.js')
const { assertNoAnswerLeak } = await import('../src/lib/userSerializer.js')
const { default: request } = await import('supertest')

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/user', userQuizzesRouter)
  app.use(errorHandler)
  return app
}

const USER = { id: 'user-1', email: 'u@example.com', full_name: 'Ana Usuaria', punto_de_venta: 'Cerritos', is_active: true }
const userToken = () => signToken({ sub: USER.id, email: USER.email, aud: 'usuario' })

test('GET /api/user/progress — no token is rejected 401', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const res = await request(buildApp()).get('/api/user/progress')
    assert.equal(res.status, 401)
    assert.deepEqual(restore.calls, [])
  } finally {
    restore()
  }
})

test('GET /api/user/progress — an admin-audience token is rejected 401', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const adminToken = signToken({ sub: 'admin-1', email: 'a@example.com' })
    const res = await request(buildApp()).get('/api/user/progress').set('Authorization', `Bearer ${adminToken}`)
    assert.equal(res.status, 401)
    assert.deepEqual(restore.calls, [])
  } finally {
    restore()
  }
})

test('GET /api/user/progress — aggregates the caller\'s own assignments, scoped by user id', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } }, // requireUserAuth
    {
      table: 'quiz_assignments',
      result: {
        data: [
          {
            id: 'as-1',
            quiz_id: 'q-1',
            quiz: { title: 'Quiz 1' },
            status: 'completed',
            cycle: 1,
            attempts: [{ id: 'att-1', cycle: 1, status: 'completed', score_percent: 90, submitted_at: '2026-01-01T00:00:00Z' }]
          },
          {
            id: 'as-2',
            quiz_id: 'q-2',
            quiz: { title: 'Quiz 2' },
            status: 'pending',
            cycle: 1,
            attempts: [{ cycle: 1, status: 'in_progress', score_percent: null, submitted_at: null }]
          },
          { id: 'as-3', quiz_id: 'q-3', quiz: null, status: 'pending', cycle: 1, attempts: [] }
        ],
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp()).get('/api/user/progress').set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.assigned, 3)
    assert.equal(res.body.completed, 1)
    assert.equal(res.body.completionPercent, 33)
    assert.equal(res.body.averageScore, 90)
    assert.deepEqual(res.body.quizzes[0], {
      assignmentId: 'as-1',
      quizId: 'q-1',
      title: 'Quiz 1',
      status: 'completed',
      cycle: 1,
      attemptId: 'att-1',
      attemptStatus: 'completed',
      scorePercent: 90,
      submittedAt: '2026-01-01T00:00:00Z',
      dueAt: null
    })
    assert.equal(res.body.quizzes[1].attemptStatus, 'in_progress')
    assert.equal(res.body.quizzes[2].title, null)
    assert.equal(res.body.quizzes[2].attemptStatus, null)
    assert.equal(res.body.quizzes[2].attemptId, null)
    const sel = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'select')
    assert.ok(sel.args[0].includes('quiz_attempts(id, '))

    const eq = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'eq')
    assert.deepEqual(eq.args, ['user_id', USER.id])
  } finally {
    restore()
  }
})

test('GET /api/user/progress — no assignments yields zeros and a null average', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_assignments', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp()).get('/api/user/progress').set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { assigned: 0, completed: 0, completionPercent: 0, averageScore: null, quizzes: [] })
  } finally {
    restore()
  }
})

test('GET /api/user/progress — response carries no correct-answer data', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    {
      table: 'quiz_assignments',
      result: {
        data: [{
          id: 'as-1',
          quiz_id: 'q-1',
          quiz: { title: 'Quiz 1' },
          status: 'completed',
          cycle: 1,
          attempts: [{ cycle: 1, status: 'completed', score_percent: 100, submitted_at: 't' }]
        }],
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp()).get('/api/user/progress').set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 200)
    assertNoAnswerLeak(res.body)
  } finally {
    restore()
  }
})

test('GET /api/user/progress — a database error propagates as 500', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'quiz_assignments', result: { data: null, error: { message: 'boom' } } }
  ])
  try {
    const res = await request(buildApp()).get('/api/user/progress').set('Authorization', `Bearer ${userToken()}`)
    assert.equal(res.status, 500)
  } finally {
    restore()
  }
})
