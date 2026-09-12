import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'

const {
  requireStoreScope,
  resolveStoreFilter,
  applyStoreFilter,
  assertSameStore
} = await import('../src/middleware/requireStoreScope.js')

// ---- requireStoreScope ----

test('requireStoreScope — 401 when req.admin is missing', () => {
  let err
  requireStoreScope({}, {}, (e) => { err = e })
  assert.equal(err.status, 401)
})

test('requireStoreScope — 403 when a non-superadmin admin has punto_de_venta === null (fail-closed pre-010)', () => {
  const req = { admin: { id: 'a1', role: 'admin', punto_de_venta: null } }
  let err
  requireStoreScope(req, {}, (e) => { err = e })
  assert.equal(err.status, 403)
})

test('requireStoreScope — passes through for a non-superadmin with a real store', () => {
  const req = { admin: { id: 'a1', role: 'admin', punto_de_venta: 'Cerritos' } }
  let called = 'not-called'
  requireStoreScope(req, {}, (e) => { called = e })
  assert.equal(called, undefined)
})

test('requireStoreScope — a superadmin with punto_de_venta === null still passes (unrestricted by design)', () => {
  const req = { admin: { id: 's1', role: 'superadmin', punto_de_venta: null } }
  let called = 'not-called'
  requireStoreScope(req, {}, (e) => { called = e })
  assert.equal(called, undefined)
})

// ---- resolveStoreFilter ----

test('resolveStoreFilter — superadmin with no requested store gets null (unrestricted)', () => {
  const req = { admin: { role: 'superadmin', punto_de_venta: null } }
  assert.equal(resolveStoreFilter(req, undefined), null)
})

test('resolveStoreFilter — superadmin CAN pass any requested store through', () => {
  const req = { admin: { role: 'superadmin', punto_de_venta: null } }
  assert.equal(resolveStoreFilter(req, 'Laureles'), 'Laureles')
})

test('resolveStoreFilter — non-superadmin with no requested store is scoped to their own', () => {
  const req = { admin: { role: 'admin', punto_de_venta: 'Cerritos' } }
  assert.equal(resolveStoreFilter(req, undefined), 'Cerritos')
})

test('resolveStoreFilter — non-superadmin requesting THEIR OWN store is a no-op (not a conflict)', () => {
  const req = { admin: { role: 'admin', punto_de_venta: 'Cerritos' } }
  assert.equal(resolveStoreFilter(req, 'Cerritos'), 'Cerritos')
})

test('resolveStoreFilter — non-superadmin requesting a DIFFERENT store throws 403 (never silently narrows)', () => {
  const req = { admin: { role: 'admin', punto_de_venta: 'Cerritos' } }
  assert.throws(() => resolveStoreFilter(req, 'Laureles'), (err) => err.status === 403)
})

// ---- applyStoreFilter ----

test('applyStoreFilter — filters the query by column when effectiveStore is set', () => {
  const calls = []
  const query = { eq: (col, val) => { calls.push([col, val]); return query } }
  const result = applyStoreFilter(query, 'Cerritos')
  assert.equal(result, query)
  assert.deepEqual(calls, [['punto_de_venta', 'Cerritos']])
})

test('applyStoreFilter — passes the query through unchanged when effectiveStore is null (superadmin, unrestricted)', () => {
  const calls = []
  const query = { eq: (col, val) => { calls.push([col, val]); return query } }
  const result = applyStoreFilter(query, null)
  assert.equal(result, query)
  assert.deepEqual(calls, [])
})

// ---- assertSameStore ----

test('assertSameStore — a superadmin can target any store', () => {
  const req = { admin: { role: 'superadmin', punto_de_venta: null } }
  assert.doesNotThrow(() => assertSameStore(req, 'Circunvalar'))
})

test('assertSameStore — a non-superadmin targeting their own store is fine', () => {
  const req = { admin: { role: 'admin', punto_de_venta: 'Cerritos' } }
  assert.doesNotThrow(() => assertSameStore(req, 'Cerritos'))
})

test('assertSameStore — a non-superadmin targeting a DIFFERENT store throws 403', () => {
  const req = { admin: { role: 'admin', punto_de_venta: 'Cerritos' } }
  assert.throws(() => assertSameStore(req, 'Laureles'), (err) => err.status === 403)
})
