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

const SUPER = { id: 'super-1', email: 'boss@example.com', role: 'superadmin', is_active: true }
const PLAIN = { id: 'admin-2', email: 'a2@example.com', role: 'admin', is_active: true }

const superToken = () => signToken({ sub: SUPER.id, email: SUPER.email })
const plainToken = () => signToken({ sub: PLAIN.id, email: PLAIN.email })

// --- authorization: superadmin-only ---

test('GET /api/admins — a plain admin is forbidden (403)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN, error: null } } // requireAuth
  ])
  try {
    const res = await request(app).get('/api/admins').set('Authorization', `Bearer ${plainToken()}`)
    assert.equal(res.status, 403)
  } finally {
    restore()
  }
})

test('GET /api/admins — a superadmin gets the admin list', async () => {
  const list = [SUPER, PLAIN].map(({ id, email, role, is_active }) => ({ id, email, role, is_active, created_at: 'x' }))
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } }, // requireAuth
    { table: 'admins', result: { data: list, error: null } }   // list
  ])
  try {
    const res = await request(app).get('/api/admins').set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.length, 2)
  } finally {
    restore()
  }
})

// --- create ---

test('POST /api/admins — superadmin creates an admin with a role', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },                                   // requireAuth
    { table: 'admins', result: { data: null, error: { message: 'no rows' } } },                  // pre-check
    { table: 'admins', result: { data: { id: 'new-1', email: 'n@x.com', role: 'admin', is_active: true }, error: null } } // insert
  ])
  try {
    const res = await request(app)
      .post('/api/admins')
      .set('Authorization', `Bearer ${superToken()}`)
      .send({ email: 'n@x.com', password: 'pw12345', role: 'admin' })
    assert.equal(res.status, 201)
    assert.equal(res.body.email, 'n@x.com')
    assert.equal(res.body.role, 'admin')
  } finally {
    restore()
  }
})

test('POST /api/admins — a plain admin cannot create admins (403)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN, error: null } } // requireAuth
  ])
  try {
    const res = await request(app)
      .post('/api/admins')
      .set('Authorization', `Bearer ${plainToken()}`)
      .send({ email: 'n@x.com', password: 'pw12345' })
    assert.equal(res.status, 403)
  } finally {
    restore()
  }
})

test('POST /api/admins — invalid role is rejected (400)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } } // requireAuth
  ])
  try {
    const res = await request(app)
      .post('/api/admins')
      .set('Authorization', `Bearer ${superToken()}`)
      .send({ email: 'n@x.com', password: 'pw12345', role: 'root' })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

// --- role / active changes + guards ---

test('PATCH /api/admins/:id — promotes a plain admin to superadmin', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },                                             // requireAuth
    { table: 'admins', result: { data: { id: PLAIN.id, role: 'admin', is_active: true }, error: null } },  // target fetch
    { table: 'admins', result: { data: { id: PLAIN.id, email: PLAIN.email, role: 'superadmin', is_active: true }, error: null } } // update
  ])
  try {
    const res = await request(app)
      .patch(`/api/admins/${PLAIN.id}`)
      .set('Authorization', `Bearer ${superToken()}`)
      .send({ role: 'superadmin' })
    assert.equal(res.status, 200)
    assert.equal(res.body.role, 'superadmin')
  } finally {
    restore()
  }
})

test('PATCH /api/admins/:id — cannot deactivate your own account (400)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } } // requireAuth (self-check trips before any target fetch)
  ])
  try {
    const res = await request(app)
      .patch(`/api/admins/${SUPER.id}`)
      .set('Authorization', `Bearer ${superToken()}`)
      .send({ is_active: false })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

test('PATCH /api/admins/:id — cannot demote the last active superadmin (409)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },                                              // requireAuth
    { table: 'admins', result: { data: { id: SUPER.id, role: 'superadmin', is_active: true }, error: null } }, // target fetch (self)
    { table: 'admins', result: { count: 1, data: null, error: null } }                                       // active-superadmin count
  ])
  try {
    const res = await request(app)
      .patch(`/api/admins/${SUPER.id}`)
      .set('Authorization', `Bearer ${superToken()}`)
      .send({ role: 'admin' })
    assert.equal(res.status, 409)
  } finally {
    restore()
  }
})

// --- superadmin bypasses quiz ownership ---

test('GET /api/quizzes/:id — a superadmin can open another admin quiz', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },                          // requireAuth
    { table: 'quizzes', result: { data: { owner_id: 'someone-else' }, error: null } },  // requireQuizOwner (bypassed by role)
    { table: 'quizzes', result: { data: { id: 'q9', title: 'Foreign', description: null }, error: null } }, // handler
    { table: 'questions', result: { data: [], error: null } }                           // handler
  ])
  try {
    const res = await request(app).get('/api/quizzes/q9').set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.id, 'q9')
  } finally {
    restore()
  }
})

test('GET /api/quizzes — a superadmin lists every admin quiz with owner info', async () => {
  const rows = [
    { id: 'q1', title: 'A', description: null, created_at: 'x', questions: [{ count: 2 }], owner: { id: 'admin-2', email: 'a2@example.com' } }
  ]
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } }, // requireAuth
    { table: 'quizzes', result: { data: rows, error: null } }  // list (no owner filter for superadmin)
  ])
  try {
    const res = await request(app).get('/api/quizzes').set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body[0].questionCount, 2)
    assert.deepEqual(res.body[0].owner, { id: 'admin-2', email: 'a2@example.com' })
  } finally {
    restore()
  }
})
