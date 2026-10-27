import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { resetRateLimits } = await import('./helpers/resetRateLimit.js')
const { userResetPasswordLimiter } = await import('../src/routes/userAuth.js')
const { app } = await import('../src/index.js')
const { default: request } = await import('supertest')

const URL_PATH = '/api/user/auth/reset-password'
const FUTURE = new Date(Date.now() + 10 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 10 * 60 * 1000).toISOString()
const INVALID_MESSAGE = 'Invalid or expired reset link'
const SUCCESS_MESSAGE = 'Contraseña actualizada correctamente'
const PASSWORD = 'new-password-123'
const BCRYPT_HASH_RE = /^\$2[aby]?\$\d{2}\$/
const RESET_PASSWORD_MAX = 10
const DB_ERROR = { message: 'connection reset' }

const VALID_TOKEN_ROW = { id: 'tok-1', user_id: 'user-1', expires_at: FUTURE, used_at: null }
const ACTIVE_USER = { id: 'user-1', is_active: true }

beforeEach(() => {
  process.env.AUTH_MODE = 'jwt'
  resetRateLimits(userResetPasswordLimiter)
})

// Happy path: find token, re-check usuario is active, write hash, consume the
// token, invalidate the usuario's other outstanding tokens.
function happyPathSequence({ update = null, consume = null, siblings = null } = {}) {
  return mockSupabaseSequence([
    { table: 'user_password_reset_tokens', result: { data: VALID_TOKEN_ROW, error: null } },
    { table: 'users', result: { data: ACTIVE_USER, error: null } },
    { table: 'users', result: { data: null, error: update } },
    { table: 'user_password_reset_tokens', result: { data: null, error: consume } },
    { table: 'user_password_reset_tokens', result: { data: null, error: siblings } }
  ])
}

const post = (body) => request(app).post(URL_PATH).send(body)

test('POST /api/user/auth/reset-password — valid token stores a bcrypt hash for the right usuario and consumes the token', async () => {
  const restore = happyPathSequence()
  try {
    const res = await post({ token: 'a-valid-raw-token', password: PASSWORD })

    assert.equal(res.status, 200)
    assert.equal(res.body.message, SUCCESS_MESSAGE)

    const userUpdate = restore.calls.find((c) => c.table === 'users' && c.method === 'update')
    const [payload] = userUpdate.args
    assert.match(payload.password_hash, BCRYPT_HASH_RE)
    assert.notEqual(payload.password_hash, PASSWORD)

    const userFilters = restore.calls.filter((c) => c.table === 'users' && c.method === 'eq')
    assert.ok(userFilters.some(({ args }) => args[0] === 'id' && args[1] === 'user-1'))

    const tokenUpdates = restore.calls.filter((c) => c.table === 'user_password_reset_tokens' && c.method === 'update')
    assert.equal(tokenUpdates.length, 2)
    for (const { args } of tokenUpdates) assert.ok(args[0].used_at)

    const tokenFilters = restore.calls.filter((c) => c.table === 'user_password_reset_tokens' && c.method === 'eq')
    assert.ok(tokenFilters.some(({ args }) => args[0] === 'id' && args[1] === 'tok-1'))
    assert.ok(tokenFilters.some(({ args }) => args[0] === 'user_id' && args[1] === 'user-1'))
  } finally {
    restore()
  }
})

test('POST /api/user/auth/reset-password — unknown, expired, used and lookup-failed tokens all return the SAME generic 400', async () => {
  const cases = [
    { data: null, error: { message: 'no rows' } },
    { data: { ...VALID_TOKEN_ROW, expires_at: PAST }, error: null },
    { data: { ...VALID_TOKEN_ROW, used_at: new Date().toISOString() }, error: null },
    { data: null, error: DB_ERROR }
  ]
  for (const result of cases) {
    const restore = mockSupabaseSequence([{ table: 'user_password_reset_tokens', result }])
    try {
      const res = await post({ token: 'whatever', password: PASSWORD })
      assert.equal(res.status, 400)
      assert.equal(res.body.error, INVALID_MESSAGE)
    } finally {
      restore()
    }
  }
})

test('POST /api/user/auth/reset-password — deactivated or missing usuario gets the SAME generic 400 and no password write', async () => {
  const cases = [
    { data: { id: 'user-1', is_active: false }, error: null },
    { data: null, error: { message: 'no rows' } }
  ]
  for (const result of cases) {
    const restore = mockSupabaseSequence([
      { table: 'user_password_reset_tokens', result: { data: VALID_TOKEN_ROW, error: null } },
      { table: 'users', result }
    ])
    try {
      const res = await post({ token: 'a-valid-raw-token', password: PASSWORD })
      assert.equal(res.status, 400)
      assert.equal(res.body.error, INVALID_MESSAGE)
      assert.equal(restore.calls.filter((c) => c.method === 'update').length, 0)
    } finally {
      restore()
    }
  }
})

test('POST /api/user/auth/reset-password — password write failure surfaces an error instead of claiming success', async () => {
  const restore = happyPathSequence({ update: DB_ERROR })
  try {
    const res = await post({ token: 'a-valid-raw-token', password: PASSWORD })
    assert.notEqual(res.status, 200)
    assert.notEqual(res.body.message, SUCCESS_MESSAGE)
  } finally {
    restore()
  }
})

test('POST /api/user/auth/reset-password — token bookkeeping failures still succeed but log loudly', async () => {
  const cases = [
    { opts: { consume: DB_ERROR }, log: /failed to mark token as used/ },
    { opts: { siblings: DB_ERROR }, log: /failed to invalidate sibling reset tokens/ }
  ]
  for (const { opts, log } of cases) {
    const restore = happyPathSequence(opts)
    const errorSpy = mock.method(console, 'error', () => {})
    try {
      const res = await post({ token: 'a-valid-raw-token', password: PASSWORD })
      assert.equal(res.status, 200)
      assert.equal(res.body.message, SUCCESS_MESSAGE)
      assert.ok(errorSpy.mock.calls.some((c) => log.test(c.arguments[0])))
    } finally {
      errorSpy.mock.restore()
      restore()
    }
  }
})

test('POST /api/user/auth/reset-password — input validation returns 400 without touching supabase', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const noToken = await post({ password: PASSWORD })
    assert.equal(noToken.status, 400)
    assert.equal(noToken.body.error, 'token is required')

    const noPassword = await post({ token: 'some-token' })
    assert.equal(noPassword.status, 400)
    assert.equal(noPassword.body.error, 'password is required')

    const short = await post({ token: 'some-token', password: 'short' })
    assert.equal(short.status, 400)
    assert.equal(short.body.error, 'Password must be at least 8 characters')
  } finally {
    restore()
  }
})

test('POST /api/user/auth/reset-password — 501 when AUTH_MODE is not jwt', async () => {
  process.env.AUTH_MODE = 'legacy'
  const res = await post({ token: 'a-valid-raw-token', password: PASSWORD })
  assert.equal(res.status, 501)
})

test('POST /api/user/auth/reset-password — rate limiter trips once the budget of 10 is exceeded', async () => {
  const restore = mockSupabaseSequence(
    Array.from({ length: RESET_PASSWORD_MAX }, () => ({
      table: 'user_password_reset_tokens',
      result: { data: null, error: { message: 'no rows' } }
    }))
  )
  try {
    for (let i = 0; i < RESET_PASSWORD_MAX; i++) {
      const res = await post({ token: `probe-${i}`, password: PASSWORD })
      assert.equal(res.status, 400, `request ${i + 1} should reach the handler`)
    }
  } finally {
    restore()
  }

  const res = await post({ token: 'over-budget', password: PASSWORD })
  assert.equal(res.status, 429)
})

for (const [label, body] of [
  ['non-string token', { token: { a: 1 }, password: PASSWORD }],
  ['numeric token', { token: 12345, password: PASSWORD }],
  ['non-string password', { token: 'a-valid-raw-token', password: 123456789 }],
  ['object password with a large length', { token: 'a-valid-raw-token', password: { length: 100 } }]
]) {
  test(`POST /api/user/auth/reset-password — ${label} is a 400, never reaches the database`, async () => {
    const restore = mockSupabaseSequence([])
    try {
      const res = await post(body)
      assert.equal(res.status, 400)
      assert.equal(restore.calls.length, 0)
    } finally {
      restore()
    }
  })
}
