import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
// requireAuth/requireQuizOwner only enforce under AUTH_MODE=jwt (see
// server/src/middleware/jwtGate.js) — the PR3 flip to jwt-by-default
// hasn't happened yet, so tests set it explicitly, in-process.
process.env.AUTH_MODE = 'jwt'

const { app } = await import('../src/index.js')
const { default: request } = await import('supertest')

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
