import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET ??= 'test-secret'

const { signToken, verifyToken } = await import('../src/lib/jwt.js')

test('signToken — defaults aud to "admin" when not provided', () => {
  const token = signToken({ sub: 'admin-1', email: 'a@example.com' })
  const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
  assert.equal(decoded.aud, 'admin')
  assert.equal(decoded.sub, 'admin-1')
})

test('signToken — accepts an explicit aud (e.g. "usuario")', () => {
  const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
  const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
  assert.equal(decoded.aud, 'usuario')
})

test('verifyToken — with no audience option accepts any aud', () => {
  const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
  const payload = verifyToken(token)
  assert.equal(payload.aud, 'usuario')
})

test('verifyToken — with { audience } rejects a token whose aud does not match', () => {
  const token = signToken({ sub: 'admin-1', email: 'a@example.com', aud: 'admin' })
  assert.throws(() => verifyToken(token, { audience: 'usuario' }))
})

test('verifyToken — with { audience } accepts a token whose aud matches', () => {
  const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
  const payload = verifyToken(token, { audience: 'usuario' })
  assert.equal(payload.sub, 'user-1')
})

// A falsy audience used to mean "apply no audience constraint at all" — so a
// typo'd/empty option silently downgraded a checked verification to an
// unchecked one. Passing the option AT ALL must never weaken the check.
test('verifyToken — an empty-string audience throws instead of verifying unconstrained', () => {
  const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
  assert.throws(() => verifyToken(token, { audience: '' }), /audience/i)
})

test('verifyToken — a null audience throws instead of verifying unconstrained', () => {
  const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
  assert.throws(() => verifyToken(token, { audience: null }), /audience/i)
})

test('verifyToken — a non-string audience throws', () => {
  const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
  assert.throws(() => verifyToken(token, { audience: 123 }), /audience/i)
})

test('verifyToken — with { audience } rejects a token that has no aud claim at all', () => {
  // A pre-deploy legacy token, signed without the aud option at all — the
  // native audience check must reject a MISSING claim just as it rejects a
  // mismatched one (this is the rule requireUserAuth relies on).
  const legacyToken = jwt.sign({ sub: 'admin-1', email: 'a@example.com' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '8h'
  })
  assert.throws(() => verifyToken(legacyToken, { audience: 'usuario' }))
})
