import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'

const { requireJwtMode } = await import('../src/middleware/jwtGate.js')

test('requireJwtMode — rejects with 501 when AUTH_MODE is not "jwt"', () => {
  const previous = process.env.AUTH_MODE
  process.env.AUTH_MODE = 'legacy'
  let err
  try {
    requireJwtMode({}, {}, (e) => { err = e })
  } finally {
    process.env.AUTH_MODE = previous
  }
  assert.equal(err.status, 501)
})

test('requireJwtMode — calls next() with no error when AUTH_MODE is "jwt"', () => {
  const previous = process.env.AUTH_MODE
  process.env.AUTH_MODE = 'jwt'
  let called = 'not-called'
  try {
    requireJwtMode({}, {}, (e) => { called = e })
  } finally {
    process.env.AUTH_MODE = previous
  }
  assert.equal(called, undefined)
})
