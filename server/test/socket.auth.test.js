import { test } from 'node:test'
import assert from 'node:assert/strict'
import { io as ioClient } from 'socket.io-client'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
process.env.AUTH_MODE = 'jwt'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { httpServer } = await import('../src/index.js')
const { signToken } = await import('../src/lib/jwt.js')
const { activeGames } = await import('../src/runtime/activeGames.js')
const { jwtHostAuthMiddleware } = await import('../src/sockets/hostAuth.js')

function listen() {
  return new Promise((resolve) => {
    httpServer.listen(0, () => resolve(httpServer.address().port))
  })
}

function closeServer() {
  return new Promise((resolve) => httpServer.close(resolve))
}

function makeGame(quizId) {
  return {
    sessionId: 'session-1',
    quizId,
    questions: [],
    currentQuestionIndex: -1,
    tickHandle: null,
    timeoutHandle: null,
    questionStartedAt: null,
    players: new Map(),
    answersReceived: new Set(),
    answerCounts: new Map(),
    firstCorrectAnswered: false,
    hostSocketIds: new Set(),
    hostDisconnectTimer: null
  }
}

// ---- jwtHostAuthMiddleware: audience enforcement ----
//
// This is the ONLY auth path for the live-game host socket under
// AUTH_MODE=jwt, and it must refuse a usuario-audience token exactly like
// requireAuth does on the HTTP side. The admins lookup is mocked to SUCCEED
// so the rejection is attributable to the audience check alone, and not to a
// lookup that happens to fail on a users.id.
const ADMIN_ROW = { id: 'user-1', email: 'u@example.com', role: 'admin', is_active: true }

test('jwtHostAuthMiddleware — a usuario-audience token never becomes a host', async () => {
  const token = signToken({ sub: 'user-1', email: 'u@example.com', aud: 'usuario' })
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: ADMIN_ROW, error: null } }
  ])
  const socket = { handshake: { auth: { token } } }
  let err
  try {
    await jwtHostAuthMiddleware(socket, (e) => { err = e })
  } finally {
    restore()
  }
  assert.equal(err.message, 'UNAUTHORIZED')
  assert.equal(socket.isHost, undefined)
  assert.equal(socket.admin, undefined)
})

test('jwtHostAuthMiddleware — a legacy no-aud token is still accepted (same one-release tolerance as requireAuth)', async () => {
  const legacyToken = jwt.sign({ sub: 'admin-1', email: 'a@example.com' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '8h'
  })
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: { ...ADMIN_ROW, id: 'admin-1', email: 'a@example.com' }, error: null } }
  ])
  const socket = { handshake: { auth: { token: legacyToken } } }
  let err = 'not-called'
  try {
    await jwtHostAuthMiddleware(socket, (e) => { err = e })
  } finally {
    restore()
  }
  assert.equal(err, undefined)
  assert.equal(socket.isHost, true)
})

test('socket handshake — invalid JWT is rejected at connection', async () => {
  const port = await listen()
  const client = ioClient(`http://localhost:${port}`, {
    auth: { token: 'not-a-real-jwt' },
    reconnection: false
  })
  try {
    await new Promise((resolve, reject) => {
      client.on('connect', () => reject(new Error('should not connect with an invalid token')))
      client.on('connect_error', () => resolve())
    })
  } finally {
    client.close()
    await closeServer()
  }
})

test('socket handshake — valid JWT for a deactivated admin is rejected at connection', async () => {
  const admin = { id: 'admin-1', email: 'a@example.com', role: 'admin', is_active: false }
  const token = signToken({ sub: admin.id, email: admin.email })

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: admin, error: null } } // jwtHostAuthMiddleware
  ])

  const port = await listen()
  const client = ioClient(`http://localhost:${port}`, {
    auth: { token },
    reconnection: false
  })
  try {
    await new Promise((resolve, reject) => {
      client.on('connect', () => reject(new Error('a deactivated admin must not connect as host')))
      client.on('connect_error', () => resolve())
    })
  } finally {
    restore()
    client.close()
    await closeServer()
  }
})

// NOTE / assumption: a socket with NO token at all still connects — that is
// required behavior for anonymous players (join-game never authenticates).
// "Missing JWT -> rejected" is therefore verified at the HOST-ACTION layer
// instead of at the transport layer: a tokenless socket connects, but
// `socket.isHost` is never set, so any host-only event is refused.
test('socket handshake — missing token connects as a non-host (host actions are refused)', async () => {
  const pin = '000001'
  const port = await listen()
  const client = ioClient(`http://localhost:${port}`, { reconnection: false })
  try {
    await new Promise((resolve, reject) => {
      client.on('connect', resolve)
      client.on('connect_error', reject)
    })

    const ack = await new Promise((resolve) => {
      client.emit('host:join-session', { pin }, resolve)
    })

    assert.deepEqual(ack, { error: 'UNAUTHORIZED' })
  } finally {
    client.close()
    await closeServer()
  }
})

test('socket handshake — a superadmin can host another admin session', async () => {
  const superadmin = { id: 'super-1', email: 'boss@example.com', role: 'superadmin', is_active: true }
  const token = signToken({ sub: superadmin.id, email: superadmin.email })
  const pin = '123458'

  activeGames.set(pin, makeGame('someone-elses-quiz'))

  // Only the auth lookup queries supabase — verifyHostOwnership short-circuits
  // for a superadmin without hitting the quizzes table.
  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: superadmin, error: null } } // jwtHostAuthMiddleware
  ])

  const port = await listen()
  const client = ioClient(`http://localhost:${port}`, {
    auth: { token },
    reconnection: false
  })
  try {
    await new Promise((resolve, reject) => {
      client.on('connect', resolve)
      client.on('connect_error', reject)
    })

    const ack = await new Promise((resolve) => {
      client.emit('host:join-session', { pin }, resolve)
    })

    assert.equal(ack.ok, true)
  } finally {
    restore()
    activeGames.delete(pin)
    client.close()
    await closeServer()
  }
})

test('socket handshake — valid JWT but NOT the quiz owner is rejected on host:join-session', async () => {
  const admin = { id: 'admin-1', email: 'a@example.com', role: 'admin', is_active: true }
  const otherOwnerId = 'admin-2'
  const token = signToken({ sub: admin.id, email: admin.email })
  const pin = '123457'

  activeGames.set(pin, makeGame('quiz-2'))

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: admin, error: null } },                       // jwtHostAuthMiddleware
    { table: 'quizzes', result: { data: { owner_id: otherOwnerId }, error: null } }   // host:join-session ownership check
  ])

  const port = await listen()
  const client = ioClient(`http://localhost:${port}`, {
    auth: { token },
    reconnection: false
  })
  try {
    await new Promise((resolve, reject) => {
      client.on('connect', resolve)
      client.on('connect_error', reject)
    })

    const ack = await new Promise((resolve) => {
      client.emit('host:join-session', { pin }, resolve)
    })

    assert.deepEqual(ack, { error: 'UNAUTHORIZED' })
  } finally {
    restore()
    activeGames.delete(pin)
    client.close()
    await closeServer()
  }
})

test('socket handshake — valid JWT + owned session is accepted', async () => {
  const admin = { id: 'admin-1', email: 'a@example.com', role: 'admin', is_active: true }
  const token = signToken({ sub: admin.id, email: admin.email })
  const pin = '123456'

  activeGames.set(pin, makeGame('quiz-1'))

  const restore = mockSupabaseSequence([
    { table: 'admins', result: { data: admin, error: null } },              // jwtHostAuthMiddleware
    { table: 'quizzes', result: { data: { owner_id: admin.id }, error: null } } // host:join-session ownership check
  ])

  const port = await listen()
  const client = ioClient(`http://localhost:${port}`, {
    auth: { token },
    reconnection: false
  })
  try {
    await new Promise((resolve, reject) => {
      client.on('connect', resolve)
      client.on('connect_error', reject)
    })

    const ack = await new Promise((resolve) => {
      client.emit('host:join-session', { pin }, resolve)
    })

    assert.equal(ack.ok, true)
    assert.deepEqual(ack.players, [])
  } finally {
    restore()
    activeGames.delete(pin)
    client.close()
    await closeServer()
  }
})
