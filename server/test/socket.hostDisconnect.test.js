import { test } from 'node:test'
import assert from 'node:assert/strict'
import { io as ioClient } from 'socket.io-client'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'
// Legacy mode keeps these tests focused on host-abandonment behavior: no
// per-admin identity means verifyHostOwnership short-circuits without any
// supabase calls, so the only supabase interactions left to mock are the
// ones this feature itself is expected (or not expected) to make.
process.env.AUTH_MODE = 'legacy'
process.env.ADMIN_TOKEN = 'test-admin-token'
// Shrink the grace window so these tests don't wait 5 real minutes. Read
// once at module load by sockets/index.js (via ../src/index.js below), so
// it MUST be set before that import.
process.env.HOST_DISCONNECT_GRACE_MS = '150'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { httpServer } = await import('../src/index.js')
const { activeGames } = await import('../src/runtime/activeGames.js')

const GRACE_MS = 150

function listen() {
  return new Promise((resolve) => {
    httpServer.listen(0, () => resolve(httpServer.address().port))
  })
}

function closeServer() {
  return new Promise((resolve) => httpServer.close(resolve))
}

function makeGame(overrides = {}) {
  return {
    sessionId: 'session-1',
    quizId: 'quiz-1',
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
    hostDisconnectTimer: null,
    ...overrides
  }
}

function connectHost(port) {
  return ioClient(`http://localhost:${port}`, {
    auth: { adminToken: 'test-admin-token' },
    reconnection: false
  })
}

function connectPlayer(port) {
  return ioClient(`http://localhost:${port}`, { reconnection: false })
}

function waitConnect(client) {
  return new Promise((resolve, reject) => {
    client.on('connect', resolve)
    client.on('connect_error', reject)
  })
}

function joinSession(client, pin) {
  return new Promise((resolve) => client.emit('host:join-session', { pin }, resolve))
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('host disconnects and never reconnects -> grace period elapses -> session auto-ends', async () => {
  const pin = '700001'
  activeGames.set(pin, makeGame())

  const restore = mockSupabaseSequence([
    { table: 'game_sessions', result: { data: null, error: null } } // endGame's status update
  ])

  const port = await listen()
  const client = connectHost(port)
  try {
    await waitConnect(client)
    const ack = await joinSession(client, pin)
    assert.equal(ack.ok, true)

    client.close() // simulate the host's tab closing / network dropping

    // Wait past the (shrunk) grace window plus a buffer for the disconnect
    // event and endGame's async work to complete.
    await wait(GRACE_MS + 350)

    assert.equal(activeGames.has(pin), false)

    // Behavioral confirmation: the session is really gone, not just its
    // timer — a fresh host:join-session on the same pin now 404s.
    const client2 = connectHost(port)
    await waitConnect(client2)
    const ack2 = await joinSession(client2, pin)
    assert.deepEqual(ack2, { error: 'SESSION_NOT_FOUND' })
    client2.close()
  } finally {
    restore()
    activeGames.delete(pin)
    await closeServer()
  }
})

test('host disconnects then reconnects before the grace period elapses -> session stays alive', async () => {
  const pin = '700002'
  activeGames.set(pin, makeGame())

  // Any supabase call here would mean endGame ran, i.e. the reconnect
  // failed to cancel the pending auto-end — queue a defensive single entry
  // so a regression fails cleanly (assertion below) instead of crashing on
  // an exhausted-queue error.
  const restore = mockSupabaseSequence([
    { table: 'game_sessions', result: { data: null, error: null } }
  ])

  const port = await listen()
  const clientA = connectHost(port)
  let clientB
  try {
    await waitConnect(clientA)
    await joinSession(clientA, pin)

    clientA.close()

    // Give the server a moment to process the disconnect and arm the timer.
    await wait(50)

    clientB = connectHost(port)
    await waitConnect(clientB)
    const ackB = await joinSession(clientB, pin)
    assert.equal(ackB.ok, true)

    // Wait past the ORIGINAL grace window — if the timer wasn't cancelled,
    // the session would auto-end right about now.
    await wait(GRACE_MS + 250)

    assert.equal(activeGames.has(pin), true)
    assert.equal(restore.calls.length, 0)
  } finally {
    clientB?.close()
    restore()
    activeGames.delete(pin)
    await closeServer()
  }
})

test('a player disconnecting does not trigger host-abandonment behavior (regression)', async () => {
  const pin = '700003'
  const game = makeGame()
  activeGames.set(pin, game)

  const restore = mockSupabaseSequence([
    { table: 'players', result: { data: { id: 'player-1' }, error: null } } // join-game insert
  ])

  const port = await listen()
  const client = connectPlayer(port)
  try {
    await waitConnect(client)
    const ack = await new Promise((resolve) => {
      client.emit('join-game', { pin, nickname: 'Player1' }, resolve)
    })
    assert.equal(ack.playerId, 'player-1')
    assert.equal(game.players.size, 1)

    client.close() // simulate the player's tab closing

    // Wait past the (shrunk) grace window — a player disconnect must never
    // arm (or fire) the host-abandonment timer.
    await wait(GRACE_MS + 250)

    assert.equal(game.hostDisconnectTimer, null)
    assert.equal(activeGames.has(pin), true)
    assert.equal(restore.calls.filter((c) => c.table === 'game_sessions').length, 0)
  } finally {
    restore()
    activeGames.delete(pin)
    await closeServer()
  }
})
