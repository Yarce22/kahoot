import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { app } = await import('../src/index.js')
const { default: request } = await import('supertest')

const PASSWORD = 'correct-password'
const ADMIN = { id: 'admin-1', email: 'a@example.com', password_hash: bcrypt.hashSync(PASSWORD, 12), role: 'admin', is_active: true }

test('POST /api/auth/login — returns a JWT on correct credentials', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN, error: null } }
  ])
  try {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: PASSWORD })

    assert.equal(res.status, 200)
    assert.equal(typeof res.body.token, 'string')
    assert.deepEqual(res.body.admin, { id: ADMIN.id, email: ADMIN.email, role: ADMIN.role })
  } finally {
    restore()
  }
})

test('POST /api/auth/login — wrong password returns 401', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN, error: null } }
  ])
  try {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: 'wrong-password' })

    assert.equal(res.status, 401)
    assert.deepEqual(res.body, { error: 'Invalid email or password' })
  } finally {
    restore()
  }
})

test('POST /api/auth/login — unknown email returns the SAME body as wrong password (no enumeration)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: null, error: { message: 'no rows' } } }
  ])
  try {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' })

    assert.equal(res.status, 401)
    assert.deepEqual(res.body, { error: 'Invalid email or password' })
  } finally {
    restore()
  }
})

test('POST /api/auth/login — unknown email still invokes bcrypt.compare (timing side-channel guard)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: null, error: { message: 'no rows' } } }
  ])
  const compareSpy = mock.method(bcrypt, 'compare')
  try {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' })

    assert.equal(res.status, 401)
    // A regression that short-circuits on unknown email (skipping
    // bcrypt.compare entirely) would leak account existence via timing —
    // assert the dummy-hash comparison actually ran.
    assert.equal(compareSpy.mock.callCount(), 1)
    const [, hashArg] = compareSpy.mock.calls[0].arguments
    assert.equal(hashArg, '$2b$12$fLW7OVDfaQDuxoDkJ7EWWOiDMJL77XGv/x.iF1N4el6P300rNwPsq')
  } finally {
    compareSpy.mock.restore()
    restore()
  }
})
