import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.AUTH_LEGACY_TOKEN_ENABLED = 'true'
process.env.ADMIN_TOKEN = 'test-admin-token'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { app } = await import('../src/index.js')
const { default: request } = await import('supertest')

test('POST /api/auth/register — duplicate email (Postgres 23505) returns 409, not 500', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: null, error: { message: 'no rows' } } },                    // pre-check (no existing row)
    { table: 'admins', result: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "admins_email_key"' } } } // insert
  ])
  try {
    const res = await request(app)
      .post('/api/auth/register')
      .set('x-admin-token', 'test-admin-token')
      .send({ email: 'dup@example.com', password: 'some-password', punto_de_venta: 'Cerritos' })

    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'An admin with this email already exists')
  } finally {
    restore()
  }
})

test('POST /api/auth/register — duplicate email surfaced without a code, only message text, still returns 409', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: null, error: { message: 'no rows' } } },
    { table: 'admins', result: { data: null, error: { message: 'duplicate key value violates unique constraint' } } }
  ])
  try {
    const res = await request(app)
      .post('/api/auth/register')
      .set('x-admin-token', 'test-admin-token')
      .send({ email: 'dup2@example.com', password: 'some-password', punto_de_venta: 'Cerritos' })

    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'An admin with this email already exists')
  } finally {
    restore()
  }
})

// The bootstrap path inserts into admins directly, so it is bound by the same
// NOT NULL punto_de_venta column as POST /api/admins.
test('POST /api/auth/register — punto_de_venta is required (400), and nothing is inserted', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const res = await request(app)
      .post('/api/auth/register')
      .set('x-admin-token', 'test-admin-token')
      .send({ email: 'first@example.com', password: 'some-password' })

    assert.equal(res.status, 400)
    assert.equal(restore.calls.filter((c) => c.method === 'insert').length, 0)
  } finally {
    restore()
  }
})

test('POST /api/auth/register — a punto_de_venta outside the allowlist is rejected (400)', async () => {
  const restore = mockSupabaseSequence([])
  try {
    const res = await request(app)
      .post('/api/auth/register')
      .set('x-admin-token', 'test-admin-token')
      .send({ email: 'first@example.com', password: 'some-password', punto_de_venta: 'Narnia' })

    assert.equal(res.status, 400)
    assert.equal(restore.calls.filter((c) => c.method === 'insert').length, 0)
  } finally {
    restore()
  }
})

test('POST /api/auth/register — persists punto_de_venta on the bootstrap admin', async () => {
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: null, error: { message: 'no rows' } } },                                  // pre-check
    { table: 'admins', result: { data: { id: 'boot-1', email: 'first@example.com' }, error: null } }             // insert
  ])
  try {
    const res = await request(app)
      .post('/api/auth/register')
      .set('x-admin-token', 'test-admin-token')
      .send({ email: 'first@example.com', password: 'some-password', punto_de_venta: 'Laureles' })

    assert.equal(res.status, 201)
    const insert = restore.calls.find((c) => c.method === 'insert')
    assert.equal(insert.args[0].punto_de_venta, 'Laureles')
  } finally {
    restore()
  }
})
