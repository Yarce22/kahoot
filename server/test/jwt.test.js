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
