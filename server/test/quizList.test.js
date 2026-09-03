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

const ADMIN_A = { id: 'admin-a', email: 'a@example.com', role: 'admin', is_active: true }

test('GET /api/quizzes — each quiz carries its question count', async () => {
  const token = signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

  // Supabase returns a nested aggregate as questions:[{count}].
  const rows = [
    { id: 'q1', title: 'Trivia', description: null, created_at: '2026-07-08T00:00:00Z', questions: [{ count: 3 }] },
    { id: 'q2', title: 'Empty', description: null, created_at: '2026-07-07T00:00:00Z', questions: [{ count: 0 }] }
  ]

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } }, // requireAuth
    { table: 'quizzes', result: { data: rows, error: null } }     // list handler
  ])
  try {
    const res = await request(app)
      .get('/api/quizzes')
      .set('Authorization', `Bearer ${token}`)

    assert.equal(res.status, 200)
    assert.equal(res.body.length, 2)
    assert.equal(res.body[0].questionCount, 3)
    assert.equal(res.body[1].questionCount, 0)
    // The nested aggregate array must not leak to the client.
    assert.equal(res.body[0].questions, undefined)
  } finally {
    restore()
  }
})

test('GET /api/quizzes — missing aggregate defaults questionCount to 0', async () => {
  const token = signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

  const rows = [{ id: 'q1', title: 'Trivia', description: null, created_at: '2026-07-08T00:00:00Z' }]

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },
    { table: 'quizzes', result: { data: rows, error: null } }
  ])
  try {
    const res = await request(app)
      .get('/api/quizzes')
      .set('Authorization', `Bearer ${token}`)

    assert.equal(res.status, 200)
    assert.equal(res.body[0].questionCount, 0)
  } finally {
    restore()
  }
})
