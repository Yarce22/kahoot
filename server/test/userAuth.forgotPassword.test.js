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
const { userForgotPasswordLimiter } = await import('../src/routes/userAuth.js')
const { app } = await import('../src/index.js')
const { default: request } = await import('supertest')

const URL_PATH = '/api/user/auth/forgot-password'
const USER = { id: 'user-1', email: 'u@example.com', is_active: true }
const GENERIC_MESSAGE = 'Si ese email está registrado, te enviamos un enlace para restablecer tu contraseña.'
const FORGOT_PASSWORD_MAX = 5
const DB_ERROR = { message: 'connection reset' }

beforeEach(() => {
  process.env.AUTH_MODE = 'jwt'
  resetRateLimits(userForgotPasswordLimiter)
})

function stubEmail(impl = async () => {}) {
  return mock.method(emailService, 'sendPasswordResetEmail', impl)
}

// Active-usuario branch: look up the user, reap stale tokens, insert the new one.
function activeUserSequence({ cleanup = null, insert = null } = {}) {
  return mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } },
    { table: 'user_password_reset_tokens', result: { data: null, error: cleanup } },
    { table: 'user_password_reset_tokens', result: { data: null, error: insert } }
  ])
}

test('POST /api/user/auth/forgot-password — known, active usuario: generic 200 + token row inserted + usuario reset link emailed', async () => {
  const restore = activeUserSequence()
  const sendSpy = stubEmail()
  try {
    const res = await request(app).post(URL_PATH).send({ email: USER.email })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { message: GENERIC_MESSAGE })
    assert.equal(sendSpy.mock.callCount(), 1)
    const [arg] = sendSpy.mock.calls[0].arguments
    assert.equal(arg.to, USER.email)
    assert.match(arg.resetUrl, /\/user\/reset-password\?token=[a-f0-9]{64}$/)

    const insert = restore.calls.find((c) => c.method === 'insert')
    const [row] = insert.args
    const rawToken = arg.resetUrl.split('token=')[1]
    assert.equal(row.user_id, USER.id)
    assert.match(row.token_hash, /^[a-f0-9]{64}$/)
    assert.notEqual(row.token_hash, rawToken)
  } finally {
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/user/auth/forgot-password — email is normalized (trim + lowercase) before the lookup', async () => {
  const restore = activeUserSequence()
  const sendSpy = stubEmail()
  try {
    await request(app).post(URL_PATH).send({ email: '  U@Example.com ' })

    const lookup = restore.calls.find((c) => c.table === 'users' && c.method === 'eq')
    assert.deepEqual(lookup.args, ['email', 'u@example.com'])
  } finally {
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/user/auth/forgot-password — unknown email: same generic 200, no email sent', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: null, error: { message: 'no rows' } } }
  ])
  const sendSpy = stubEmail()
  try {
    const res = await request(app).post(URL_PATH).send({ email: 'nobody@example.com' })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { message: GENERIC_MESSAGE })
    assert.equal(sendSpy.mock.callCount(), 0)
  } finally {
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/user/auth/forgot-password — inactive usuario: same generic 200, no email sent', async () => {
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: { ...USER, is_active: false }, error: null } }
  ])
  const sendSpy = stubEmail()
  try {
    const res = await request(app).post(URL_PATH).send({ email: USER.email })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { message: GENERIC_MESSAGE })
    assert.equal(sendSpy.mock.callCount(), 0)
  } finally {
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/user/auth/forgot-password — token insert failure: same generic 200 and no email sent', async () => {
  const restore = activeUserSequence({ insert: DB_ERROR })
  const sendSpy = stubEmail()
  const errorSpy = mock.method(console, 'error', () => {})
  try {
    const res = await request(app).post(URL_PATH).send({ email: USER.email })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { message: GENERIC_MESSAGE })
    assert.equal(sendSpy.mock.callCount(), 0)
    assert.match(errorSpy.mock.calls[0].arguments[0], /failed to store reset token/)
  } finally {
    errorSpy.mock.restore()
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/user/auth/forgot-password — stale-token cleanup failure still issues the token with the same generic 200', async () => {
  const restore = activeUserSequence({ cleanup: DB_ERROR })
  const sendSpy = stubEmail()
  const errorSpy = mock.method(console, 'error', () => {})
  try {
    const res = await request(app).post(URL_PATH).send({ email: USER.email })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { message: GENERIC_MESSAGE })
    assert.equal(sendSpy.mock.callCount(), 1)
    assert.match(errorSpy.mock.calls[0].arguments[0], /failed to clean up stale reset tokens/)
  } finally {
    errorSpy.mock.restore()
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/user/auth/forgot-password — email send rejection still returns the SAME generic 200', async () => {
  const restore = activeUserSequence()
  const sendSpy = stubEmail(() => Promise.reject(new Error('resend is down')))
  const errorSpy = mock.method(console, 'error', () => {})
  try {
    const res = await request(app).post(URL_PATH).send({ email: USER.email })

    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { message: GENERIC_MESSAGE })
    assert.equal(sendSpy.mock.callCount(), 1)
  } finally {
    errorSpy.mock.restore()
    sendSpy.mock.restore()
    restore()
  }
})

test('POST /api/user/auth/forgot-password — malformed or absent email returns 400 without touching supabase', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const malformed = await request(app).post(URL_PATH).send({ email: 'not-an-email' })
    assert.equal(malformed.status, 400)
    assert.equal(malformed.body.error, 'A valid email is required')

    const absent = await request(app).post(URL_PATH).send({})
    assert.equal(absent.status, 400)
  } finally {
    restore()
  }
})

test('POST /api/user/auth/forgot-password — 501 when AUTH_MODE is not jwt', async () => {
  process.env.AUTH_MODE = 'legacy'
  const res = await request(app).post(URL_PATH).send({ email: USER.email })
  assert.equal(res.status, 501)
})

test('POST /api/user/auth/forgot-password — rate limiter trips once the budget of 5 is exceeded', async () => {
  const restore = mockSupabaseSequence(
    Array.from({ length: FORGOT_PASSWORD_MAX }, () => ({
      table: 'users',
      result: { data: null, error: { message: 'no rows' } }
    }))
  )
  try {
    for (let i = 0; i < FORGOT_PASSWORD_MAX; i++) {
      const res = await request(app).post(URL_PATH).send({ email: `probe-${i}@example.com` })
      assert.equal(res.status, 200, `request ${i + 1} should be within budget`)
    }
  } finally {
    restore()
  }

  const res = await request(app).post(URL_PATH).send({ email: 'over-budget@example.com' })
  assert.equal(res.status, 429)
})
