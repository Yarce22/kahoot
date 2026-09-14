import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import express from 'express'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { userAuthRouter } = await import('../src/routes/userAuth.js')
const { errorHandler } = await import('../src/middleware/errorHandler.js')
const { default: request } = await import('supertest')

// Standalone app — userAuthRouter is not mounted in src/index.js until PR3
// (Phase 8 wiring is explicitly out of scope for this batch).
function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/user', userAuthRouter)
  app.use(errorHandler)
  return app
}

const PASSWORD = 'correct-password'
const USER = {
  id: 'user-1',
  email: 'u@example.com',
  password_hash: bcrypt.hashSync(PASSWORD, 12),
  full_name: 'Ana Usuaria',
  punto_de_venta: 'Cerritos',
  is_active: true
}

test('POST /api/user/login — 501 when AUTH_MODE is not jwt', async () => {
  const previous = process.env.AUTH_MODE
  process.env.AUTH_MODE = 'legacy'
  try {
    const res = await request(buildApp())
      .post('/api/user/login')
      .send({ email: USER.email, password: PASSWORD })
    assert.equal(res.status, 501)
  } finally {
    process.env.AUTH_MODE = previous
  }
})

test('POST /api/user/login — missing email returns 400', async () => {
  process.env.AUTH_MODE = 'jwt'
  const res = await request(buildApp()).post('/api/user/login').send({ password: PASSWORD })
  assert.equal(res.status, 400)
})

test('POST /api/user/login — missing password returns 400', async () => {
  process.env.AUTH_MODE = 'jwt'
  const res = await request(buildApp()).post('/api/user/login').send({ email: USER.email })
  assert.equal(res.status, 400)
})

test('POST /api/user/login — valid credentials return a usuario-audience token', async () => {
  process.env.AUTH_MODE = 'jwt'
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/user/login')
      .send({ email: USER.email, password: PASSWORD })

    assert.equal(res.status, 200)
    assert.equal(typeof res.body.token, 'string')
    const decoded = jwt.decode(res.body.token)
    assert.equal(decoded.aud, 'usuario')
    assert.equal(decoded.sub, USER.id)
    assert.deepEqual(res.body.user, {
      id: USER.id,
      email: USER.email,
      fullName: USER.full_name,
      puntoDeVenta: USER.punto_de_venta
    })
  } finally {
    restore()
  }
})

test('POST /api/user/login — wrong password returns 401', async () => {
  process.env.AUTH_MODE = 'jwt'
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: USER, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/user/login')
      .send({ email: USER.email, password: 'wrong-password' })
    assert.equal(res.status, 401)
    assert.deepEqual(res.body, { error: 'Invalid email or password' })
  } finally {
    restore()
  }
})

test('POST /api/user/login — unknown email returns the SAME body as wrong password (no enumeration)', async () => {
  process.env.AUTH_MODE = 'jwt'
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: null, error: { message: 'no rows' } } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/user/login')
      .send({ email: 'nobody@example.com', password: 'whatever' })
    assert.equal(res.status, 401)
    assert.deepEqual(res.body, { error: 'Invalid email or password' })
  } finally {
    restore()
  }
})

test('POST /api/user/login — unknown email still invokes bcrypt.compare (timing side-channel guard)', async () => {
  process.env.AUTH_MODE = 'jwt'
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: null, error: { message: 'no rows' } } }
  ])
  const compareSpy = mock.method(bcrypt, 'compare')
  try {
    const res = await request(buildApp())
      .post('/api/user/login')
      .send({ email: 'nobody@example.com', password: 'whatever' })
    assert.equal(res.status, 401)
    assert.equal(compareSpy.mock.callCount(), 1)
  } finally {
    compareSpy.mock.restore()
    restore()
  }
})

test('POST /api/user/login — a deactivated usuario is rejected with the same generic 401', async () => {
  process.env.AUTH_MODE = 'jwt'
  const restore = mockSupabaseSequence([
    { table: 'users', result: { data: { ...USER, is_active: false }, error: null } }
  ])
  try {
    const res = await request(buildApp())
      .post('/api/user/login')
      .send({ email: USER.email, password: PASSWORD })
    assert.equal(res.status, 401)
    assert.deepEqual(res.body, { error: 'Invalid email or password' })
  } finally {
    restore()
  }
})
