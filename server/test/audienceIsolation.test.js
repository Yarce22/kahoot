import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'

// audienceIsolation.test.js — exercises requireAuth/requireUserAuth
// side-by-side to prove the audience-separated JWT boundary described in
// the spec (Audience-Separated JWT Issuance). The new /api/user/* and
// store-scoped admin routers that CHAIN these middlewares ship in a later
// PR of this change; the audience enforcement itself lives entirely in
// these two middleware functions, so testing them directly here proves the
// isolation independently of which router mounts them.

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { requireAuth } = await import('../src/middleware/requireAuth.js')
const { requireUserAuth } = await import('../src/middleware/requireUserAuth.js')
const { signToken } = await import('../src/lib/jwt.js')

function makeReq(token) {
  return { headers: { authorization: `Bearer ${token}` } }
}

test('audience isolation — a valid admin token is rejected by requireUserAuth', async () => {
  const adminToken = signToken({ sub: 'admin-1', email: 'a@example.com' }) // aud defaults 'admin'
  let err
  await requireUserAuth(makeReq(adminToken), {}, (e) => { err = e })
  assert.equal(err.status, 401)
})

test('audience isolation — a valid usuario token is rejected by requireAuth (admin routes)', async () => {
  const usuarioToken = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
  let err
  await requireAuth(makeReq(usuarioToken), {}, (e) => { err = e })
  assert.equal(err.status, 401)
})

test('audience isolation — a legacy token with NO aud claim is accepted by requireAuth (transitional)', async () => {
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
})

test('audience isolation — the SAME legacy no-aud token is rejected by requireUserAuth (never crosses into the usuario namespace)', async () => {
  const legacyToken = jwt.sign({ sub: 'admin-1', email: 'a@example.com' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '8h'
  })
  let err
  await requireUserAuth(makeReq(legacyToken), {}, (e) => { err = e })
  assert.equal(err.status, 401)
})
