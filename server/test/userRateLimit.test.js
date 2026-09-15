import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
// Mirrors src/index.js:2 — without it an async throw inside a route handler
// never reaches errorHandler, so a crash-class bug hangs the request instead
// of surfacing as a clean 500.
import 'express-async-errors'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.AUTH_MODE = 'jwt'

// Rate limiting for the async (PIN-less) usuario flow, exercised against the
// REAL app (src/index.js) rather than a standalone router app — the limiter
// ordering relative to the router mounts is the whole subject here, and a
// standalone app cannot reproduce it.
//
// Every request below is rejected at the auth layer (401) long before any
// Supabase call, so no response queue is needed: only the limiter's own
// accounting is under test.
const { app, apiLimiter, userFlowLimiter, USER_FLOW_MAX } = await import('../src/index.js')
const { userLoginLimiter } = await import('../src/routes/userAuth.js')
const { resetRateLimits } = await import('./helpers/resetRateLimit.js')
const { default: request } = await import('supertest')

const ATTEMPT_UUID = '33333333-3333-4333-8333-333333333333'

// The global /api budget, written independently of src/index.js for the same
// reason userSerializer.test.js writes its forbidden-key list out by hand: a
// value read back from the implementation can never prove the implementation
// is wrong.
const GLOBAL_API_MAX = 100

// The credential-guessing budget for POST /api/user/login, written out by hand
// for the same reason: it must equal what POST /api/auth/login gets from the
// global limiter, and reading it back from the implementation would prove
// nothing.
const USER_LOGIN_MAX = 100

// All three limiters are module-level singletons shared by every test in this
// file, so each case starts from a full, predictable budget.
beforeEach(() => resetRateLimits(apiLimiter, userFlowLimiter, userLoginLimiter))

test('rate limiting — /api/user/* is not bound by the 100-request global /api budget', async () => {
  // The failure this guards against is not degraded service, it is terminal:
  // a 429 landing mid-attempt leaves the attempt in_progress with expires_at
  // still running, and UNIQUE (assignment_id, cycle) blocks a fresh start —
  // unrecoverable without an admin reactivation.
  for (let i = 0; i < GLOBAL_API_MAX + 20; i++) {
    const res = await request(app)
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .send({})
    assert.equal(res.status, 401, `request ${i + 1} should reach the auth layer`)
  }
})

test('rate limiting — the global /api limiter still guards the non-user namespaces', async () => {
  // Scoping /api/user out must not disarm the global limiter everywhere else:
  // the fix is sizing the budget for this flow, not removing abuse protection.
  for (let i = 0; i < GLOBAL_API_MAX; i++) {
    const res = await request(app).get('/api/assignments')
    assert.equal(res.status, 401, `request ${i + 1} should be within budget`)
  }

  const overBudget = await request(app).get('/api/assignments')
  assert.equal(overBudget.status, 429)
})

test('rate limiting — /api/user/* still has a limiter of its own, sized for a store of quiz takers', async () => {
  // Sizing rationale, derived here independently of src/index.js: one full
  // attempt costs roughly `question_count + 5` requests (start + one POST per
  // answer + submit + result, plus the GET /quizzes that brackets it), so a
  // 30-question quiz is ~35. A punto de venta NATs its whole staff behind one
  // public IP, so the IP-keyed budget must cover a store's worth of
  // simultaneous takers, not one person's.
  const REQUESTS_PER_ATTEMPT = 30 + 5
  const CONCURRENT_TAKERS_PER_STORE = 25

  assert.ok(
    USER_FLOW_MAX >= REQUESTS_PER_ATTEMPT * CONCURRENT_TAKERS_PER_STORE,
    `USER_FLOW_MAX (${USER_FLOW_MAX}) must cover ${CONCURRENT_TAKERS_PER_STORE} concurrent ${REQUESTS_PER_ATTEMPT}-request attempts`
  )

  // Still limited, though — an unbounded namespace would trade one real
  // problem for another on write-heavy endpoints.
  assert.ok(Number.isFinite(USER_FLOW_MAX))

  for (let i = 0; i < USER_FLOW_MAX; i++) {
    const res = await request(app)
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .send({})
    assert.equal(res.status, 401, `request ${i + 1} should be within budget`)
  }

  const overBudget = await request(app)
    .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
    .send({})
  assert.equal(overBudget.status, 429)
})

// POST /api/user/login lives under the same /api/user/ prefix as the
// quiz-taking flow but is nothing like it: it verifies a password with bcrypt,
// so it is both a credential-guessing oracle and a CPU-exhaustion lever. The
// wide USER_FLOW_MAX budget was sized purely from quiz-taking request volume
// (question_count + 5 per attempt) — nothing in that rationale accounts for
// login abuse, and letting login inherit it silently multiplied the
// guessing budget of the usuario namespace against its admin counterpart.
//
// An empty body is rejected by the handler's own input validation before any
// Supabase read or any bcrypt.compare, so this case measures the limiter and
// nothing else.
test('rate limiting — /api/user/login keeps a tight credential-guessing budget, not the wide quiz-taking one', async () => {
  // The heart of the matter: the login budget must be strictly tighter than
  // the quiz-taking one, not merely finite.
  assert.ok(
    USER_LOGIN_MAX < USER_FLOW_MAX,
    `login budget (${USER_LOGIN_MAX}) must be tighter than the quiz-taking budget (${USER_FLOW_MAX})`
  )

  for (let i = 0; i < USER_LOGIN_MAX; i++) {
    const res = await request(app).post('/api/user/login').send({})
    assert.equal(res.status, 400, `request ${i + 1} should be within budget`)
  }

  const overBudget = await request(app).post('/api/user/login').send({})
  assert.equal(overBudget.status, 429)
})

// The other half of the split: the dedicated login limiter must apply to the
// login route ONLY. Metering the whole /api/user namespace at the login budget
// would re-break the quiz-taking flow that USER_FLOW_MAX exists to protect.
test('rate limiting — the tight login budget does not bleed into the quiz-taking routes', async () => {
  for (let i = 0; i < USER_LOGIN_MAX + 20; i++) {
    const res = await request(app)
      .post(`/api/user/attempts/${ATTEMPT_UUID}/answers`)
      .send({})
    assert.equal(res.status, 401, `request ${i + 1} should reach the auth layer`)
  }
})
