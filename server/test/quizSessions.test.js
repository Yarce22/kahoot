import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
process.env.AUTH_MODE = 'jwt'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { app } = await import('../src/index.js')
const { signToken } = await import('../src/lib/jwt.js')
const { default: request } = await import('supertest')

const ADMIN_A = { id: 'admin-a', email: 'a@example.com' }
const ADMIN_B = { id: 'admin-b', email: 'b@example.com' }
const QUIZ_ID = 'quiz-1'

test('GET /api/quizzes/:id/sessions — non-owner admin gets 403', async () => {
  const token = signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },                  // requireAuth
    { table: 'quizzes', result: { data: { owner_id: ADMIN_B.id }, error: null } } // requireQuizOwner
  ])
  try {
    const res = await request(app)
      .get(`/api/quizzes/${QUIZ_ID}/sessions`)
      .set('Authorization', `Bearer ${token}`)

    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'Not the quiz owner')
  } finally {
    restore()
  }
})

test('GET /api/quizzes/:id/sessions — owner gets finished sessions with player counts, newest first', async () => {
  const token = signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

  // Supabase returns the players count as a nested aggregate array: players:[{count}].
  const rows = [
    {
      id: 'sess-2', pin: '222222', status: 'finished',
      started_at: '2026-07-08T14:30:00Z', ended_at: '2026-07-08T14:45:00Z',
      created_at: '2026-07-08T14:29:00Z', players: [{ count: 12 }]
    },
    {
      id: 'sess-1', pin: '111111', status: 'finished',
      started_at: '2026-07-05T09:10:00Z', ended_at: '2026-07-05T09:20:00Z',
      created_at: '2026-07-05T09:09:00Z', players: [{ count: 8 }]
    }
  ]

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },                   // requireAuth
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } }, // requireQuizOwner
    { table: 'game_sessions', result: { data: rows, error: null } }                // route handler
  ])
  try {
    const res = await request(app)
      .get(`/api/quizzes/${QUIZ_ID}/sessions`)
      .set('Authorization', `Bearer ${token}`)

    assert.equal(res.status, 200)
    assert.equal(res.body.sessions.length, 2)
    assert.deepEqual(res.body.sessions[0], {
      id: 'sess-2', pin: '222222', status: 'finished',
      startedAt: '2026-07-08T14:30:00Z', endedAt: '2026-07-08T14:45:00Z',
      createdAt: '2026-07-08T14:29:00Z', playerCount: 12
    })
    assert.equal(res.body.sessions[1].playerCount, 8)
  } finally {
    restore()
  }
})

test('GET /api/quizzes/:id/sessions — owner with no finished sessions gets an empty list', async () => {
  const token = signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },                   // requireAuth
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } }, // requireQuizOwner
    { table: 'game_sessions', result: { data: [], error: null } }                  // route handler
  ])
  try {
    const res = await request(app)
      .get(`/api/quizzes/${QUIZ_ID}/sessions`)
      .set('Authorization', `Bearer ${token}`)

    assert.equal(res.status, 200)
    assert.deepEqual(res.body.sessions, [])
  } finally {
    restore()
  }
})
