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

test('GET /api/quizzes/:id — admin A cannot access a quiz owned by admin B (403)', async () => {
  const token = signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },              // requireAuth
    { table: 'quizzes', result: { data: { owner_id: ADMIN_B.id }, error: null } } // requireQuizOwner
  ])
  try {
    const res = await request(app)
      .get(`/api/quizzes/${QUIZ_ID}`)
      .set('Authorization', `Bearer ${token}`)

    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'Not the quiz owner')
  } finally {
    restore()
  }
})

test('GET /api/quizzes/:id — the owning admin can access their own quiz', async () => {
  const token = signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },                 // requireAuth
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } }, // requireQuizOwner
    { table: 'quizzes', result: { data: { id: QUIZ_ID, title: 'Owned quiz', description: null }, error: null } }, // route handler
    { table: 'questions', result: { data: [], error: null } }                    // route handler
  ])
  try {
    const res = await request(app)
      .get(`/api/quizzes/${QUIZ_ID}`)
      .set('Authorization', `Bearer ${token}`)

    assert.equal(res.status, 200)
    assert.equal(res.body.id, QUIZ_ID)
    assert.equal(res.body.title, 'Owned quiz')
    assert.deepEqual(res.body.questions, [])
  } finally {
    restore()
  }
})

const QUESTION_ID = 'question-1'

test('PUT /api/questions/:id — non-owner admin gets 403', async () => {
  const token = signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },                     // requireAuth
    { table: 'questions', result: { data: { quiz_id: QUIZ_ID }, error: null } },     // requireQuizOwner resolveQuizId('question')
    { table: 'quizzes', result: { data: { owner_id: ADMIN_B.id }, error: null } }     // requireQuizOwner
  ])
  try {
    const res = await request(app)
      .put(`/api/questions/${QUESTION_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Updated text' })

    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'Not the quiz owner')
  } finally {
    restore()
  }
})

test('DELETE /api/questions/:id — non-owner admin gets 403', async () => {
  const token = signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },                     // requireAuth
    { table: 'questions', result: { data: { quiz_id: QUIZ_ID }, error: null } },     // requireQuizOwner resolveQuizId('question')
    { table: 'quizzes', result: { data: { owner_id: ADMIN_B.id }, error: null } }     // requireQuizOwner
  ])
  try {
    const res = await request(app)
      .delete(`/api/questions/${QUESTION_ID}`)
      .set('Authorization', `Bearer ${token}`)

    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'Not the quiz owner')
  } finally {
    restore()
  }
})

const PIN = '654321'

test('POST /api/sessions/:pin/start — non-owner admin gets 403', async () => {
  const token = signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },                          // requireAuth
    { table: 'game_sessions', result: { data: { quiz_id: QUIZ_ID }, error: null } },      // resolveQuizIdFromPin
    { table: 'quizzes', result: { data: { owner_id: ADMIN_B.id }, error: null } }          // requireQuizOwner
  ])
  try {
    const res = await request(app)
      .post(`/api/sessions/${PIN}/start`)
      .set('Authorization', `Bearer ${token}`)

    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'Not the quiz owner')
  } finally {
    restore()
  }
})

test('GET /api/sessions/:pin/results — non-owner admin gets 403', async () => {
  const token = signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },                          // requireAuth
    { table: 'game_sessions', result: { data: { quiz_id: QUIZ_ID }, error: null } },      // resolveQuizIdFromPin
    { table: 'quizzes', result: { data: { owner_id: ADMIN_B.id }, error: null } }          // requireQuizOwner
  ])
  try {
    const res = await request(app)
      .get(`/api/sessions/${PIN}/results`)
      .set('Authorization', `Bearer ${token}`)

    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'Not the quiz owner')
  } finally {
    restore()
  }
})
