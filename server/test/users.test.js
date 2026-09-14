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

// --- search-filter pipeline model ---
//
// There is no live database in this suite, so "does this search MATCH that
// row" is answered by modelling the rewrites the emitted filter still goes
// through before it reaches data:
//   1. PostgREST unescapes the quoted value (`\X` -> `X`).
//   2. For a like/ilike value ONLY, PostgREST rewrites EVERY `*` into `%` —
//      its documented URL-friendly alias for the LIKE wildcard — with no
//      awareness of a backslash in front of it. A regex operator (match/imatch)
//      receives its pattern verbatim.
//   3. Postgres applies the result: LIKE is anchored with `%`/`_` wildcards and
//      `\` escapes, `~*` is an unanchored case-insensitive regex.
// Step 2 is why an escaped `\*` used to arrive as `\%` — a literal PERCENT
// SIGN — and nothing at all maps back to `*`, so no like/ilike escaping can
// express a literal asterisk.
const escapeRegExpChar = (c) => c.replace(/[\\^$.|?*+()[\]{}]/g, (m) => `\\${m}`)

function matchesSearchFilter(orFilter, value) {
  const branch = /^full_name\.(\w+)\."((?:[^"\\]|\\.)*)"/.exec(orFilter)
  assert.ok(branch, `unrecognized search filter: ${orFilter}`)
  const [, op, quoted] = branch
  const unescaped = quoted.replace(/\\(.)/g, '$1')
  const pattern = op === 'like' || op === 'ilike' ? unescaped.replace(/\*/g, '%') : unescaped

  if (op === 'match' || op === 'imatch') {
    return new RegExp(pattern, op === 'imatch' ? 'i' : '').test(value)
  }

  let rx = '^'
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') {
      i += 1
      rx += escapeRegExpChar(pattern[i] ?? '\\')
      continue
    }
    if (c === '%') { rx += '[\\s\\S]*'; continue }
    if (c === '_') { rx += '[\\s\\S]'; continue }
    rx += escapeRegExpChar(c)
  }
  return new RegExp(`${rx}$`, op === 'ilike' ? 'i' : '').test(value)
}

async function emittedSearchFilter(q) {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'users', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/users?q=${encodeURIComponent(q)}`)
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200, q)
    return restore.calls.find((c) => c.table === 'users' && c.method === 'or').args[0]
  } finally {
    restore()
  }
}

// --- audience ---

// Every other token helper in this suite relies on signToken's default
// aud:'admin', so nothing exercised the one rejection requireAuth performs
// manually: a VALID, correctly-signed token minted by usuario login must not
// open an admin router.
test('GET /api/users — a usuario-audience token is rejected 401', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
    const res = await request(buildApp()).get('/api/users').set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 401)
    // Rejected before any database work — the admins lookup never runs.
    assert.deepEqual(restore.calls, [])
  } finally {
    restore()
  }
})

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
    // `count` is what PostgREST reports for a `{ count: 'exact' }` select —
    // the real match total, not the length of the page returned.
    { table: 'users', result: { data: [{ id: 'u1' }, { id: 'u2' }], error: null, count: 2 } }
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

// `req.query.is_active === 'true'` made EVERY value that is not that exact
// string — 'TRUE', '1', 'yes', a typo — a silent filter for is_active=false,
// the OPPOSITE of what the caller asked for, answered 200. Every other filter
// in this PR rejects a malformed value; this one now does too.
test('GET /api/users — a malformed is_active is rejected 400 instead of silently filtering false', async () => {
  for (const value of ['TRUE', 'True', '1', '0', 'yes', 'no', 'ture', '']) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: SUPER, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .get(`/api/users?is_active=${encodeURIComponent(value)}`)
        .set('Authorization', `Bearer ${superToken()}`)
      assert.equal(res.status, 400, JSON.stringify(value))
      assert.equal(restore.calls.some((c) => c.table === 'users'), false, JSON.stringify(value))
    } finally {
      restore()
    }
  }
})

test('GET /api/users — is_active=true and is_active=false reach the query as booleans', async () => {
  for (const [value, expected] of [['true', true], ['false', false]]) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: SUPER, error: null } },
      { table: 'users', result: { data: [], error: null, count: 0 } }
    ])
    try {
      const res = await request(buildApp())
        .get(`/api/users?is_active=${value}`)
        .set('Authorization', `Bearer ${superToken()}`)
      assert.equal(res.status, 200, value)
      const eqCall = restore.calls.find((c) => c.table === 'users' && c.method === 'eq' && c.args[0] === 'is_active')
      assert.deepEqual(eqCall.args, ['is_active', expected], value)
    } finally {
      restore()
    }
  }
})

test('GET /api/users — an omitted is_active applies no status filter', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'users', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp()).get('/api/users').set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(restore.calls.some((c) => c.table === 'users' && c.method === 'eq' && c.args[0] === 'is_active'), false)
  } finally {
    restore()
  }
})

// spec (route contract): GET /?punto_de_venta&q&is_active&page&page_size —
// `q` was silently dropped from the implementation.
test('GET /api/users — q searches full_name and email with a single OR filter', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'users', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/users?q=ana')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    const orCall = restore.calls.find((c) => c.table === 'users' && c.method === 'or')
    // `imatch` (Postgres `~*`) rather than `ilike`: an unanchored regex is the
    // same substring search, minus PostgREST's `*` -> `%` rewrite of like/ilike
    // values, which made a literal asterisk impossible to express.
    assert.deepEqual(orCall.args, ['full_name.imatch."ana",email.imatch."ana"'])
  } finally {
    restore()
  }
})

// A comma separates the two branches of PostgREST's `or`, and a double quote
// terminates a quoted value — an unescaped one would let the search box
// rewrite the filter expression itself.
test('GET /api/users — q escapes the characters that delimit PostgREST or() syntax', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'users', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/users?q=${encodeURIComponent('a,b"c')}`)
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    const orCall = restore.calls.find((c) => c.table === 'users' && c.method === 'or')
    assert.deepEqual(orCall.args, ['full_name.imatch."a,b\\"c",email.imatch."a,b\\"c"'])
  } finally {
    restore()
  }
})

// Under `~*` the wildcard problem inverts: `%` and `_` are ordinary characters
// to a regex and need no escaping at all, while the regex metacharacters —
// `*` among them — are escaped so the term can only match itself. The doubled
// backslash is the PostgREST quoted-value layer; it collapses back to a single
// `\` before Postgres sees the pattern.
test('GET /api/users — q escapes regex metacharacters and leaves LIKE wildcards literal', async () => {
  const cases = [
    ['a%b_c', 'a%b_c'],
    ['*', '\\\\*'],
    ['john_doe', 'john_doe'],
    ['100%', '100%'],
    ['a.b', 'a\\\\.b'],
    ['(x)', '\\\\(x\\\\)']
  ]
  for (const [q, expected] of cases) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: SUPER, error: null } },
      { table: 'users', result: { data: [], error: null, count: 0 } }
    ])
    try {
      const res = await request(buildApp())
        .get(`/api/users?q=${encodeURIComponent(q)}`)
        .set('Authorization', `Bearer ${superToken()}`)
      assert.equal(res.status, 200, q)
      const orCall = restore.calls.find((c) => c.table === 'users' && c.method === 'or')
      assert.deepEqual(orCall.args, [`full_name.imatch."${expected}",email.imatch."${expected}"`], q)
    } finally {
      restore()
    }
  }
})

// The escaping is only worth anything if the term matches ITSELF. A `*` is the
// case that used to fail silently: escaping it as `\*` was undone by
// PostgREST's unconditional `*` -> `%` rewrite of like/ilike values, so the
// pattern that reached Postgres asked for a literal PERCENT SIGN and a search
// for `*` returned the rows containing `%` instead.
test('GET /api/users — a q containing * matches a literal asterisk, not a percent sign', async () => {
  const starFilter = await emittedSearchFilter('Ana *')
  assert.equal(matchesSearchFilter(starFilter, 'Ana * Beta'), true)
  assert.equal(matchesSearchFilter(starFilter, 'Ana % Beta'), false)

  // ...and the mirror case still holds: `%` finds `%`, not `*`.
  const percentFilter = await emittedSearchFilter('Ana %')
  assert.equal(matchesSearchFilter(percentFilter, 'Ana % Beta'), true)
  assert.equal(matchesSearchFilter(percentFilter, 'Ana * Beta'), false)
})

// The other metacharacters must stay literal too, and a plain term must not
// become a wildcard: `_` matches an underscore, not "any character".
test('GET /api/users — wildcard metacharacters in q match themselves, never anything else', async () => {
  const underscore = await emittedSearchFilter('john_doe')
  assert.equal(matchesSearchFilter(underscore, 'john_doe'), true)
  assert.equal(matchesSearchFilter(underscore, 'johnXdoe'), false)

  const percent = await emittedSearchFilter('100%')
  assert.equal(matchesSearchFilter(percent, 'a 100% score'), true)
  assert.equal(matchesSearchFilter(percent, 'a 100 score'), false)

  // A bare wildcard must not degrade into "match everything".
  const bare = await emittedSearchFilter('%')
  assert.equal(matchesSearchFilter(bare, 'Ana'), false)
})

// A wildcard-only term is a LITERAL search, not an empty one: `%%` looks for
// the two-character string "%%", so a filter must still be applied.
test('GET /api/users — a wildcard-only q searches for it literally rather than matching everything', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'users', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/users?q=${encodeURIComponent('%%')}`)
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    const orCall = restore.calls.find((c) => c.table === 'users' && c.method === 'or')
    assert.deepEqual(orCall.args, ['full_name.imatch."%%",email.imatch."%%"'])
  } finally {
    restore()
  }
})

test('GET /api/users — a blank q applies no search filter at all', async () => {
  for (const q of ['', '   ']) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: SUPER, error: null } },
      { table: 'users', result: { data: [], error: null, count: 0 } }
    ])
    try {
      const res = await request(buildApp())
        .get(`/api/users?q=${encodeURIComponent(q)}`)
        .set('Authorization', `Bearer ${superToken()}`)
      assert.equal(res.status, 200, JSON.stringify(q))
      assert.equal(restore.calls.some((c) => c.table === 'users' && c.method === 'or'), false, JSON.stringify(q))
    } finally {
      restore()
    }
  }
})

// Paging used to fetch the whole matching set and slice it in JS. PostgREST
// caps a response at max-rows, so `total` was really "rows this response
// happened to contain" and every page past the cap was unreachable.
test('GET /api/users — pages are requested from the database via range(), with an exact count', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'users', result: { data: [{ id: 'u51' }, { id: 'u52' }], error: null, count: 4310 } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/users?page=3&page_size=25')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    // `total` is the DB's count, NOT data.length — the whole point of the fix.
    assert.equal(res.body.total, 4310)
    assert.equal(res.body.page, 3)
    assert.equal(res.body.page_size, 25)
    assert.equal(res.body.users.length, 2)

    const rangeCall = restore.calls.find((c) => c.table === 'users' && c.method === 'range')
    assert.deepEqual(rangeCall.args, [50, 74])

    const selectCall = restore.calls.find((c) => c.table === 'users' && c.method === 'select')
    assert.deepEqual(selectCall.args[1], { count: 'exact' })
  } finally {
    restore()
  }
})

test('GET /api/users — a page beyond the PostgREST row cap is still reachable', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'users', result: { data: [{ id: 'u2001' }], error: null, count: 4310 } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/users?page=41&page_size=50')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.users.length, 1)
    const rangeCall = restore.calls.find((c) => c.table === 'users' && c.method === 'range')
    assert.deepEqual(rangeCall.args, [2000, 2049])
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
    // What PostgREST actually answers when `.single()` matches no row.
    { table: 'users', result: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } } // target lookup miss
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

// `if (error || !row)` cannot tell "no such row" apart from "the database
// itself failed", so a connection drop or a permission error was reported to
// the caller as a confident 404 — a lie that hides an outage behind a routine
// answer. The write-back below the lookup already gated its 404 on PGRST116;
// the lookup itself did not.
test('PATCH /api/users/:id — a database failure on the target lookup is not reported as 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'users', result: { data: null, error: { code: '08006', message: 'connection failure' } } }
  ])
  try {
    const res = await request(buildApp())
      .patch('/api/users/u1')
      .set('Authorization', `Bearer ${plainAToken()}`)
      .send({ full_name: 'Renamed' })
    assert.equal(res.status, 500)
    // Nothing may be written when the target could not be verified.
    assert.equal(restore.calls.some((c) => c.table === 'users' && c.method === 'update'), false)
  } finally {
    restore()
  }
})
