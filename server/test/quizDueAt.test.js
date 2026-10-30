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
const DUE = '2030-06-01T12:00:00.000Z'

test('POST /api/quizzes — an unparseable due_at is rejected (400)', async () => {
  const restore = mockSupabaseSequence([{ table: 'admins', result: { data: ADMIN_A, error: null } }])
  try {
    const res = await request(app)
      .post('/api/quizzes')
      .set('Authorization', `Bearer ${token()}`)
      .send({ title: 'Quiz', due_at: 'not-a-date' })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

test('POST /api/quizzes — a non-string due_at is rejected (400)', async () => {
  const restore = mockSupabaseSequence([{ table: 'admins', result: { data: ADMIN_A, error: null } }])
  try {
    const res = await request(app)
      .post('/api/quizzes')
      .set('Authorization', `Bearer ${token()}`)
      .send({ title: 'Quiz', due_at: 12345 })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

test('POST /api/quizzes — due_at omitted defaults to null, a valid one persists', async () => {
  for (const [body, expected] of [[{ title: 'Quiz' }, null], [{ title: 'Quiz', due_at: DUE }, DUE]]) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: ADMIN_A, error: null } },
      { table: 'quizzes', result: { data: { id: 'quiz-1' }, error: null } }
    ])
    try {
      const res = await request(app).post('/api/quizzes').set('Authorization', `Bearer ${token()}`).send(body)
      assert.equal(res.status, 201)
      const insert = restore.calls.find((c) => c.table === 'quizzes' && c.method === 'insert')
      assert.equal(insert.args[0].due_at, expected)
    } finally {
      restore()
    }
  }
})

test('PUT /api/quizzes/:id — an invalid due_at is rejected (400)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } }
  ])
  try {
    const res = await request(app)
      .put('/api/quizzes/quiz-1')
      .set('Authorization', `Bearer ${token()}`)
      .send({ due_at: 'tomorrow-ish' })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

test('PUT /api/quizzes/:id — a valid due_at updates and null clears it', async () => {
  for (const value of [DUE, null]) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: ADMIN_A, error: null } },
      { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } },
      { table: 'quizzes', result: { data: { id: 'quiz-1', title: 'Quiz', due_at: value }, error: null } }
    ])
    try {
      const res = await request(app)
        .put('/api/quizzes/quiz-1')
        .set('Authorization', `Bearer ${token()}`)
        .send({ due_at: value })
      assert.equal(res.status, 200)
      assert.equal(res.body.due_at, value)
      const update = restore.calls.find((c) => c.table === 'quizzes' && c.method === 'update')
      assert.equal(update.args[0].due_at, value)
      const sel = restore.calls.filter((c) => c.table === 'quizzes' && c.method === 'select').pop()
      assert.match(sel.args[0], /due_at/)
    } finally {
      restore()
    }
  }
})

test('PUT /api/quizzes/:id — due_at left out is not touched', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } },
    { table: 'quizzes', result: { data: { id: 'quiz-1', title: 'New' }, error: null } }
  ])
  try {
    await request(app).put('/api/quizzes/quiz-1').set('Authorization', `Bearer ${token()}`).send({ title: 'New' })
    const update = restore.calls.find((c) => c.table === 'quizzes' && c.method === 'update')
    assert.equal('due_at' in update.args[0], false)
  } finally {
    restore()
  }
})

test('GET /api/quizzes and /api/quizzes/:id select due_at', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },
    { table: 'quizzes', result: { data: [], error: null } },
    { table: 'admins', result: { data: ADMIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } },
    { table: 'quizzes', result: { data: { id: 'quiz-1', due_at: DUE }, error: null } },
    { table: 'questions', result: { data: [], error: null } }
  ])
  try {
    await request(app).get('/api/quizzes').set('Authorization', `Bearer ${token()}`)
    await request(app).get('/api/quizzes/quiz-1').set('Authorization', `Bearer ${token()}`)
    const selects = restore.calls.filter((c) => c.table === 'quizzes' && c.method === 'select' && /title/.test(c.args[0] ?? ''))
    assert.equal(selects.length, 2)
    for (const s of selects) assert.match(s.args[0], /due_at/)
  } finally {
    restore()
  }
})
