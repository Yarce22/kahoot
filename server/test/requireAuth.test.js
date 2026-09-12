import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
// requireAuth/requireQuizOwner only enforce under AUTH_MODE=jwt (see
// server/src/middleware/jwtGate.js) — the PR3 flip to jwt-by-default
// hasn't happened yet, so tests set it explicitly, in-process.
process.env.AUTH_MODE = 'jwt'

const { app } = await import('../src/index.js')
const { default: request } = await import('supertest')
const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { requireAuth } = await import('../src/middleware/requireAuth.js')
const { signToken } = await import('../src/lib/jwt.js')

function makeReq(token) {
  return token ? { headers: { authorization: `Bearer ${token}` } } : { headers: {} }
}

test('POST /api/quizzes — no Authorization header returns 401 under AUTH_MODE=jwt', async () => {
  const res = await request(app)
    .post('/api/quizzes')
    .send({ title: 'Unauthorized quiz attempt' })

  assert.equal(res.status, 401)
  assert.equal(res.body.error, 'Missing bearer token')
})

test('POST /api/quizzes — malformed Authorization header returns 401', async () => {
  const res = await request(app)
    .post('/api/quizzes')
    .set('Authorization', 'not-a-bearer-token')
    .send({ title: 'Unauthorized quiz attempt' })

  assert.equal(res.status, 401)
  assert.equal(res.body.error, 'Missing bearer token')
})

test('requireAuth — a legacy token with NO aud claim at all is accepted transitionally as admin', async () => {
  const legacyToken = jwt.sign({ sub: 'admin-1', email: 'a@example.com' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '8h'
  })
  const restore = mockSupabaseSequence([
    {
      table: 'admins',
      result: {
        data: { id: 'admin-1', email: 'a@example.com', role: 'admin', is_active: true, punto_de_venta: 'Cerritos' },
        error: null
      }
    }
  ])
  const req = makeReq(legacyToken)
  let nextErr = 'not-called'
  try {
    await requireAuth(req, {}, (e) => { nextErr = e })
  } finally {
    restore()
  }
  assert.equal(nextErr, undefined)
  assert.equal(req.admin.id, 'admin-1')
})

// The DB lookup is mocked to SUCCEED on purpose: if the audience check were
// removed, this request would sail through to an attached req.admin instead
// of failing incidentally on an unreachable database. That makes the
// rejection attributable to the audience check and nothing else.
test('requireAuth — rejects a valid usuario-audience token', async () => {
  const usuarioToken = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
  const restore = mockSupabaseSequence([
    {
      table: 'admins',
      result: {
        data: { id: 'user-1', email: 'u@example.com', role: 'admin', is_active: true, punto_de_venta: 'Cerritos' },
        error: null
      }
    }
  ])
  const req = makeReq(usuarioToken)
  let err
  try {
    await requireAuth(req, {}, (e) => { err = e })
  } finally {
    restore()
  }
  assert.equal(err.status, 401)
  assert.equal(err.message, 'Invalid or expired token')
  assert.equal(req.admin, undefined)
})

test('requireAuth — attaches punto_de_venta to req.admin', async () => {
  const token = signToken({ sub: 'admin-1', email: 'a@example.com' }) // aud defaults 'admin'
  const restore = mockSupabaseSequence([
    {
      table: 'admins',
      result: {
        data: { id: 'admin-1', email: 'a@example.com', role: 'admin', is_active: true, punto_de_venta: 'Laureles' },
        error: null
      }
    }
  ])
  const req = makeReq(token)
  try {
    await requireAuth(req, {}, () => {})
  } finally {
    restore()
  }
  assert.equal(req.admin.punto_de_venta, 'Laureles')
})
