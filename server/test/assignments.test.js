import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.AUTH_MODE = 'jwt'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { assignmentsRouter } = await import('../src/routes/assignments.js')
const { errorHandler } = await import('../src/middleware/errorHandler.js')
const { signToken } = await import('../src/lib/jwt.js')
const { default: request } = await import('supertest')

// Standalone app — assignmentsRouter is not mounted in src/index.js until
// PR3 (Phase 8 wiring is explicitly out of scope for this batch).
function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/assignments', assignmentsRouter)
  app.use(errorHandler)
  return app
}

const SUPER = { id: 'super-1', email: 'boss@example.com', role: 'superadmin', is_active: true, punto_de_venta: 'Cerritos' }
const PLAIN_A = { id: 'admin-a', email: 'a@example.com', role: 'admin', is_active: true, punto_de_venta: 'Cerritos' }
const superToken = () => signToken({ sub: SUPER.id, email: SUPER.email })
const plainAToken = () => signToken({ sub: PLAIN_A.id, email: PLAIN_A.email })

const QUIZ_ID = 'quiz-1'

// --- POST / ---

test('POST /api/assignments — missing quiz_id returns 400', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ user_ids: ['u1'] })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

test('POST /api/assignments — empty user_ids returns 400', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [] })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

test('POST /api/assignments — an unknown quiz returns 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: null, error: { message: 'no rows' } } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: ['u1'] })
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

test('POST /api/assignments — a non-owner admin gets 403', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: 'someone-else', total_time_seconds: 600, assignment_cycle: 1 }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: ['u1'] })
    assert.equal(res.status, 403)
  } finally {
    restore()
  }
})

// spec: Cross-store assignment rejected — all-or-nothing, no row created
test('POST /api/assignments — a cross-store target is rejected 403 CROSS_STORE_ASSIGNMENT_FORBIDDEN, nothing inserted', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: 'u1', punto_de_venta: 'Cerritos' }, { id: 'u2', punto_de_venta: 'Campestre' }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: ['u1', 'u2'] })
    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'CROSS_STORE_ASSIGNMENT_FORBIDDEN')
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments' && c.method === 'insert'), false)
  } finally {
    restore()
  }
})

// spec: Superadmin cross-store assignment succeeds
test('POST /api/assignments — a superadmin can assign a cross-store user', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: 'u2', punto_de_venta: 'Campestre' }], error: null } },
    { table: 'quiz_assignments', result: { data: { id: 'assign-1', user_id: 'u2' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${superToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: ['u2'] })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body.created, [{ id: 'assign-1', userId: 'u2' }])
  } finally {
    restore()
  }
})

test('POST /api/assignments — a quiz with no total_time_seconds returns 409 QUIZ_NOT_ASSIGNABLE', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: null, assignment_cycle: 1 }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: ['u1'] })
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'QUIZ_NOT_ASSIGNABLE')
  } finally {
    restore()
  }
})

test('POST /api/assignments — same-store assignment succeeds and seeds cycle from the quiz', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 3 }, error: null } },
    { table: 'users', result: { data: [{ id: 'u1', punto_de_venta: 'Cerritos' }], error: null } },
    { table: 'quiz_assignments', result: { data: { id: 'assign-1', user_id: 'u1' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: ['u1'] })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body.created, [{ id: 'assign-1', userId: 'u1' }])
    assert.deepEqual(res.body.skipped, [])
    const insert = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'insert')
    assert.equal(insert.args[0].cycle, 3)
  } finally {
    restore()
  }
})

test('POST /api/assignments — an already-assigned user is skipped, not a hard failure', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: 'u1', punto_de_venta: 'Cerritos' }, { id: 'u2', punto_de_venta: 'Cerritos' }], error: null } },
    { table: 'quiz_assignments', result: { data: { id: 'assign-1', user_id: 'u1' }, error: null } },
    { table: 'quiz_assignments', result: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: ['u1', 'u2'] })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body.created, [{ id: 'assign-1', userId: 'u1' }])
    assert.deepEqual(res.body.skipped, [{ userId: 'u2', reason: 'already_assigned' }])
  } finally {
    restore()
  }
})

// --- GET / ---

test('GET /api/assignments — a plain admin only sees their own store', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_assignments', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp()).get('/api/assignments').set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 200)
    const eqCall = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'eq' && c.args[0] === 'user.punto_de_venta')
    assert.deepEqual(eqCall.args, ['user.punto_de_venta', 'Cerritos'])
  } finally {
    restore()
  }
})

test('GET /api/assignments — a plain admin requesting another store gets 403', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/assignments?punto_de_venta=Campestre')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 403)
  } finally {
    restore()
  }
})

// --- DELETE /:id ---

test('DELETE /api/assignments/:id — an unassignment attempt on an already-attempted assignment returns 409', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_assignments', result: { data: { id: 'assign-1', quiz_id: QUIZ_ID, user: { punto_de_venta: 'Cerritos' } }, error: null } },
    { table: 'quiz_attempts', result: { data: [{ id: 'attempt-1' }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .delete('/api/assignments/assign-1')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'ASSIGNMENT_HAS_ATTEMPTS')
  } finally {
    restore()
  }
})

test('DELETE /api/assignments/:id — an assignment outside the caller\'s store returns 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_assignments', result: { data: { id: 'assign-1', quiz_id: QUIZ_ID, user: { punto_de_venta: 'Campestre' } }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .delete('/api/assignments/assign-1')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

test('DELETE /api/assignments/:id — an unattempted, in-scope assignment is removed (204)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_assignments', result: { data: { id: 'assign-1', quiz_id: QUIZ_ID, user: { punto_de_venta: 'Cerritos' } }, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null } },
    { table: 'quiz_assignments', result: { data: null, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .delete('/api/assignments/assign-1')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 204)
  } finally {
    restore()
  }
})

// --- POST /reactivate ---

test('POST /api/assignments/reactivate — a non-superadmin scopes the RPC to their own store', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id }, error: null } },
    { rpc: 'reactivate_quiz_assignments', result: { data: [{ assignment_id: 'assign-1', new_cycle: 2 }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments/reactivate')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { reactivated: 1, cycle: 2 })
    const rpcCall = restore.calls.find((c) => c.method === 'rpc')
    assert.equal(rpcCall.args[0].scope_punto_de_venta, 'Cerritos')
  } finally {
    restore()
  }
})

test('POST /api/assignments/reactivate — a superadmin scopes the RPC to every store (null)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id }, error: null } },
    { rpc: 'reactivate_quiz_assignments', result: { data: [{ assignment_id: 'assign-1', new_cycle: 2 }, { assignment_id: 'assign-2', new_cycle: 2 }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments/reactivate')
      .set('Authorization', `Bearer ${superToken()}`)
      .send({ quiz_id: QUIZ_ID })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { reactivated: 2, cycle: 2 })
    const rpcCall = restore.calls.find((c) => c.method === 'rpc')
    assert.equal(rpcCall.args[0].scope_punto_de_venta, null)
  } finally {
    restore()
  }
})

test('POST /api/assignments/reactivate — the RPC\'s quiz_not_found exception maps to 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id }, error: null } },
    { rpc: 'reactivate_quiz_assignments', result: { data: null, error: { message: 'quiz_not_found' } } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments/reactivate')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID })
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

test('POST /api/assignments/reactivate — a non-owner admin gets 403', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: 'someone-else' }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments/reactivate')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID })
    assert.equal(res.status, 403)
  } finally {
    restore()
  }
})
