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
const { attemptsRouter } = await import('../src/routes/attempts.js')
const { errorHandler } = await import('../src/middleware/errorHandler.js')
const { signToken } = await import('../src/lib/jwt.js')
const { default: request } = await import('supertest')

// Standalone app — attemptsRouter is not mounted in src/index.js until PR3
// (Phase 8 wiring is explicitly out of scope for this batch).
function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/attempts', attemptsRouter)
  app.use(errorHandler)
  return app
}

const SUPER = { id: 'super-1', email: 'boss@example.com', role: 'superadmin', is_active: true, punto_de_venta: 'Cerritos' }
const PLAIN_A = { id: 'admin-a', email: 'a@example.com', role: 'admin', is_active: true, punto_de_venta: 'Cerritos' }
const superToken = () => signToken({ sub: SUPER.id, email: SUPER.email })
const plainAToken = () => signToken({ sub: PLAIN_A.id, email: PLAIN_A.email })

// quiz_attempts.user_id / .quiz_id are UUID columns, so the filter fixtures
// must be UUID-shaped — a 'u1' would be rejected by the route's validation
// exactly as Postgres would reject it.
const USER_UUID = '11111111-2222-4333-8444-555555555555'

// --- audience ---

// Every other token helper in this suite relies on signToken's default
// aud:'admin', so nothing exercised the one rejection requireAuth performs
// manually: a VALID, correctly-signed token minted by usuario login must not
// open an admin router.
test('GET /api/attempts — a usuario-audience token is rejected 401', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
    const res = await request(buildApp()).get('/api/attempts').set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 401)
    // Rejected before any database work — the admins lookup never runs.
    assert.deepEqual(restore.calls, [])
  } finally {
    restore()
  }
})

// --- GET / ---

test('GET /api/attempts — a plain admin is scoped to their own store', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp()).get('/api/attempts').set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 200)
    const eqCall = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'eq' && c.args[0] === 'user.punto_de_venta')
    assert.deepEqual(eqCall.args, ['user.punto_de_venta', 'Cerritos'])
  } finally {
    restore()
  }
})

// The eq('user.punto_de_venta', ...) assertion above is NOT sufficient on its
// own: PostgREST only EXCLUDES a parent row whose embed fails to match when
// the embed is `!inner`. Drop the `!inner` and the same filter returns every
// attempt with a nulled-out user object — the eq() assertion still passes
// while store isolation is gone. Pin the embed syntax itself.
test('GET /api/attempts — the store-scoped select uses an !inner user embed', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null, count: 0 } }
  ])
  try {
    await request(buildApp()).get('/api/attempts').set('Authorization', `Bearer ${plainAToken()}`)
    const selectCall = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'select')
    assert.match(selectCall.args[0], /user:users!inner\(/)
  } finally {
    restore()
  }
})

// Defense in depth behind the !inner embed: if a row ever arrives without a
// user, its store CANNOT be verified, so it must not be served.
test('GET /api/attempts — a row with no user embed is dropped, not served with user:null', async () => {
  const rows = [
    { id: 'a1', quiz_id: 'q1', cycle: 1, status: 'completed', total_questions: 1, correct_count: 1, score_percent: 100, started_at: 'x', submitted_at: 'y', quiz: { id: 'q1', title: 'Quiz 1' }, user: null },
    { id: 'a2', quiz_id: 'q1', cycle: 1, status: 'completed', total_questions: 1, correct_count: 1, score_percent: 100, started_at: 'x', submitted_at: 'y', quiz: { id: 'q1', title: 'Quiz 1' }, user: { id: USER_UUID, full_name: 'U1', email: 'u1@x.com', punto_de_venta: 'Cerritos' } }
  ]
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_attempts', result: { data: rows, error: null, count: 2 } }
  ])
  try {
    const res = await request(buildApp()).get('/api/attempts').set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.attempts.map((a) => a.id), ['a2'])
    assert.equal(res.body.attempts.some((a) => a.user === null), false)
  } finally {
    restore()
  }
})

// spec: Conflicting explicit filter rejected
test('GET /api/attempts — an explicit conflicting store filter returns 403', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/attempts?punto_de_venta=Campestre')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 403)
  } finally {
    restore()
  }
})

// spec: Filter by user across quizzes
test('GET /api/attempts — filters by user_id, across quizzes', async () => {
  const rows = [
    { id: 'a1', quiz_id: 'q1', cycle: 1, status: 'completed', total_questions: 5, correct_count: 4, score_percent: 80, started_at: 'x', submitted_at: 'y', quiz: { id: 'q1', title: 'Quiz 1' }, user: { id: USER_UUID, full_name: 'U1', email: 'u1@x.com', punto_de_venta: 'Cerritos' } }
  ]
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_attempts', result: { data: rows, error: null, count: 1 } }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/attempts?user_id=${USER_UUID}`)
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.attempts.length, 1)
    assert.equal(res.body.attempts[0].scorePercent, 80)
    assert.equal(res.body.attempts[0].user.fullName, 'U1')
    const eqCall = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'eq' && c.args[0] === 'user_id')
    assert.deepEqual(eqCall.args, ['user_id', USER_UUID])
  } finally {
    restore()
  }
})

// Every one of these used to be forwarded to Postgres verbatim: `cycle=abc`
// became Number('abc') = NaN inside .eq(), and quiz_id/user_id/status were
// never checked against the UUID columns or the CHECK enum they filter.
test('GET /api/attempts — an invalid filter value returns 400 instead of reaching Postgres', async () => {
  const cases = [
    'cycle=abc',
    'cycle=1.5',
    'cycle=',
    // Number('   ') is 0 and Number.isInteger(0) is true, so a whitespace-only
    // cycle silently became a filter for cycle 0 instead of a 400.
    'cycle=%20',
    'cycle=%09',
    'cycle=%20%20',
    // Number() also reads these shapes, none of which is an integer literal.
    'cycle=0x10',
    'cycle=1e3',
    `cycle=${encodeURIComponent(' 3 ')}`,
    'quiz_id=not-a-uuid',
    `user_id=${USER_UUID}x`,
    'status=bogus',
    'status=pending', // a quiz_assignments status, NOT a quiz_attempts one
    'from=not-a-date',
    'to=yesterday'
  ]
  for (const qs of cases) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: SUPER, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .get(`/api/attempts?${qs}`)
        .set('Authorization', `Bearer ${superToken()}`)
      assert.equal(res.status, 400, qs)
      assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts'), false, qs)
    } finally {
      restore()
    }
  }
})

test('GET /api/attempts — every valid attempt status is accepted', async () => {
  for (const status of ['in_progress', 'completed', 'expired']) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: SUPER, error: null } },
      { table: 'quiz_attempts', result: { data: [], error: null, count: 0 } }
    ])
    try {
      const res = await request(buildApp())
        .get(`/api/attempts?status=${status}`)
        .set('Authorization', `Bearer ${superToken()}`)
      assert.equal(res.status, 200, status)
      const eqCall = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'eq' && c.args[0] === 'status')
      assert.deepEqual(eqCall.args, ['status', status])
    } finally {
      restore()
    }
  }
})

test('GET /api/attempts — a valid cycle reaches the query as a number', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/attempts?cycle=3')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    const eqCall = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'eq' && c.args[0] === 'cycle')
    assert.deepEqual(eqCall.args, ['cycle', 3])
  } finally {
    restore()
  }
})

// spec (route contract): GET /?...&from&to&... filters started_at
test('GET /api/attempts — from/to bound started_at', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/attempts?from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    const gte = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'gte')
    const lte = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'lte')
    assert.deepEqual(gte.args, ['started_at', '2026-01-01T00:00:00.000Z'])
    assert.deepEqual(lte.args, ['started_at', '2026-02-01T00:00:00.000Z'])
  } finally {
    restore()
  }
})

// Date.parse is far more permissive than timestamptz input: Date.parse('5')
// and Date.parse('0') both succeed (as years), so `?from=5` sailed past the
// 400 gate and then blew up inside Postgres as a 500 — the exact failure this
// validation exists to prevent.
test('GET /api/attempts — a date Postgres would reject is a 400, not a 500', async () => {
  for (const qs of ['from=5', 'from=0', 'to=2026', 'from=2026-13-45', `from=${encodeURIComponent('Jan 1 2026')}`, 'to=2026-01', 'from=20260101']) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: SUPER, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .get(`/api/attempts?${qs}`)
        .set('Authorization', `Bearer ${superToken()}`)
      assert.equal(res.status, 400, qs)
      assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts'), false, qs)
    } finally {
      restore()
    }
  }
})

// The raw query string used to be forwarded verbatim. Normalizing it first
// means Postgres always receives a format it accepts, whatever shape the
// client sent.
test('GET /api/attempts — from/to reach the query normalized, not as the raw query string', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp())
      .get(`/api/attempts?from=2026-01-01&to=${encodeURIComponent('2026-02-01T10:30:00+02:00')}`)
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    const gte = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'gte')
    const lte = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'lte')
    assert.deepEqual(gte.args, ['started_at', '2026-01-01T00:00:00.000Z'])
    assert.deepEqual(lte.args, ['started_at', '2026-02-01T08:30:00.000Z'])
  } finally {
    restore()
  }
})

// `new Date('2026-01-15T10:30:00')` — a datetime with NO timezone marker — is
// parsed as SERVER-LOCAL time by the JS engine, while `new Date('2026-01-15')`
// right next to it is parsed as UTC. The same wall-clock value therefore
// normalized to a different instant depending on which shape the client sent
// and on the TZ the server happens to run under, silently shifting every
// range boundary. An explicit UTC marker (`Z` or a ±HH:mm offset) is now
// REQUIRED, so the deployment's timezone can never decide what the caller meant.
test('GET /api/attempts — a datetime with no timezone offset is rejected 400', async () => {
  for (const qs of [
    'from=2026-01-15T10:30:00',
    'to=2026-01-15T10:30:00',
    'from=2026-01-15T10:30:00.500',
    'to=2026-01-15T00:00:00'
  ]) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: SUPER, error: null } }
    ])
    try {
      const res = await request(buildApp())
        .get(`/api/attempts?${qs}`)
        .set('Authorization', `Bearer ${superToken()}`)
      assert.equal(res.status, 400, qs)
      assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts'), false, qs)
    } finally {
      restore()
    }
  }
})

// The two shapes that DO carry an unambiguous instant stay accepted, and a
// bare calendar day keeps its UTC reading (that is what `new Date()` does with
// a date-only string, independently of the server's timezone).
test('GET /api/attempts — an explicit UTC marker or offset is accepted, and a date-only value is read as UTC', async () => {
  const cases = [
    ['from=2026-01-15T10:30:00Z', '2026-01-15T10:30:00.000Z'],
    [`from=${encodeURIComponent('2026-01-15T10:30:00+02:00')}`, '2026-01-15T08:30:00.000Z'],
    [`from=${encodeURIComponent('2026-01-15T10:30:00-05:00')}`, '2026-01-15T15:30:00.000Z'],
    ['from=2026-01-15', '2026-01-15T00:00:00.000Z']
  ]
  for (const [qs, expected] of cases) {
    const restore = mockSupabaseSequence([
      { table: 'admins', result: { data: SUPER, error: null } },
      { table: 'quiz_attempts', result: { data: [], error: null, count: 0 } }
    ])
    try {
      const res = await request(buildApp())
        .get(`/api/attempts?${qs}`)
        .set('Authorization', `Bearer ${superToken()}`)
      assert.equal(res.status, 200, qs)
      const gte = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'gte')
      assert.deepEqual(gte.args, ['started_at', expected], qs)
    } finally {
      restore()
    }
  }
})

// A date-only `to` names a calendar DAY, not the instant that day begins.
// Normalizing `to=2026-01-15` to 2026-01-15T00:00:00.000Z and handing that to
// .lte() excluded every attempt started ON the 15th — the entire final day the
// caller explicitly asked to include. `from` keeps opening at midnight, which
// is already the inclusive edge for a .gte() bound.
test('GET /api/attempts — a date-only `to` includes the whole final day', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/attempts?from=2026-01-01&to=2026-01-15')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    const gte = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'gte')
    const lte = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'lte')
    assert.deepEqual(gte.args, ['started_at', '2026-01-01T00:00:00.000Z'])
    assert.deepEqual(lte.args, ['started_at', '2026-01-15T23:59:59.999Z'])
  } finally {
    restore()
  }
})

// The end-of-day widening applies ONLY to a bare calendar day. A `to` that
// already carries a time is an exact instant and must stay untouched.
test('GET /api/attempts — a `to` that carries a time component is not widened', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/attempts?to=2026-01-15T10:30:00.000Z')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    const lte = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'lte')
    assert.deepEqual(lte.args, ['started_at', '2026-01-15T10:30:00.000Z'])
  } finally {
    restore()
  }
})

test('GET /api/attempts — from/to are optional and independent', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null, count: 0 } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/attempts?from=2026-01-01')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.ok(restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'gte'))
    assert.equal(restore.calls.some((c) => c.table === 'quiz_attempts' && c.method === 'lte'), false)
  } finally {
    restore()
  }
})

// Paging used to fetch the whole matching set and slice it in JS. PostgREST
// caps a response at max-rows, so `total` was really "rows this response
// happened to contain" and every page past the cap was unreachable.
test('GET /api/attempts — pages are requested from the database via range(), with an exact count', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    { table: 'quiz_attempts', result: { data: [], error: null, count: 9001 } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/attempts?page=3&page_size=25')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.total, 9001)
    assert.equal(res.body.page, 3)
    assert.equal(res.body.page_size, 25)

    const rangeCall = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'range')
    assert.deepEqual(rangeCall.args, [50, 74])

    const selectCall = restore.calls.find((c) => c.table === 'quiz_attempts' && c.method === 'select')
    assert.deepEqual(selectCall.args[1], { count: 'exact' })
  } finally {
    restore()
  }
})

// --- GET /:id ---

test('GET /api/attempts/:id — an unknown id returns 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    // What PostgREST actually answers when `.single()` matches no row.
    { table: 'quiz_attempts', result: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/attempts/does-not-exist')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

// `if (error || !row)` cannot tell "no such row" apart from "the database
// itself failed", so a connection drop or a permission error was reported to
// the caller as a confident 404 — a lie that hides an outage behind a routine
// answer. Only PostgREST's no-rows signal (PGRST116) means not-found; anything
// else must surface as the failure it is.
test('GET /api/attempts/:id — a database failure is not reported as 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    { table: 'quiz_attempts', result: { data: null, error: { code: '08006', message: 'connection failure' } } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/attempts/attempt-1')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 500)
  } finally {
    restore()
  }
})

test('GET /api/attempts/:id — an attempt outside the caller\'s store returns 404', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    {
      table: 'quiz_attempts',
      result: {
        data: {
          id: 'attempt-1', quiz_id: 'q1', cycle: 1, status: 'completed', total_questions: 1, correct_count: 1, score_percent: 100, started_at: 'x', submitted_at: 'y',
          quiz: { id: 'q1', title: 'Quiz 1' },
          user: { id: 'u2', full_name: 'U2', email: 'u2@x.com', punto_de_venta: 'Campestre' }
        },
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/attempts/attempt-1')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 404)
  } finally {
    restore()
  }
})

test('GET /api/attempts/:id — an in-scope attempt includes correctAnswer per answer (admin view)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: PLAIN_A, error: null } },
    {
      table: 'quiz_attempts',
      result: {
        data: {
          id: 'attempt-1', quiz_id: 'q1', cycle: 1, status: 'completed', total_questions: 1, correct_count: 0, score_percent: 0, started_at: 'x', submitted_at: 'y',
          quiz: { id: 'q1', title: 'Quiz 1' },
          user: { id: 'u1', full_name: 'U1', email: 'u1@x.com', punto_de_venta: 'Cerritos' }
        },
        error: null
      }
    },
    {
      table: 'quiz_attempt_answers',
      result: {
        data: [
          { question_id: 'question-1', answer_text: 'Paris', selected_option_id: null, is_correct: false, question: { id: 'question-1', text: 'Capital of France?', type: 'open' } }
        ],
        error: null
      }
    },
    {
      table: 'answer_options',
      result: {
        data: [
          { id: 'opt-1', question_id: 'question-1', text: 'paris', is_correct: true }
        ],
        error: null
      }
    }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/attempts/attempt-1')
      .set('Authorization', `Bearer ${plainAToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.answers.length, 1)
    assert.equal(res.body.answers[0].correctAnswer, 'paris')
    assert.equal(res.body.answers[0].isCorrect, false)
  } finally {
    restore()
  }
})

test('GET /api/attempts/:id — a superadmin can view a cross-store attempt', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: SUPER, error: null } },
    {
      table: 'quiz_attempts',
      result: {
        data: {
          id: 'attempt-1', quiz_id: 'q1', cycle: 1, status: 'completed', total_questions: 0, correct_count: 0, score_percent: 0, started_at: 'x', submitted_at: 'y',
          quiz: { id: 'q1', title: 'Quiz 1' },
          user: { id: 'u2', full_name: 'U2', email: 'u2@x.com', punto_de_venta: 'Campestre' }
        },
        error: null
      }
    },
    { table: 'quiz_attempt_answers', result: { data: [], error: null } }
  ])
  try {
    const res = await request(buildApp())
      .get('/api/attempts/attempt-1')
      .set('Authorization', `Bearer ${superToken()}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.user.puntoDeVenta, 'Campestre')
  } finally {
    restore()
  }
})
