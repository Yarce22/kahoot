import { test } from 'node:test'
import assert from 'node:assert/strict'
// Mirrors src/index.js:2 — without it an async throw inside a route handler
// never reaches errorHandler, so a crash-class bug hangs the request instead
// of surfacing as a clean 500.
import 'express-async-errors'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.AUTH_MODE = 'jwt'

// Task 8.1 — mounting the 5 async-attempt-flow routers in the REAL app
// (src/index.js), not a standalone test app. Every router below already has
// exhaustive per-route coverage against its own standalone app
// (userAuth.test.js, userQuizzes.test.js, users.test.js, assignments.test.js,
// attempts.test.js) — this file only proves each namespace is actually
// reachable through the real, fully-wired app, which none of those files can
// prove on their own.
const { app } = await import('../src/index.js')
const { default: request } = await import('supertest')

// An unmounted route falls through to Express's own default 404 handler. A
// mounted one under these namespaces always answers through a real
// middleware/handler first (401 missing-token, 400 missing-body, etc.) — so
// "anything other than a bare 404" is the mount proof.
test('router wiring — POST /api/user/login is mounted', async () => {
  const res = await request(app).post('/api/user/login').send({})
  assert.notEqual(res.status, 404)
  assert.equal(res.status, 400)
})

test('router wiring — GET /api/user/quizzes is mounted', async () => {
  const res = await request(app).get('/api/user/quizzes')
  assert.notEqual(res.status, 404)
  assert.equal(res.status, 401)
})

test('router wiring — POST /api/user/quizzes/:assignmentId/attempt is mounted', async () => {
  const res = await request(app).post('/api/user/quizzes/11111111-1111-4111-8111-111111111111/attempt')
  assert.notEqual(res.status, 404)
  assert.equal(res.status, 401)
})

test('router wiring — POST /api/user/attempts/:id/answers is mounted', async () => {
  const res = await request(app).post('/api/user/attempts/11111111-1111-4111-8111-111111111111/answers').send({})
  assert.notEqual(res.status, 404)
  assert.equal(res.status, 401)
})

test('router wiring — POST /api/user/attempts/:id/submit is mounted', async () => {
  const res = await request(app).post('/api/user/attempts/11111111-1111-4111-8111-111111111111/submit')
  assert.notEqual(res.status, 404)
  assert.equal(res.status, 401)
})

test('router wiring — GET /api/user/attempts/:id/result is mounted', async () => {
  const res = await request(app).get('/api/user/attempts/11111111-1111-4111-8111-111111111111/result')
  assert.notEqual(res.status, 404)
  assert.equal(res.status, 401)
})

test('router wiring — GET /api/users is mounted', async () => {
  const res = await request(app).get('/api/users')
  assert.notEqual(res.status, 404)
  assert.equal(res.status, 401)
})

test('router wiring — GET /api/assignments is mounted', async () => {
  const res = await request(app).get('/api/assignments')
  assert.notEqual(res.status, 404)
  assert.equal(res.status, 401)
})

test('router wiring — GET /api/attempts is mounted', async () => {
  const res = await request(app).get('/api/attempts')
  assert.notEqual(res.status, 404)
  assert.equal(res.status, 401)
})
