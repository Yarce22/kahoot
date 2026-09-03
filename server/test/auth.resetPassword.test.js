import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { resetRateLimits } = await import('./helpers/resetRateLimit.js')
const { resetPasswordLimiter } = await import('../src/routes/auth.js')
const { app } = await import('../src/index.js')
const { default: request } = await import('supertest')

const FUTURE = new Date(Date.now() + 10 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 10 * 60 * 1000).toISOString()
const INVALID_MESSAGE = 'Invalid or expired reset link'
const PASSWORD = 'new-password-123'
const BCRYPT_HASH_RE = /^\$2[aby]?\$\d{2}\$/
const RESET_PASSWORD_MAX = 10
const DB_ERROR = { message: 'connection reset' }

const VALID_TOKEN_ROW = { id: 'tok-1', admin_id: 'admin-1', expires_at: FUTURE, used_at: null }
const ACTIVE_ADMIN = { id: 'admin-1', is_active: true }

// Each test starts with a full rate-limit budget — the limiter is a
// module-level singleton, so without this the assertions would silently
// depend on how many requests the preceding tests made.
beforeEach(() => resetRateLimits(resetPasswordLimiter))

// The happy path performs five supabase calls, in this order: find the token,
// re-check the owning admin is still active, write the new hash, consume the
// used token, invalidate that admin's other outstanding tokens.
function happyPathSequence({ update = null, consume = null, siblings = null } = {}) {
  return mockSupabaseSequence([
    { table: 'password_reset_tokens', result: { data: VALID_TOKEN_ROW, error: null } },
    { table: 'admins', result: { data: ACTIVE_ADMIN, error: null } },
    { table: 'admins', result: { data: null, error: update } },
    { table: 'password_reset_tokens', result: { data: null, error: consume } },
    { table: 'password_reset_tokens', result: { data: null, error: siblings } }
  ])
}

test('POST /api/auth/reset-password — valid token stores a bcrypt hash for the right admin and consumes the token', async () => {
  const restore = happyPathSequence()
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a-valid-raw-token', password: PASSWORD })

    assert.equal(res.status, 200)
    assert.equal(res.body.message, 'Contraseña actualizada correctamente')

    // What actually got persisted matters far more than the status code: a
    // 200 would look identical if the plaintext password were written.
    const adminUpdate = restore.calls.find((c) => c.table === 'admins' && c.method === 'update')
    const [payload] = adminUpdate.args
    assert.match(payload.password_hash, BCRYPT_HASH_RE)
    assert.notEqual(payload.password_hash, PASSWORD)

    const adminFilters = restore.calls.filter((c) => c.table === 'admins' && c.method === 'eq')
    assert.ok(
      adminFilters.some(({ args }) => args[0] === 'id' && args[1] === VALID_TOKEN_ROW.admin_id),
      'the password update must be scoped to the token owner'
    )

    // The used token is consumed, and so is every other still-unused token
    // belonging to the same admin.
    const tokenUpdates = restore.calls.filter((c) => c.table === 'password_reset_tokens' && c.method === 'update')
    assert.equal(tokenUpdates.length, 2)
    for (const { args } of tokenUpdates) assert.ok(args[0].used_at)

    const tokenFilters = restore.calls.filter((c) => c.table === 'password_reset_tokens' && c.method === 'eq')
    assert.ok(tokenFilters.some(({ args }) => args[0] === 'id' && args[1] === VALID_TOKEN_ROW.id))
    assert.ok(tokenFilters.some(({ args }) => args[0] === 'admin_id' && args[1] === VALID_TOKEN_ROW.admin_id))
  } finally {
    restore()
  }
})

test('POST /api/auth/reset-password — unknown token returns generic 400', async () => {
  const restore = mockSupabaseSequence([
    { table: 'password_reset_tokens', result: { data: null, error: { message: 'no rows' } } }
  ])
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'not-a-real-token', password: PASSWORD })

    assert.equal(res.status, 400)
    assert.equal(res.body.error, INVALID_MESSAGE)
  } finally {
    restore()
  }
})

test('POST /api/auth/reset-password — expired token returns the SAME generic 400 (no state leak)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'password_reset_tokens', result: { data: { ...VALID_TOKEN_ROW, id: 'tok-2', expires_at: PAST }, error: null } }
  ])
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'an-expired-token', password: PASSWORD })

    assert.equal(res.status, 400)
    assert.equal(res.body.error, INVALID_MESSAGE)
  } finally {
    restore()
  }
})

test('POST /api/auth/reset-password — already-used token returns the SAME generic 400 (no replay)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'password_reset_tokens', result: { data: { ...VALID_TOKEN_ROW, id: 'tok-3', used_at: new Date().toISOString() }, error: null } }
  ])
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'an-already-used-token', password: PASSWORD })

    assert.equal(res.status, 400)
    assert.equal(res.body.error, INVALID_MESSAGE)
  } finally {
    restore()
  }
})

test('POST /api/auth/reset-password — deactivated admin gets the SAME generic 400 and no password write', async () => {
  // The token was issued while the account was still active; deactivation
  // afterwards must revoke it, otherwise a disabled admin can rotate their
  // own password back into a working state.
  const restore = mockSupabaseSequence([
    { table: 'password_reset_tokens', result: { data: VALID_TOKEN_ROW, error: null } },
    { table: 'admins', result: { data: { id: 'admin-1', is_active: false }, error: null } }
  ])
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a-valid-raw-token', password: PASSWORD })

    // Deliberately NOT a distinct "account deactivated" message — that would
    // turn a reset link into an account-state probe.
    assert.equal(res.status, 400)
    assert.equal(res.body.error, INVALID_MESSAGE)
    assert.equal(restore.calls.filter((c) => c.method === 'update').length, 0)
  } finally {
    restore()
  }
})

test('POST /api/auth/reset-password — missing admin row gets the SAME generic 400 and no password write', async () => {
  const restore = mockSupabaseSequence([
    { table: 'password_reset_tokens', result: { data: VALID_TOKEN_ROW, error: null } },
    { table: 'admins', result: { data: null, error: { message: 'no rows' } } }
  ])
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a-valid-raw-token', password: PASSWORD })

    assert.equal(res.status, 400)
    assert.equal(res.body.error, INVALID_MESSAGE)
    assert.equal(restore.calls.filter((c) => c.method === 'update').length, 0)
  } finally {
    restore()
  }
})

test('POST /api/auth/reset-password — token lookup failure returns the generic 400, never a raw 500', async () => {
  const restore = mockSupabaseSequence([
    { table: 'password_reset_tokens', result: { data: null, error: DB_ERROR } }
  ])
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a-valid-raw-token', password: PASSWORD })

    assert.equal(res.status, 400)
    assert.equal(res.body.error, INVALID_MESSAGE)
  } finally {
    restore()
  }
})

test('POST /api/auth/reset-password — password write failure surfaces an error instead of claiming success', async () => {
  const restore = happyPathSequence({ update: DB_ERROR })
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a-valid-raw-token', password: PASSWORD })

    // The password did NOT change, so a success message here would be a lie.
    assert.notEqual(res.status, 200)
    assert.notEqual(res.body.message, 'Contraseña actualizada correctamente')
  } finally {
    restore()
  }
})

test('POST /api/auth/reset-password — failing to consume the token still succeeds but logs loudly', async () => {
  const restore = happyPathSequence({ consume: DB_ERROR })
  const errorSpy = mock.method(console, 'error', () => {})
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a-valid-raw-token', password: PASSWORD })

    // The password DID change — turning this into a user-facing error would
    // be misleading. But the token stays replayable until its TTL expires,
    // so the failure must be observable server-side.
    assert.equal(res.status, 200)
    assert.equal(res.body.message, 'Contraseña actualizada correctamente')

    const messages = errorSpy.mock.calls.map((c) => c.arguments[0])
    assert.ok(messages.some((m) => /failed to mark token as used/.test(m)))
  } finally {
    errorSpy.mock.restore()
    restore()
  }
})

test('POST /api/auth/reset-password — failing to invalidate sibling tokens still succeeds but logs loudly', async () => {
  const restore = happyPathSequence({ siblings: DB_ERROR })
  const errorSpy = mock.method(console, 'error', () => {})
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a-valid-raw-token', password: PASSWORD })

    assert.equal(res.status, 200)
    assert.equal(res.body.message, 'Contraseña actualizada correctamente')

    const messages = errorSpy.mock.calls.map((c) => c.arguments[0])
    assert.ok(messages.some((m) => /failed to invalidate sibling reset tokens/.test(m)))
  } finally {
    errorSpy.mock.restore()
    restore()
  }
})

test('POST /api/auth/reset-password — missing password returns 400 without touching supabase', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'some-token' })

    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'password is required')
  } finally {
    restore()
  }
})

test('POST /api/auth/reset-password — too-short password returns 400 without touching supabase', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'some-token', password: 'short' })

    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'Password must be at least 8 characters')
  } finally {
    restore()
  }
})

test('POST /api/auth/reset-password — missing token returns 400 without touching supabase', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ password: PASSWORD })

    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'token is required')
  } finally {
    restore()
  }
})

test('POST /api/auth/reset-password — rate limiter trips once this test alone exceeds the budget', async () => {
  // Self-contained: the beforeEach reset guarantees a full budget and this
  // test makes every request it needs itself. Rejected requests never reach
  // the handler, so only the in-budget ones need a queued response.
  const restore = mockSupabaseSequence(
    Array.from({ length: RESET_PASSWORD_MAX }, () => ({
      table: 'password_reset_tokens',
      result: { data: null, error: { message: 'no rows' } }
    }))
  )
  try {
    for (let i = 0; i < RESET_PASSWORD_MAX; i++) {
      const withinBudget = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: `probe-${i}`, password: PASSWORD })
      assert.equal(withinBudget.status, 400, `request ${i + 1} should reach the handler`)
    }
  } finally {
    restore()
  }

  const res = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: 'over-budget', password: PASSWORD })

  assert.equal(res.status, 429)
})
