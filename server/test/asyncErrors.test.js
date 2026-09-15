import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'

const { default: supabase } = await import('../src/lib/supabase.js')
const { app } = await import('../src/index.js')
const { errorHandler } = await import('../src/middleware/errorHandler.js')
const { httpError } = await import('../src/lib/httpError.js')
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
    // Generic on purpose — see the errorHandler tests below. The real message
    // goes to the server log, never to an (here unauthenticated) caller.
    assert.equal(res.body.error, 'Internal server error')
    assert.ok(!JSON.stringify(res.body).includes('supabase connection reset'))
  } finally {
    restore()
  }
})

// --- errorHandler: what the CLIENT is allowed to see ---
//
// Echoing err.message verbatim leaks internal detail to callers who have not
// authenticated: a rethrown `verifyToken: options.audience must be a non-empty
// string when provided` told an anonymous attacker the auth layer is
// misconfigured. Unexpected errors are loud in the log and mute on the wire.

function fakeRes() {
  const res = { statusCode: null, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (payload) => { res.body = payload; return res }
  return res
}

function captureConsoleError() {
  const original = console.error
  const calls = []
  console.error = (...args) => { calls.push(args) }
  const restore = () => { console.error = original }
  restore.calls = calls
  return restore
}

test('errorHandler — an error with no status returns a generic 500 body', () => {
  const restore = captureConsoleError()
  const res = fakeRes()
  const err = new TypeError('verifyToken: options.audience must be a non-empty string when provided')
  try {
    errorHandler(err, {}, res, () => {})
  } finally {
    restore()
  }

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.body, { error: 'Internal server error' })
  // Loud to operators: the real error still reaches the server log.
  assert.equal(restore.calls.length, 1)
  assert.equal(restore.calls[0][0], err)
})

test('errorHandler — an error whose message is empty also returns the generic 500 body', () => {
  const restore = captureConsoleError()
  const res = fakeRes()
  try {
    errorHandler(new Error(''), {}, res, () => {})
  } finally {
    restore()
  }
  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.body, { error: 'Internal server error' })
})

// The generic body must stay narrow: an httpError message is written FOR the
// caller ("Admin not found", "Invalid or expired token") and must survive.
test('errorHandler — an httpError keeps its status and its message', () => {
  for (const [status, message] of [[400, 'is_active must be a boolean'], [401, 'Invalid or expired token'], [404, 'Admin not found']]) {
    const restore = captureConsoleError()
    const res = fakeRes()
    try {
      errorHandler(httpError(status, message), {}, res, () => {})
    } finally {
      restore()
    }
    assert.equal(res.statusCode, status)
    assert.deepEqual(res.body, { error: message })
  }
})

// Some libraries use `statusCode` instead of `status` — that is still an
// intentional, caller-facing error.
test('errorHandler — a statusCode-carrying error keeps its message too', () => {
  const restore = captureConsoleError()
  const res = fakeRes()
  const err = new Error('Too many requests')
  err.statusCode = 429
  try {
    errorHandler(err, {}, res, () => {})
  } finally {
    restore()
  }
  assert.equal(res.statusCode, 429)
  assert.deepEqual(res.body, { error: 'Too many requests' })
})
