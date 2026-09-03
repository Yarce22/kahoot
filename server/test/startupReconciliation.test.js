import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET ??= 'test-secret'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key'

const { mockSupabaseSequence } = await import('./helpers/mockSupabase.js')
const { closeOrphanedSessions } = await import('../src/index.js')

// closeOrphanedSessions is exported as an independently-callable function
// specifically so it can be exercised here without booting the whole HTTP
// server (see src/index.js's comment above its definition).

test('closeOrphanedSessions — closes every lobby/active session and logs the count', async () => {
  const restore = mockSupabaseSequence([
    { table: 'game_sessions', result: { data: [{ id: 's1' }, { id: 's2' }], error: null } }
  ])
  const logSpy = console.log
  const logCalls = []
  console.log = (...args) => logCalls.push(args)

  try {
    await closeOrphanedSessions()

    const update = restore.calls.find((c) => c.table === 'game_sessions' && c.method === 'update')
    assert.ok(update, 'expected a game_sessions update call')
    assert.equal(update.args[0].status, 'finished')
    assert.ok(update.args[0].ended_at)

    const filter = restore.calls.find((c) => c.table === 'game_sessions' && c.method === 'in')
    assert.ok(filter, 'expected the update to be scoped via .in()')
    assert.deepEqual(filter.args, ['status', ['lobby', 'active']])

    assert.ok(logCalls.some(([msg]) => /closed 2 orphaned session/.test(msg)))
  } finally {
    console.log = logSpy
    restore()
  }
})

test('closeOrphanedSessions — logs and does not throw when the update errors', async () => {
  const restore = mockSupabaseSequence([
    { table: 'game_sessions', result: { data: null, error: { message: 'db unavailable' } } }
  ])
  const errorSpy = console.error
  const errorCalls = []
  console.error = (...args) => errorCalls.push(args)

  try {
    await assert.doesNotReject(() => closeOrphanedSessions())
    assert.ok(errorCalls.some(([msg]) => /failed to close orphaned sessions/.test(msg)))
  } finally {
    console.error = errorSpy
    restore()
  }
})
