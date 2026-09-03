import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.RESEND_API_KEY ??= 'test-resend-key'
process.env.RESEND_FROM_EMAIL ??= 'noreply@example.com'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { resetRateLimits } = await import('./helpers/resetRateLimit.js')
const { default: emailService } = await import('../src/lib/email.js')
const { forgotPasswordLimiter } = await import('../src/routes/auth.js')
const { app } = await import('../src/index.js')
const { default: request } = await import('supertest')

const ADMIN = { id: 'admin-1', email: 'a@example.com', is_active: true }
const GENERIC_MESSAGE = 'Si ese email está registrado, te enviamos un enlace para restablecer tu contraseña.'
const FORGOT_PASSWORD_MAX = 5
const DB_ERROR = { message: 'connection reset' }

// Every test starts with a full rate-limit budget, so no test's assertions
// depend on how many requests the tests before it made.
beforeEach(() => resetRateLimits(forgotPasswordLimiter))

function stubEmail(impl = async () => {}) {
  return mock.method(emailService, 'sendPasswordResetEmail', impl)
}

// The active-admin branch performs three supabase calls, in this order:
// look up the admin, reap that admin's stale tokens, insert the new token.
function activeAdminSequence({ cleanup = null, insert = null } = {}) {
  return mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN, error: null } },
    { table: 'password_reset_tokens', result: { data: null, error: cleanup } },
    { table: 'password_reset_tokens', result: { data: null, error: insert } }
  ])
}

test('POST /api/auth/forgot-password — known, active admin: generic 200 + token row inserted + email sent', async () => {
  const restore = activeAdminSequence()
  const sendSpy = stubEmail()
  try {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: ADMIN.email })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { message: GENERIC_MESSAGE })
    assert.equal(sendSpy.mock.callCount(), 1)
    const [arg] = sendSpy.mock.calls[0].arguments
    assert.equal(arg.to, ADMIN.email)
    assert.match(arg.resetUrl, /\/reset-password\?token=[a-f0-9]{64}$/)

    // The raw token must never be what lands in the database — only its
    // SHA-256 digest, so a leaked token_hash column can't be replayed.
    const insert = restore.calls.find((c) => c.method === 'insert')
    const [row] = insert.args
    const rawToken = arg.resetUrl.split('token=')[1]
    assert.equal(row.admin_id, ADMIN.id)
    assert.match(row.token_hash, /^[a-f0-9]{64}$/)
    assert.notEqual(row.token_hash, rawToken)
  } finally {
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/auth/forgot-password — unknown email: same generic 200, no email sent', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: null, error: { message: 'no rows' } } }
  ])
  const sendSpy = stubEmail()
  try {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { message: GENERIC_MESSAGE })
    assert.equal(sendSpy.mock.callCount(), 0)
  } finally {
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/auth/forgot-password — inactive admin: same generic 200, no email sent', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: { ...ADMIN, is_active: false }, error: null } }
  ])
  const sendSpy = stubEmail()
  try {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: ADMIN.email })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { message: GENERIC_MESSAGE })
    assert.equal(sendSpy.mock.callCount(), 0)
  } finally {
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/auth/forgot-password — token insert failure still returns the SAME generic 200 (never a 500 enumeration oracle)', async () => {
  const restore = activeAdminSequence({ insert: DB_ERROR })
  const sendSpy = stubEmail()
  const errorSpy = mock.method(console, 'error', () => {})
  try {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: ADMIN.email })

    // A 500 here would be a status-code side-channel: it only happens for
    // emails that DO belong to an active admin.
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { message: GENERIC_MESSAGE })
    assert.equal(errorSpy.mock.callCount(), 1)
    assert.match(errorSpy.mock.calls[0].arguments[0], /failed to store reset token/)
  } finally {
    errorSpy.mock.restore()
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/auth/forgot-password — stale-token cleanup failure still returns the SAME generic 200', async () => {
  const restore = activeAdminSequence({ cleanup: DB_ERROR })
  const sendSpy = stubEmail()
  const errorSpy = mock.method(console, 'error', () => {})
  try {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: ADMIN.email })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { message: GENERIC_MESSAGE })
    // Cleanup is opportunistic — it must not block issuing the new token.
    assert.equal(sendSpy.mock.callCount(), 1)
    assert.match(errorSpy.mock.calls[0].arguments[0], /failed to clean up stale reset tokens/)
  } finally {
    errorSpy.mock.restore()
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/auth/forgot-password — email send rejection still returns the SAME generic 200 without waiting on it', async () => {
  const restore = activeAdminSequence()
  // If the handler awaited this, express-async-errors would surface the
  // rejection as a 500 — which only ever happens for emails that DO belong
  // to an active admin, i.e. an enumeration oracle. A 200 proves it doesn't.
  const sendSpy = stubEmail(() => Promise.reject(new Error('resend is down')))
  const errorSpy = mock.method(console, 'error', () => {})
  try {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: ADMIN.email })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { message: GENERIC_MESSAGE })
    assert.equal(sendSpy.mock.callCount(), 1)
  } finally {
    errorSpy.mock.restore()
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/auth/forgot-password — malformed email returns 400', async () => {
  const res = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: 'not-an-email' })

  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'A valid email is required')
})

test('POST /api/auth/forgot-password — absent email field returns 400 without touching supabase', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({})

    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'A valid email is required')
  } finally {
    restore()
  }
})

test('POST /api/auth/forgot-password — rate limiter trips once this test alone exceeds the budget', async () => {
  // Self-contained: the beforeEach reset guarantees a full budget, and this
  // test makes every request it needs itself, so it neither depends on nor
  // is disturbed by the other tests in this file.
  const restore = mockSupabaseSequence(
    Array.from({ length: FORGOT_PASSWORD_MAX }, () => ({
      table: 'admins',
      result: { data: null, error: { message: 'no rows' } }
    }))
  )
  try {
    for (let i = 0; i < FORGOT_PASSWORD_MAX; i++) {
      const withinBudget = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: `probe-${i}@example.com` })
      assert.equal(withinBudget.status, 200, `request ${i + 1} should be within budget`)
    }
  } finally {
    restore()
  }

  // One over the budget — rejected by the limiter before it ever reaches the
  // handler, hence no queued supabase response is needed for it.
  const res = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: 'over-budget@example.com' })

  assert.equal(res.status, 429)
})
