import { test } from 'node:test'
import assert from 'node:assert/strict'
import { io as ioClient } from 'socket.io-client'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
// AUTH_MODE intentionally left unset (legacy) — this file verifies the
// C1 fix: a JWT `auth.token` handshake must NOT grant host status under
// legacy mode, symmetric to how a legacy `adminToken` handshake is
// rejected under AUTH_MODE=jwt.
delete process.env.AUTH_MODE

const { httpServer } = await import('../src/index.js')
const { signToken } = await import('../src/lib/jwt.js')

function listen() {
  return new Promise((resolve) => {
    httpServer.listen(0, () => resolve(httpServer.address().port))
  })
}

function closeServer() {
  return new Promise((resolve) => httpServer.close(resolve))
}

test('socket handshake — legacy mode: a valid JWT auth.token does NOT grant host status', async () => {
  const pin = '000002'
  const token = signToken({ sub: 'admin-1', email: 'a@example.com' })

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

    // The socket connects (falls through to the anonymous path), but must
    // not be treated as host — host-only events must be refused.
    const ack = await new Promise((resolve) => {
      client.emit('host:join-session', { pin }, resolve)
    })

    assert.deepEqual(ack, { error: 'UNAUTHORIZED' })
  } finally {
    client.close()
    await closeServer()
  }
})
