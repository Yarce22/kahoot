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
const token = () => signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

// --- POST /api/quizzes ---

test('POST /api/quizzes — total_time_seconds below 60 is rejected (400)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } } // requireAuth
  ])
  try {
    const res = await request(app)
      .post('/api/quizzes')
      .set('Authorization', `Bearer ${token()}`)
      .send({ title: 'Quiz', total_time_seconds: 59 })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

test('POST /api/quizzes — total_time_seconds above 7200 is rejected (400)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } } // requireAuth
  ])
  try {
    const res = await request(app)
      .post('/api/quizzes')
      .set('Authorization', `Bearer ${token()}`)
      .send({ title: 'Quiz', total_time_seconds: 7201 })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

test('POST /api/quizzes — a non-integer total_time_seconds is rejected (400)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } } // requireAuth
  ])
  try {
    const res = await request(app)
      .post('/api/quizzes')
      .set('Authorization', `Bearer ${token()}`)
      .send({ title: 'Quiz', total_time_seconds: 90.5 })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

test('POST /api/quizzes — total_time_seconds omitted defaults to null and persists', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },      // requireAuth
    { table: 'quizzes', result: { data: { id: 'quiz-1' }, error: null } } // insert
  ])
  try {
    const res = await request(app)
      .post('/api/quizzes')
      .set('Authorization', `Bearer ${token()}`)
      .send({ title: 'Quiz' })
    assert.equal(res.status, 201)
    const insert = restore.calls.find((c) => c.table === 'quizzes' && c.method === 'insert')
    assert.equal(insert.args[0].total_time_seconds, null)
  } finally {
    restore()
  }
})

test('POST /api/quizzes — a valid total_time_seconds is persisted', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },      // requireAuth
    { table: 'quizzes', result: { data: { id: 'quiz-1' }, error: null } } // insert
  ])
  try {
    const res = await request(app)
      .post('/api/quizzes')
      .set('Authorization', `Bearer ${token()}`)
      .send({ title: 'Quiz', total_time_seconds: 600 })
    assert.equal(res.status, 201)
    const insert = restore.calls.find((c) => c.table === 'quizzes' && c.method === 'insert')
    assert.equal(insert.args[0].total_time_seconds, 600)
  } finally {
    restore()
  }
})

// --- PUT /api/quizzes/:id ---

test('PUT /api/quizzes/:id — an invalid total_time_seconds is rejected (400)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },                     // requireAuth
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } }    // ownerGate
  ])
  try {
    const res = await request(app)
      .put('/api/quizzes/quiz-1')
      .set('Authorization', `Bearer ${token()}`)
      .send({ total_time_seconds: 30 })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

test('PUT /api/quizzes/:id — a valid total_time_seconds updates the quiz', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },                     // requireAuth
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } },   // ownerGate
    { table: 'quizzes', result: { data: { id: 'quiz-1', title: 'Quiz', description: null, total_time_seconds: 900, created_at: 'x' }, error: null } } // update
  ])
  try {
    const res = await request(app)
      .put('/api/quizzes/quiz-1')
      .set('Authorization', `Bearer ${token()}`)
      .send({ total_time_seconds: 900 })
    assert.equal(res.status, 200)
    assert.equal(res.body.total_time_seconds, 900)
    const update = restore.calls.find((c) => c.table === 'quizzes' && c.method === 'update')
    assert.equal(update.args[0].total_time_seconds, 900)
  } finally {
    restore()
  }
})

test('PUT /api/quizzes/:id — explicit null clears total_time_seconds', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },                     // requireAuth
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } },   // ownerGate
    { table: 'quizzes', result: { data: { id: 'quiz-1', title: 'Quiz', description: null, total_time_seconds: null, created_at: 'x' }, error: null } } // update
  ])
  try {
    const res = await request(app)
      .put('/api/quizzes/quiz-1')
      .set('Authorization', `Bearer ${token()}`)
      .send({ total_time_seconds: null })
    assert.equal(res.status, 200)
    assert.equal(res.body.total_time_seconds, null)
    const update = restore.calls.find((c) => c.table === 'quizzes' && c.method === 'update')
    assert.equal(update.args[0].total_time_seconds, null)
  } finally {
    restore()
  }
})

// --- GET /api/quizzes/:id ---

test('GET /api/quizzes/:id — returns total_time_seconds', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },                     // requireAuth
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } },   // ownerGate
    { table: 'quizzes', result: { data: { id: 'quiz-1', title: 'Quiz', description: null, total_time_seconds: 300 }, error: null } }, // route handler
    { table: 'questions', result: { data: [], error: null } }
  ])
  try {
    const res = await request(app)
      .get('/api/quizzes/quiz-1')
      .set('Authorization', `Bearer ${token()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.total_time_seconds, 300)
  } finally {
    restore()
  }
})
