import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'

const { default: supabase } = await import('../src/lib/supabase.js')
const { app } = await import('../src/index.js')
const { default: request } = await import('supertest')

const originalFrom = supabase.from.bind(supabase)

// Force every supabase query in the chain to reject, simulating a driver /
// network failure mid-handler. Terminal awaits (`.single()` and thenable)
// reject; the rejected promise is consumed immediately by the handler.
function mockSupabaseReject(error) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    single: () => Promise.reject(error),
    then: (onFulfilled, onRejected) => Promise.reject(error).then(onFulfilled, onRejected)
  }
  supabase.from = () => builder
  return function restore() {
    supabase.from = originalFrom
  }
}

// Without express-async-errors, a rejection in an async route handler is
// never forwarded to next(), so the request hangs (and, on modern Node, an
// unhandled rejection can crash the process). This asserts the hardening:
// the rejection is caught and routed to errorHandler, which responds 500.
test('async handler rejection is caught and returned as 500 (not a hang)', async () => {
  const restore = mockSupabaseReject(new Error('supabase connection reset'))
  try {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@example.com', password: 'whatever' })

    assert.equal(res.status, 500)
    assert.equal(res.body.error, 'supabase connection reset')
  } finally {
    restore()
  }
})
