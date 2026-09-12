import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { requireUserAuth } = await import('../src/middleware/requireUserAuth.js')
const { signToken } = await import('../src/lib/jwt.js')

function makeReq(token) {
  return token ? { headers: { authorization: `Bearer ${token}` } } : { headers: {} }
}

test('requireUserAuth — missing bearer token returns 401', async () => {
  let err
  await requireUserAuth(makeReq(null), {}, (e) => { err = e })
  assert.equal(err.status, 401)
  assert.equal(err.message, 'Missing bearer token')
})

test('requireUserAuth — rejects a legacy admin token with no aud claim at all', async () => {
  // Signed with the raw library, bypassing signToken's aud default, to
  // reproduce a genuinely pre-deploy/legacy token shape.
  const legacyToken = jwt.sign({ sub: 'admin-1', email: 'a@example.com' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '8h'
  })
  let err
  await requireUserAuth(makeReq(legacyToken), {}, (e) => { err = e })
  assert.equal(err.status, 401)
})

test('requireUserAuth — rejects a valid admin-audience token', async () => {
  const token = signToken({ sub: 'admin-1', email: 'a@example.com' }) // aud defaults to 'admin'
  let err
  await requireUserAuth(makeReq(token), {}, (e) => { err = e })
  assert.equal(err.status, 401)
})

test('requireUserAuth — rejects a deactivated usuario even with a structurally valid usuario token', async () => {
  const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
  const restore = mockSupabaseSequence([
    {
      table: 'users',
      result: {
        data: { id: 'user-1', email: 'u@example.com', full_name: 'Uno', punto_de_venta: 'Cerritos', is_active: false },
        error: null
      }
    }
  ])
  let err
  try {
    await requireUserAuth(makeReq(token), {}, (e) => { err = e })
  } finally {
    restore()
  }
  assert.equal(err.status, 401)
})

test('requireUserAuth — attaches req.user for an active usuario with a valid usuario token', async () => {
  const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
  const restore = mockSupabaseSequence([
    {
      table: 'users',
      result: {
        data: { id: 'user-1', email: 'u@example.com', full_name: 'Uno', punto_de_venta: 'Cerritos', is_active: true },
        error: null
      }
    }
  ])
  const req = makeReq(token)
  let nextErr = 'not-called'
  try {
    await requireUserAuth(req, {}, (e) => { nextErr = e })
  } finally {
    restore()
  }
  assert.equal(nextErr, undefined)
  assert.deepEqual(req.user, { id: 'user-1', email: 'u@example.com', fullName: 'Uno', puntoDeVenta: 'Cerritos' })
})
