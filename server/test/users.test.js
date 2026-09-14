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
const { usersRouter } = await import('../src/routes/users.js')
const { errorHandler } = await import('../src/middleware/errorHandler.js')
const { signToken } = await import('../src/lib/jwt.js')
const { default: request } = await import('supertest')

// Standalone app — usersRouter is not mounted in src/index.js until PR3
// (Phase 8 wiring is explicitly out of scope for this batch).
function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/users', usersRouter)
  app.use(errorHandler)
  return app
}

const SUPER = { id: 'super-1', email: 'boss@example.com', role: 'superadmin', is_active: true, punto_de_venta: 'Cerritos' }
const PLAIN_A = { id: 'admin-a', email: 'a@example.com', role: 'admin', is_active: true, punto_de_venta: 'Cerritos' }
const superToken = () => signToken({ sub: SUPER.id, email: SUPER.email })
const plainAToken = () => signToken({ sub: PLAIN_A.id, email: PLAIN_A.email })

// --- GET / ---

test('GET /api/users — a plain admin only sees their own store (resolveStoreFilter)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } }, // requireAuth
    { table: 'users', result: { data: [{ id: 'u1', email: 'u1@x.com', full_name: 'U1', punto_de_venta: 'Cerritos', is_active: true, created_at: 'x' }], error: null } }
  ])
  try {
    const res = await request(buildApp()).get('/api/users').set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.users.length, 1)
    const eqCall = restore.calls.find((c) => c.table === 'users' && c.method === 'eq')
    assert.deepEqual(eqCall.args, ['punto_de_venta', 'Cerritos'])
  } finally {
    restore()
  }
})

test('GET /api/users — a plain admin requesting another store gets 403', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } } // requireAuth
  ])
  try {
    const res = await request(buildApp())
      .get('/api/users?punto_de_venta=Campestre')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 403)
  } finally {
    restore()
  }
})

test('GET /api/users — a superadmin sees every store when no filter is given', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'users', result: { data: [{ id: 'u1' }, { id: 'u2' }], error: null } }
  ])
  try {
    const res = await request(buildApp()).get('/api/users').set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.total, 2)
    const eqCall = restore.calls.find((c) => c.table === 'users' && c.method === 'eq')
    assert.equal(eqCall, undefined)
  } finally {
    restore()
  }
})

// --- POST / ---

test('POST /api/users — missing full_name returns 400', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ email: 'n@x.com', password: 'pw123456', punto_de_venta: 'Cerritos' })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

test('POST /api/users — a password shorter than 8 characters returns 400', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ email: 'n@x.com', password: 'short', full_name: 'N', punto_de_venta: 'Cerritos' })
    assert.equal(res.status, 400)
  } finally {
    restore()
  }
})

// A NUMBER has no `.length`, so `undefined < 8` was false and the value sailed
// past the length gate straight into bcrypt.hash, which throws on a non-string.
test('POST /api/users — a non-string password returns 400, not a crash', async () => {
  for (const password of [12345678, true, { p: 'x' }, ['pw123456']]) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: PLAIN_A, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .post('/api/users')
        .set('Authorization', `Bearer ${plainAToken()}`)
        .send({ email: 'n@x.com', password, full_name: 'N', punto_de_venta: 'Cerritos' })
      assert.equal(res.status, 400, `password=${JSON.stringify(password)}`)
    } finally {
      restore()
    }
  }
})

test('POST /api/users — a non-string full_name returns 400', async () => {
  for (const full_name of [42, true, '   ']) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: PLAIN_A, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .post('/api/users')
        .set('Authorization', `Bearer ${plainAToken()}`)
        .send({ email: 'n@x.com', password: 'pw123456', full_name, punto_de_venta: 'Cerritos' })
      assert.equal(res.status, 400, `full_name=${JSON.stringify(full_name)}`)
    } finally {
      restore()
    }
  }
})

// spec: Non-superadmin creates user outside own store rejected
test('POST /api/users — a plain admin creating a user in another store gets 403 (assertSameStore)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ email: 'n@x.com', password: 'pw123456', full_name: 'N', punto_de_venta: 'Campestre' })
    assert.equal(res.status, 403)
  } finally {
    restore()
  }
})

test('POST /api/users — punto_de_venta omitted defaults to the caller\'s own store', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'users', result: { data: { id: 'new-1', email: 'n@x.com', full_name: 'N', punto_de_venta: 'Cerritos', is_active: true }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ email: 'n@x.com', password: 'pw123456', full_name: 'N' })
    assert.equal(res.status, 201)
    assert.equal(res.body.punto_de_venta, 'Cerritos')
    const insert = restore.calls.find((c) => c.table === 'users' && c.method === 'insert')
    assert.equal(insert.args[0].punto_de_venta, 'Cerritos')
    // Asserted on `password_hash` — the key the route actually writes. The
    // previous assertion named `password`, a key that never exists on the
    // payload, so `undefined !== 'pw123456'` passed no matter what was stored.
    const storedHash = insert.args[0].password_hash
    assert.equal(typeof storedHash, 'string')
    assert.notEqual(storedHash, 'pw123456') // never the plaintext
    assert.match(storedHash, /^\$2[aby]\$/) // bcrypt hash shape
  } finally {
    restore()
  }
})

// Guards the assertion above against silently going tautological again: a
// payload key named `password` must NOT exist, because asserting on it would
// be vacuously true.
test('POST /api/users — the insert payload carries no plaintext `password` key', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'users', result: { data: { id: 'new-1', email: 'n@x.com', full_name: 'N', punto_de_venta: 'Cerritos', is_active: true }, error: null } }
  ])
  try {
    await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ email: 'n@x.com', password: 'pw123456', full_name: 'N' })
    const insert = restore.calls.find((c) => c.table === 'users' && c.method === 'insert')
    assert.equal(Object.prototype.hasOwnProperty.call(insert.args[0], 'password'), false)
  } finally {
    restore()
  }
})

// Ana@X.com and ana@x.com are the same account to a human but two distinct
// rows to a case-sensitive UNIQUE index — and the login lookup is equally
// case-sensitive, so a mis-cased stored email is permanently unloginable.
test('POST /api/users — the email is normalized to trimmed lowercase before insert', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'users', result: { data: { id: 'new-1', email: 'ana@x.com', full_name: 'N', punto_de_venta: 'Cerritos', is_active: true }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ email: '  Ana@X.COM  ', password: 'pw123456', full_name: 'N' })
    assert.equal(res.status, 201)
    const insert = restore.calls.find((c) => c.table === 'users' && c.method === 'insert')
    assert.equal(insert.args[0].email, 'ana@x.com')
  } finally {
    restore()
  }
})

test('POST /api/users — a non-string email returns 400, not a crash', async () => {
  for (const email of [42, true, { a: 1 }]) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: PLAIN_A, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .post('/api/users')
        .set('Authorization', `Bearer ${plainAToken()}`)
        .send({ email, password: 'pw123456', full_name: 'N' })
      assert.equal(res.status, 400, `email=${JSON.stringify(email)}`)
    } finally {
      restore()
    }
  }
})

// spec: Superadmin unrestricted
test('POST /api/users — a superadmin can create a user in any store', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'users', result: { data: { id: 'new-1', email: 'n@x.com', full_name: 'N', punto_de_venta: 'Campestre', is_active: true }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${superToken()}`)
      .send({ email: 'n@x.com', password: 'pw123456', full_name: 'N', punto_de_venta: 'Campestre' })
    assert.equal(res.status, 201)
    assert.equal(res.body.punto_de_venta, 'Campestre')
  } finally {
    restore()
  }
})

test('POST /api/users — a duplicate email returns 409', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'users', result: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/users')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ email: 'dup@x.com', password: 'pw123456', full_name: 'N', punto_de_venta: 'Cerritos' })
    assert.equal(res.status, 409)
  } finally {
    restore()
  }
})

// --- PATCH /:id ---

test('PATCH /api/users/:id — target outside the caller\'s store returns 404 (D9)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'users', result: { data: { id: 'u1', punto_de_venta: 'Campestre' }, error: null } } // target lookup
  ])
  try {
    const res = await request(buildApp())
      .patch('/api/users/u1')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ full_name: 'Renamed' })
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

test('PATCH /api/users/:id — moving the target to another store is a 403 for a non-superadmin', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'users', result: { data: { id: 'u1', punto_de_venta: 'Cerritos' }, error: null } } // target lookup
  ])
  try {
    const res = await request(buildApp())
      .patch('/api/users/u1')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ punto_de_venta: 'Campestre' })
    assert.equal(res.status, 403)
  } finally {
    restore()
  }
})

test('PATCH /api/users/:id — a same-store update succeeds', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'users', result: { data: { id: 'u1', punto_de_venta: 'Cerritos' }, error: null } }, // target lookup
    { table: 'users', result: { data: { id: 'u1', email: 'u1@x.com', full_name: 'Renamed', punto_de_venta: 'Cerritos', is_active: true }, error: null } } // update
  ])
  try {
    const res = await request(buildApp())
      .patch('/api/users/u1')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ full_name: 'Renamed' })
    assert.equal(res.status, 200)
    assert.equal(res.body.full_name, 'Renamed')
  } finally {
    restore()
  }
})

// `null.length` threw a raw TypeError (crash, not 400) and a NUMBER bypassed
// the length gate entirely before reaching bcrypt.hash.
test('PATCH /api/users/:id — a non-string password returns 400, not a crash', async () => {
  for (const password of [null, 12345678, true, { p: 'x' }]) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: PLAIN_A, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .patch('/api/users/u1')
        .set('Authorization', `Bearer ${plainAToken()}`)
        .send({ password })
      assert.equal(res.status, 400, `password=${JSON.stringify(password)}`)
    } finally {
      restore()
    }
  }
})

test('PATCH /api/users/:id — a blank or non-string full_name returns 400', async () => {
  for (const full_name of [null, '', '   ', 42, true]) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: PLAIN_A, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .patch('/api/users/u1')
        .set('Authorization', `Bearer ${plainAToken()}`)
        .send({ full_name })
      assert.equal(res.status, 400, `full_name=${JSON.stringify(full_name)}`)
    } finally {
      restore()
    }
  }
})

test('PATCH /api/users/:id — a valid password is stored as a bcrypt hash', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'users', result: { data: { id: 'u1', punto_de_venta: 'Cerritos' }, error: null } }, // target lookup
    { table: 'users', result: { data: { id: 'u1', email: 'u1@x.com', full_name: 'U1', punto_de_venta: 'Cerritos', is_active: true }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .patch('/api/users/u1')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ password: 'newpw123456' })
    assert.equal(res.status, 200)
    const update = restore.calls.find((c) => c.table === 'users' && c.method === 'update')
    assert.equal(Object.prototype.hasOwnProperty.call(update.args[0], 'password'), false)
    assert.match(update.args[0].password_hash, /^\$2[aby]\$/)
  } finally {
    restore()
  }
})

test('PATCH /api/users/:id — an unknown id returns 404, not 500', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'users', result: { data: null, error: { message: 'no rows' } } } // target lookup miss
  ])
  try {
    const res = await request(buildApp())
      .patch('/api/users/does-not-exist')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ full_name: 'Renamed' })
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})
