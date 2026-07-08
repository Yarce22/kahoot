import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
process.env.AUTH_MODE = 'jwt'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { app } = await import('../src/index.js')
const { signToken } = await import('../src/lib/jwt.js')
const { requireSuperadmin } = await import('../src/middleware/requireSuperadmin.js')
const { default: request } = await import('supertest')

// --- requireSuperadmin (pure middleware) ---

test('requireSuperadmin — allows a superadmin', () => {
  const req = { admin: { id: 'a1', email: 'a@x.com', role: 'superadmin' } }
  let nextArg = 'unset'
  requireSuperadmin(req, {}, (err) => { nextArg = err })
  assert.equal(nextArg, undefined)
})

test('requireSuperadmin — blocks a plain admin with 403', () => {
  const req = { admin: { id: 'a1', email: 'a@x.com', role: 'admin' } }
  let err
  requireSuperadmin(req, {}, (e) => { err = e })
  assert.equal(err?.status, 403)
})

test('requireSuperadmin — blocks a request with no admin (401)', () => {
  const req = {}
  let err
  requireSuperadmin(req, {}, (e) => { err = e })
  assert.equal(err?.status, 401)
})

// --- login carries role and rejects inactive admins ---

const ACTIVE = {
  id: 'a1', email: 'a@x.com',
  // bcrypt hash of 'secret' (cost 12) — so password comparison passes and the
  // is_active check is what actually drives the rejection below.
  password_hash: '$2b$12$QODp6tcgJUsPS5D3dyfbYuTdXBj9jnJOa3Em358MNmKqy2JS5VJxC',
  role: 'superadmin', is_active: true
}

test('POST /api/auth/login — inactive admin is rejected (401)', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: { ...ACTIVE, is_active: false }, error: null } }
  ])
  try {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@x.com', password: 'secret' })
    assert.equal(res.status, 401)
  } finally {
    restore()
  }
})

// --- requireAuth rejects inactive admins on protected routes ---

test('GET /api/quizzes — a valid token for a deactivated admin is rejected (401)', async () => {
  const token = signToken({ sub: 'a1', email: 'a@x.com' })
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: { id: 'a1', email: 'a@x.com', role: 'admin', is_active: false }, error: null } }
  ])
  try {
    const res = await request(app)
      .get('/api/quizzes')
      .set('Authorization', `Bearer ${token}`)
    assert.equal(res.status, 401)
  } finally {
    restore()
  }
})
