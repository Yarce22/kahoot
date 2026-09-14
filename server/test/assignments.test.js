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

// user_ids filter a UUID column, so they must be UUID-SHAPED in every fixture:
// a value like 'u1' reaches Postgres as an uncastable literal (22P02) and
// surfaces as an uncontrolled 500 rather than a 400.
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U_GHOST = '99999999-9999-4999-8999-999999999999'

// --- audience ---

// Every other token helper in this suite relies on signToken's default
// aud:'admin', so nothing exercised the one rejection requireAuth performs
// manually: a VALID, correctly-signed token minted by usuario login must not
// open an admin router.
test('GET /api/assignments — a usuario-audience token is rejected 401', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
    const res = await request(buildApp()).get('/api/assignments').set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 401)
    // Rejected before any database work — the admins lookup never runs.
    assert.deepEqual(restore.calls, [])
  } finally {
    restore()
  }
})

// --- POST / ---

test('POST /api/assignments — missing quiz_id returns 400', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ user_ids: [U1] })
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

// user_ids were checked as non-empty STRINGS but never as UUID-shaped, so
// 'not-a-uuid' reached the users lookup and produced a raw 22P02 cast error
// surfaced as an uncontrolled 500 instead of a 400.
test('POST /api/assignments — a non-UUID user_id is rejected 400 before any lookup', async () => {
  for (const user_ids of [['not-a-uuid'], [U1, 'nope'], [''], [`${U1}x`], [1], [null], [{}]]) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: PLAIN_A, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .post('/api/assignments')
        .set('Authorization', `Bearer ${plainAToken()}`)
        .send({ quiz_id: QUIZ_ID, user_ids })
      assert.equal(res.status, 400, JSON.stringify(user_ids))
      assert.equal(restore.calls.some((c) => c.table === 'users'), false, JSON.stringify(user_ids))
    } finally {
      restore()
    }
  }
})

// user_ids feeds `.in('id', user_ids)`, which supabase-js renders as a GET
// query STRING — a few hundred UUIDs blow past gateway/PostgREST URL length
// limits and come back as an uncontrolled 500. Bounded to the same page cap
// the rest of this router uses, and bounded BEFORE the round trip so the
// oversized request never leaves the process.
test('POST /api/assignments — a user_ids array beyond the page cap is rejected 400 before any lookup', async () => {
  const user_ids = Array.from({ length: 101 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`)
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /100/)
    assert.equal(restore.calls.some((c) => c.table === 'quizzes' || c.table === 'users'), false)
  } finally {
    restore()
  }
})

// The cap itself is a valid request — the boundary is inclusive.
test('POST /api/assignments — exactly the page cap worth of user_ids is accepted', async () => {
  const user_ids = Array.from({ length: 100 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`)
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: user_ids.map((id) => ({ id, punto_de_venta: 'Cerritos', is_active: true })), error: null } },
    { table: 'quiz_assignments', result: { data: user_ids.map((id, i) => ({ id: `assign-${i}`, user_id: id })), error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids })
    assert.equal(res.status, 201)
    assert.equal(res.body.created.length, 100)
  } finally {
    restore()
  }
})

test('POST /api/assignments — an unknown quiz returns 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    // What PostgREST actually answers when `.single()` matches no row.
    { table: 'quizzes', result: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U1] })
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

// `if (error || !row)` cannot tell "no such row" apart from "the database
// itself failed", so a connection drop or a permission error was reported to
// the caller as a confident 404 — a lie that hides an outage behind a routine
// answer. Only PostgREST's no-rows signal (PGRST116) means not-found; anything
// else must surface as the failure it is. Every `.single()` lookup in this
// router answers the same way.
test('POST /api/assignments — a database failure on the quiz lookup is not reported as 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: null, error: { code: '08006', message: 'connection failure' } } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U1] })
    assert.equal(res.status, 500)
  } finally {
    restore()
  }
})

test('DELETE /api/assignments/:id — a database failure on the assignment lookup is not reported as 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_assignments', result: { data: null, error: { code: '08006', message: 'connection failure' } } }
  ])
  try {
    const res = await request(buildApp())
      .delete('/api/assignments/assign-1')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 500)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments' && c.method === 'delete'), false)
  } finally {
    restore()
  }
})

test('POST /api/assignments/reactivate — a database failure on the quiz lookup is not reported as 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: null, error: { code: '08006', message: 'connection failure' } } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments/reactivate')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID })
    assert.equal(res.status, 500)
    // The RPC bumps assignment_cycle unconditionally — it must not run when the
    // ownership check could not even be made.
    assert.equal(restore.calls.some((c) => c.method === 'rpc'), false)
  } finally {
    restore()
  }
})

test('DELETE /api/assignments/:id — an unknown id returns 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_assignments', result: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } }
  ])
  try {
    const res = await request(buildApp())
      .delete('/api/assignments/does-not-exist')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

test('POST /api/assignments/reactivate — an unknown quiz returns 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments/reactivate')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID })
    assert.equal(res.status, 404)
    assert.equal(restore.calls.some((c) => c.method === 'rpc'), false)
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
      .send({ quiz_id: QUIZ_ID, user_ids: [U1] })
    assert.equal(res.status, 403)
  } finally {
    restore()
  }
})

// spec: Cross-store assignment rejected — all-or-nothing, no row created.
// D9 decides WHICH rejection: a distinct 403 for "this id belongs to another
// store" versus 404 for "this id does not exist" is an existence oracle — a
// plain admin could probe arbitrary UUIDs and learn which ones are real users
// in stores they cannot otherwise see. DELETE /:id and PATCH /api/users/:id
// already collapse both cases into the same 404; POST / must too.
test('POST /api/assignments — a cross-store target is rejected 404, nothing inserted', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: U1, punto_de_venta: 'Cerritos', is_active: true }, { id: U2, punto_de_venta: 'Campestre', is_active: true }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U1, U2] })
    assert.equal(res.status, 404)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments'), false)
  } finally {
    restore()
  }
})

// The oracle, stated directly: probing a REAL id in another store and probing
// a made-up id must be byte-for-byte indistinguishable to a non-superadmin.
test('POST /api/assignments — a real cross-store id and a nonexistent id are indistinguishable to a plain admin', async () => {
  const responses = []
  for (const users of [[{ id: U2, punto_de_venta: 'Campestre', is_active: true }], []]) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: PLAIN_A, error: null } },
      { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
      { table: 'users', result: { data: users, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .post('/api/assignments')
        .set('Authorization', `Bearer ${plainAToken()}`)
        .send({ quiz_id: QUIZ_ID, user_ids: [U2] })
      responses.push({ status: res.status, body: res.body })
    } finally {
      restore()
    }
  }
  assert.equal(responses[0].status, 404)
  assert.deepEqual(responses[0], responses[1])
})

// The store guard inspected the users the DB RETURNED, but the write loop
// iterated the RAW request body. An id absent from the lookup was therefore
// never store-checked, yet still got a write attempt.
test('POST /api/assignments — an id that matches no user is rejected 404, nothing inserted', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U_GHOST] })
    assert.equal(res.status, 404)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments'), false)
  } finally {
    restore()
  }
})

// is_active=false IS the soft-delete for this table. A deactivated usuario can
// never log in (userAuth rejects !is_active), so an assignment to one is a row
// that can never be completed — a permanent skew in every completion metric.
// It is rejected exactly the way a non-visible user is: the SAME 404, with no
// wording that would let a caller tell "deactivated" apart from "does not
// exist" or "another store" — that distinction is the enumeration oracle the
// rest of this handler deliberately avoids.
test('POST /api/assignments — an inactive target user is rejected 404, nothing inserted', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: U1, punto_de_venta: 'Cerritos', is_active: false }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U1] })
    assert.equal(res.status, 404)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments'), false)
  } finally {
    restore()
  }
})

// A superadmin has no cross-store boundary to hide, but the soft-delete rule
// is not a scoping rule — it applies to every caller.
test('POST /api/assignments — an inactive target user is rejected for a superadmin too', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: U2, punto_de_venta: 'Campestre', is_active: false }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${superToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U2] })
    assert.equal(res.status, 404)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments'), false)
  } finally {
    restore()
  }
})

// Stated directly: a deactivated id and a made-up id must be byte-for-byte
// indistinguishable, exactly as a cross-store id and a made-up id already are.
test('POST /api/assignments — a deactivated id and a nonexistent id are indistinguishable', async () => {
  const responses = []
  for (const users of [[{ id: U1, punto_de_venta: 'Cerritos', is_active: false }], []]) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: PLAIN_A, error: null } },
      { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
      { table: 'users', result: { data: users, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .post('/api/assignments')
        .set('Authorization', `Bearer ${plainAToken()}`)
        .send({ quiz_id: QUIZ_ID, user_ids: [U1] })
      responses.push({ status: res.status, body: res.body })
    } finally {
      restore()
    }
  }
  assert.equal(responses[0].status, 404)
  assert.deepEqual(responses[0], responses[1])
})

// The filter above is only real if the column is actually read — a lookup that
// never selects is_active sees `undefined` on every row.
test('POST /api/assignments — the target lookup selects is_active', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: U1, punto_de_venta: 'Cerritos', is_active: true }], error: null } },
    { table: 'quiz_assignments', result: { data: [{ id: 'assign-1', user_id: U1 }], error: null } }
  ])
  try {
    await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U1] })
    const selectCall = restore.calls.find((c) => c.table === 'users' && c.method === 'select')
    assert.match(selectCall.args[0], /\bis_active\b/)
  } finally {
    restore()
  }
})

test('POST /api/assignments — a real id mixed with an unknown id inserts NOTHING (all-or-nothing)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: U1, punto_de_venta: 'Cerritos', is_active: true }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U1, U_GHOST] })
    assert.equal(res.status, 404)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments'), false)
  } finally {
    restore()
  }
})

// Duplicates collapse to one verified row: the payload is built from the DB
// result, not the request body, so the same id twice cannot produce two rows.
test('POST /api/assignments — a duplicated user_id produces exactly one row', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: U1, punto_de_venta: 'Cerritos', is_active: true }], error: null } },
    { table: 'quiz_assignments', result: { data: [{ id: 'assign-1', user_id: U1 }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U1, U1] })
    assert.equal(res.status, 201)
    const writes = restore.calls.filter((c) => c.table === 'quiz_assignments' && c.method === 'upsert')
    assert.equal(writes.length, 1)
    assert.equal(writes[0].args[0].length, 1)
  } finally {
    restore()
  }
})

// The batch used to be a per-row insert LOOP. A conflict on row 2 was handled,
// but ANY other mid-loop error (a concurrent delete of the target user, for
// instance) left row 1 durably committed while the caller was told the whole
// request had failed — and `created`/`skipped` were discarded. One conflict-
// tolerant statement is one Postgres transaction: all rows or none.
test('POST /api/assignments — the batch is ONE conflict-tolerant statement, not a per-row loop', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 4 }, error: null } },
    { table: 'users', result: { data: [{ id: U1, punto_de_venta: 'Cerritos', is_active: true }, { id: U2, punto_de_venta: 'Cerritos', is_active: true }], error: null } },
    { table: 'quiz_assignments', result: { data: [{ id: 'assign-1', user_id: U1 }, { id: 'assign-2', user_id: U2 }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U1, U2] })
    assert.equal(res.status, 201)

    const writes = restore.calls.filter((c) => c.table === 'quiz_assignments' && c.method === 'upsert')
    assert.equal(writes.length, 1)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments' && c.method === 'insert'), false)

    const [rows, options] = writes[0].args
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((r) => r.user_id), [U1, U2])
    assert.equal(rows.every((r) => r.cycle === 4 && r.quiz_id === QUIZ_ID && r.assigned_by === PLAIN_A.id), true)
    // onConflict names the UNIQUE (quiz_id, user_id) constraint from migration
    // 009; ignoreDuplicates is what makes Postgres SKIP a conflicting row
    // instead of failing the whole statement.
    assert.deepEqual(options, { onConflict: 'quiz_id,user_id', ignoreDuplicates: true })
  } finally {
    restore()
  }
})

// A non-conflict failure (concurrent delete of the target user -> FK
// violation, for instance) must leave NOTHING committed — with the loop, the
// rows written before it did survive.
test('POST /api/assignments — a non-conflict database error commits nothing and surfaces as an error', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: U1, punto_de_venta: 'Cerritos', is_active: true }, { id: U2, punto_de_venta: 'Cerritos', is_active: true }], error: null } },
    { table: 'quiz_assignments', result: { data: null, error: { code: '23503', message: 'insert or update violates foreign key constraint' } } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U1, U2] })
    assert.equal(res.status >= 400, true)
    // Exactly one write was ever issued, so there is no half-committed batch.
    assert.equal(restore.calls.filter((c) => c.table === 'quiz_assignments' && c.method === 'upsert').length, 1)
  } finally {
    restore()
  }
})

// spec: Superadmin cross-store assignment succeeds
test('POST /api/assignments — a superadmin can assign a cross-store user', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: U2, punto_de_venta: 'Campestre', is_active: true }], error: null } },
    { table: 'quiz_assignments', result: { data: [{ id: 'assign-1', user_id: U2 }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${superToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U2] })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body.created, [{ id: 'assign-1', userId: U2 }])
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
      .send({ quiz_id: QUIZ_ID, user_ids: [U1] })
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
    { table: 'users', result: { data: [{ id: U1, punto_de_venta: 'Cerritos', is_active: true }], error: null } },
    { table: 'quiz_assignments', result: { data: [{ id: 'assign-1', user_id: U1 }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U1] })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body.created, [{ id: 'assign-1', userId: U1 }])
    assert.deepEqual(res.body.skipped, [])
    const upsert = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'upsert')
    assert.equal(upsert.args[0][0].cycle, 3)
  } finally {
    restore()
  }
})

// ignoreDuplicates makes Postgres SKIP a conflicting row silently — it comes
// back neither in the result set nor as an error. "Skipped" is therefore
// computed by diffing the verified target ids against the ids the upsert
// actually returned, not by catching a per-row 23505 anymore.
test('POST /api/assignments — an already-assigned user is skipped, not a hard failure', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id, total_time_seconds: 600, assignment_cycle: 1 }, error: null } },
    { table: 'users', result: { data: [{ id: U1, punto_de_venta: 'Cerritos', is_active: true }, { id: U2, punto_de_venta: 'Cerritos', is_active: true }], error: null } },
    { table: 'quiz_assignments', result: { data: [{ id: 'assign-1', user_id: U1 }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U1, U2] })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body.created, [{ id: 'assign-1', userId: U1 }])
    assert.deepEqual(res.body.skipped, [{ userId: U2, reason: 'already_assigned' }])
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

// GET / had no pagination at all, so the id set it then fed to
// .in('assignment_id', ...) for the attempt-status lookup grew with the table.
test('GET /api/assignments — the list is paged via range(), bounding the follow-up in() lookup', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    // Rows carry a user embed because the select uses `users!inner` — a row
    // without one is a data-integrity anomaly and gets dropped (see the
    // no-user-embed test above).
    {
      table: 'quiz_assignments',
      result: {
        data: [
          { id: 'a1', cycle: 1, user: { id: U1, full_name: 'U1', email: 'u1@x.com', punto_de_venta: 'Cerritos' } },
          { id: 'a2', cycle: 1, user: { id: U2, full_name: 'U2', email: 'u2@x.com', punto_de_venta: 'Campestre' } }
        ],
        error: null,
        count: 5000
      }
    },
    { table: 'quiz_attempts', result: { data: [{ assignment_id: 'a1', cycle: 1, status: 'completed' }], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/assignments?page=2&page_size=25')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.total, 5000)
    assert.equal(res.body.page, 2)
    assert.equal(res.body.page_size, 25)
    assert.equal(res.body.assignments.length, 2)
    assert.equal(res.body.assignments[0].attemptStatus, 'completed')

    const rangeCall = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'range')
    assert.deepEqual(rangeCall.args, [25, 49])

    const selectCall = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'select')
    assert.deepEqual(selectCall.args[1], { count: 'exact' })

    // The in() fan-out can only ever carry one page worth of ids.
    const inCall = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'in')
    assert.deepEqual(inCall.args, ['assignment_id', ['a1', 'a2']])
  } finally {
    restore()
  }
})

test('GET /api/assignments — page_size is capped so the in() fan-out stays bounded', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_assignments', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/assignments?page_size=100000')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.page_size, 100)
    const rangeCall = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'range')
    assert.deepEqual(rangeCall.args, [0, 99])
  } finally {
    restore()
  }
})

// The eq('user.punto_de_venta', ...) assertion above is NOT sufficient on its
// own: PostgREST only EXCLUDES a parent row whose embed fails to match when
// the embed is `!inner`. Drop the `!inner` and the same filter returns every
// assignment with a nulled-out user object — the eq() assertion still passes
// while store isolation is gone. Pin the embed syntax itself.
test('GET /api/assignments — the store-scoped select uses an !inner user embed', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_assignments', result: { data: [], error: null, count: 0 } }
  ])
  try {
    await request(buildApp()).get('/api/assignments').set('Authorization', `Bearer ${plainAToken()}`)
    const selectCall = restore.calls.find((c) => c.table === 'quiz_assignments' && c.method === 'select')
    assert.match(selectCall.args[0], /user:users!inner\(/)
  } finally {
    restore()
  }
})

// Defense in depth behind the !inner embed: if a row ever arrives without a
// user, its store CANNOT be verified, so it must not be served.
test('GET /api/assignments — a row with no user embed is dropped, not served with user:null', async () => {
  const rows = [
    { id: 'a1', quiz_id: QUIZ_ID, quiz: { title: 'Q' }, status: 'pending', cycle: 1, assigned_at: 'x', completed_at: null, user: null },
    { id: 'a2', quiz_id: QUIZ_ID, quiz: { title: 'Q' }, status: 'pending', cycle: 1, assigned_at: 'x', completed_at: null, user: { id: U1, full_name: 'U1', email: 'u1@x.com', punto_de_venta: 'Cerritos' } }
  ]
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_assignments', result: { data: rows, error: null, count: 2 } },
    { table: 'quiz_attempts', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp()).get('/api/assignments').set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.assignments.map((a) => a.id), ['a2'])
    assert.equal(res.body.assignments.some((a) => a.user === null), false)
    // The dropped row's id must not leak into the follow-up fan-out either.
    const inCall = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'in')
    assert.deepEqual(inCall.args, ['assignment_id', ['a2']])
  } finally {
    restore()
  }
})

// Same unvalidated-query-param pattern as GET /api/attempts: quiz_id/user_id
// filter UUID columns and status filters a CHECK enum, none of which were
// checked before being handed to Postgres.
test('GET /api/assignments — an invalid filter value returns 400 instead of reaching Postgres', async () => {
  for (const qs of ['quiz_id=not-a-uuid', 'user_id=nope', 'status=expired', 'status=bogus']) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: SUPER, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .get(`/api/assignments?${qs}`)
        .set('Authorization', `Bearer ${superToken()}`)
      assert.equal(res.status, 400, qs)
      assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments'), false, qs)
    } finally {
      restore()
    }
  }
})

test('GET /api/assignments — every valid assignment status is accepted', async () => {
  for (const status of ['pending', 'completed']) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: SUPER, error: null } },
      { table: 'quiz_assignments', result: { data: [], error: null, count: 0 } }
    ])
    try {
      const res = await request(buildApp())
        .get(`/api/assignments?status=${status}`)
        .set('Authorization', `Bearer ${superToken()}`)
      assert.equal(res.status, 200, status)
    } finally {
      restore()
    }
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

// POST / refuses to assign a quiz the caller does not own; DELETE must refuse
// to UNassign one too, otherwise the ownership boundary is one-directional —
// a plain admin who cannot add a roster entry could still remove one.
test('DELETE /api/assignments/:id — a non-owner admin gets 403 even for an in-store assignment', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_assignments', result: { data: { id: 'assign-1', quiz_id: QUIZ_ID, user: { punto_de_venta: 'Cerritos' }, quiz: { id: QUIZ_ID, owner_id: 'someone-else' } }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .delete('/api/assignments/assign-1')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 403)
    assert.equal(restore.calls.some((c) => c.table === 'quiz_assignments' && c.method === 'delete'), false)
  } finally {
    restore()
  }
})

test('DELETE /api/assignments/:id — a superadmin bypasses quiz ownership', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_assignments', result: { data: { id: 'assign-1', quiz_id: QUIZ_ID, user: { punto_de_venta: 'Campestre' }, quiz: { id: QUIZ_ID, owner_id: 'someone-else' } }, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null } },
    { table: 'quiz_assignments', result: { data: null, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .delete('/api/assignments/assign-1')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 204)
  } finally {
    restore()
  }
})

test('DELETE /api/assignments/:id — an unassignment attempt on an already-attempted assignment returns 409', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_assignments', result: { data: { id: 'assign-1', quiz_id: QUIZ_ID, user: { punto_de_venta: 'Cerritos' }, quiz: { id: QUIZ_ID, owner_id: PLAIN_A.id } }, error: null } },
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
    { table: 'quiz_assignments', result: { data: { id: 'assign-1', quiz_id: QUIZ_ID, user: { punto_de_venta: 'Campestre' }, quiz: { id: QUIZ_ID, owner_id: PLAIN_A.id } }, error: null } }
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
    { table: 'quiz_assignments', result: { data: { id: 'assign-1', quiz_id: QUIZ_ID, user: { punto_de_venta: 'Cerritos' }, quiz: { id: QUIZ_ID, owner_id: PLAIN_A.id } }, error: null } },
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

// POST / validates user_ids as a non-empty array; reactivate did not validate
// it at all. An empty array or a bare string reached the RPC, which bumps the
// quiz's assignment_cycle BEFORE matching any rows — so a request that could
// never match anything still advanced the cycle.
test('POST /api/assignments/reactivate — an invalid user_ids is rejected 400 before the RPC runs', async () => {
  for (const user_ids of [[], U1, [1, 2], [null], {}, ['not-a-uuid'], [U1, 'nope'], [`${U1}x`]]) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: PLAIN_A, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .post('/api/assignments/reactivate')
        .set('Authorization', `Bearer ${plainAToken()}`)
        .send({ quiz_id: QUIZ_ID, user_ids })
      assert.equal(res.status, 400, `user_ids=${JSON.stringify(user_ids)}`)
      assert.equal(restore.calls.some((c) => c.method === 'rpc'), false)
    } finally {
      restore()
    }
  }
})

test('POST /api/assignments/reactivate — an omitted user_ids still means "every assignment" (null)', async () => {
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
    const rpcCall = restore.calls.find((c) => c.method === 'rpc')
    assert.equal(rpcCall.args[0].target_user_ids, null)
  } finally {
    restore()
  }
})

// The RPC bumps assignment_cycle unconditionally, before it matches rows. A
// zero-match reactivate therefore DID advance the cycle while reporting
// `cycle: null` — a 200 whose payload contradicted the database.
test('POST /api/assignments/reactivate — a zero-match run reports the real, already-bumped cycle', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quizzes', result: { data: { owner_id: PLAIN_A.id }, error: null } },
    { rpc: 'reactivate_quiz_assignments', result: { data: [], error: null } },
    { table: 'quizzes', result: { data: { assignment_cycle: 7 }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/assignments/reactivate')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ quiz_id: QUIZ_ID, user_ids: [U2] })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { reactivated: 0, cycle: 7 })
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
