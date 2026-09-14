import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
// Mirrors src/index.js:2 — without it an async throw inside a route handler
// never reaches errorHandler, so a crash-class bug hangs the request instead
// of surfacing as a clean 500.
import 'express-async-errors'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.AUTH_MODE = 'jwt'

// Cross-cutting integration coverage for task 6.6: the store-scoping
// contract (spec: Non-Superadmin Read Scoping, Same-Store-Only Assignment,
// Reactivation via Cycle Bump) exercised across users.js, assignments.js
// and attempts.js together, rather than per-router in isolation (see
// users.test.js / assignments.test.js / attempts.test.js for the exhaustive
// per-route cases).

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { usersRouter } = await import('../src/routes/users.js')
const { assignmentsRouter } = await import('../src/routes/assignments.js')
const { attemptsRouter } = await import('../src/routes/attempts.js')
const { errorHandler } = await import('../src/middleware/errorHandler.js')
const { signToken } = await import('../src/lib/jwt.js')
const { default: request } = await import('supertest')

// Standalone app — none of these routers are mounted in src/index.js until
// PR3 (Phase 8 wiring is explicitly out of scope for this batch).
function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/users', usersRouter)
  app.use('/api/assignments', assignmentsRouter)
  app.use('/api/attempts', attemptsRouter)
  app.use(errorHandler)
  return app
}

const STORE_A = 'Cerritos'
const STORE_B = 'Campestre'
const SUPER = { id: 'super-1', email: 'boss@example.com', role: 'superadmin', is_active: true, punto_de_venta: STORE_A }
const ADMIN_A = { id: 'admin-a', email: 'a@example.com', role: 'admin', is_active: true, punto_de_venta: STORE_A }
const superToken = () => signToken({ sub: SUPER.id, email: SUPER.email })
const adminAToken = () => signToken({ sub: ADMIN_A.id, email: ADMIN_A.email })

const QUIZ_ID = 'quiz-1'

// --- cross-store assignment returns 403 ---

test('store scoping — a non-superadmin cannot assign a quiz to a user in another store (403, nothing created)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: 'user-b1', punto_de_venta: STORE_B }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${adminAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: ['user-b1'] })

    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'CROSS_STORE_ASSIGNMENT_FORBIDDEN')
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments' && c.method === 'insert'), false)
  } finally {
    restore()
  }
})

// --- store-scoped list/history work correctly, consistently, across the 3 resources ---

test('store scoping — users, assignments and attempts lists are ALL filtered to the caller\'s own store', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },  // requireAuth for GET /api/users
    { table: 'users', result: { data: [], error: null } },
    { table: 'admins', result: { data: ADMIN_A, error: null } },  // requireAuth for GET /api/assignments
    { table: 'quiz_assignments', result: { data: [], error: null } },
    { table: 'admins', result: { data: ADMIN_A, error: null } },  // requireAuth for GET /api/attempts
    { table: 'quiz_attempts', result: { data: [], error: null } }
  ])
  const app = buildApp()
  try {
    const usersRes = await request(app).get('/api/users').set('Authorization', `Bearer ${adminAToken()}`)
    const assignmentsRes = await request(app).get('/api/assignments').set('Authorization', `Bearer ${adminAToken()}`)
    const attemptsRes = await request(app).get('/api/attempts').set('Authorization', `Bearer ${adminAToken()}`)

    assert.equal(usersRes.status, 200)
    assert.equal(assignmentsRes.status, 200)
    assert.equal(attemptsRes.status, 200)

    const usersEq = restore.calls.find((c) => c.table === 'users' && c.method === 'eq')
    const assignmentsEq = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'eq')
    const attemptsEq = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'eq')

    assert.deepEqual(usersEq.args, ['punto_de_venta', STORE_A])
    assert.deepEqual(assignmentsEq.args, ['user.punto_de_venta', STORE_A])
    assert.deepEqual(attemptsEq.args, ['user.punto_de_venta', STORE_A])
  } finally {
    restore()
  }
})

test('store scoping — a superadmin\'s list requests carry NO forced store filter', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'users', result: { data: [{ id: 'u1' }, { id: 'u2' }], error: null } }
  ])
  try {
    const res = await request(buildApp()).get('/api/users').set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.total, 2)
    assert.equal(restore.calls.some((c) => c.table === 'users' && c.method === 'eq'), false)
  } finally {
    restore()
  }
})

// --- an empty punto_de_venta query param means "no filter", not "the store
// literally named ''" ---
//
// `?punto_de_venta=` is what an HTML <select> whose "All stores" option has
// value="" submits. It is not nullish, so it used to reach resolveStoreFilter
// as an EXPLICIT filter: a superadmin asking for every store got
// .eq('punto_de_venta', '') and therefore zero rows.

test('store scoping — an empty punto_de_venta param leaves a superadmin unfiltered across all three lists', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'users', result: { data: [{ id: 'u1' }, { id: 'u2' }], error: null, count: 2 } },
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_assignments', result: { data: [], error: null, count: 0 } },
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null, count: 0 } }
  ])
  const app = buildApp()
  try {
    const usersRes = await request(app).get('/api/users?punto_de_venta=').set('Authorization', `Bearer ${superToken()}`)
    const assignmentsRes = await request(app).get('/api/assignments?punto_de_venta=').set('Authorization', `Bearer ${superToken()}`)
    const attemptsRes = await request(app).get('/api/attempts?punto_de_venta=').set('Authorization', `Bearer ${superToken()}`)

    assert.equal(usersRes.status, 200)
    assert.equal(assignmentsRes.status, 200)
    assert.equal(attemptsRes.status, 200)
    assert.equal(usersRes.body.users.length, 2)

    const storeFilters = restore.calls.filter(
      (c) => c.method === 'eq' && (c.args[0] === 'punto_de_venta' || c.args[0] === 'user.punto_de_venta')
    )
    assert.deepEqual(storeFilters, [])
  } finally {
    restore()
  }
})

test('store scoping — an empty punto_de_venta param scopes a non-superadmin to their own store, not a 403', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },
    { table: 'users', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp()).get('/api/users?punto_de_venta=').set('Authorization', `Bearer ${adminAToken()}`)
    assert.equal(res.status, 200)
    const eqCall = restore.calls.find((c) => c.table === 'users' && c.method === 'eq')
    assert.deepEqual(eqCall.args, ['punto_de_venta', STORE_A])
  } finally {
    restore()
  }
})

// --- reactivation only touches the caller's own store, even when
// superadmin-visible cross-store rows exist on the same quiz ---
//
// The actual row-level filtering happens inside reactivate_quiz_assignments'
// SQL (migration 009, design D6: `scope_punto_de_venta IS NULL OR
// u.punto_de_venta = scope_punto_de_venta`) — that WHERE clause cannot be
// exercised without a live Postgres instance (see server/test/README.md).
// What IS verifiable here, and is the actual security boundary the route
// owns, is that a non-superadmin's reactivate call ALWAYS sends their own
// store as scope_punto_de_venta — never null, never another store's name —
// regardless of what other stores' assignments exist on the quiz.
test('store scoping — a non-superadmin\'s reactivate call is always scoped to their own store', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } },
    // The RPC itself only reports the rows IT touched — store B's rows
    // (created earlier by a superadmin) are excluded by its own scoping,
    // so only one row comes back even though the quiz has cross-store data.
    { rpc: 'reactivate_quiz_assignments', result: { data: [{ assignment_id: 'assign-a1', new_cycle: 2 }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments/reactivate')
      .set('Authorization', `Bearer ${adminAToken()}`)
      .send({ quiz_id: QUIZ_ID })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { reactivated: 1, cycle: 2 })

    const rpcCall = restore.calls.find((c) => c.method === 'rpc')
    assert.equal(rpcCall.args[0].scope_punto_de_venta, STORE_A)
    assert.notEqual(rpcCall.args[0].scope_punto_de_venta, null)
    assert.notEqual(rpcCall.args[0].scope_punto_de_venta, STORE_B)
  } finally {
    restore()
  }
})

test('store scoping — a superadmin\'s reactivate call is unrestricted (scope_punto_de_venta null) and can affect both stores', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quizzes', result: { data: { owner_id: ADMIN_A.id }, error: null } },
    { rpc: 'reactivate_quiz_assignments', result: { data: [{ assignment_id: 'assign-a1', new_cycle: 2 }, { assignment_id: 'assign-b1', new_cycle: 2 }], error: null } }
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
