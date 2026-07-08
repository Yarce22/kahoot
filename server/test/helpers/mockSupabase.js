import supabase from '../../src/lib/supabase.js'

// Thin injectable seam for testing routes/middleware against Supabase
// without a live database. `supabase` is a plain object instance
// (the return value of createClient), so its `.from` method can be
// safely reassigned in-process — every module that imported the
// default export shares the same object reference (ESM module cache).
//
// There is no live test database in this repo yet, so these tests
// exercise the HTTP/socket layer against a scripted Supabase response
// queue instead of real Postgres. See server/test/README.md for the
// documented assumption.

const originalFrom = supabase.from.bind(supabase)
const originalRpc = typeof supabase.rpc === 'function' ? supabase.rpc.bind(supabase) : undefined

function makeQueryBuilder(result) {
  const resolved = Promise.resolve(result)
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    single: () => resolved,
    then: (onFulfilled, onRejected) => resolved.then(onFulfilled, onRejected)
  }
  return builder
}

/**
 * Queue an ordered sequence of responses. Each entry is either a
 * `{ table, result }` (consumed by `supabase.from(table)`) or a
 * `{ rpc, result }` (consumed by `supabase.rpc(name)`). Calls are matched
 * against the queue head IN ORDER and the table/function name is asserted —
 * this keeps the mock honest about call order instead of silently returning
 * wrong data.
 *
 * @param {Array<{table?: string, rpc?: string, result: {data?: any, error?: any}}>} sequence
 * @returns {() => void} restore function — call in test teardown
 */
export function mockSupabaseSequence(sequence) {
  const queue = [...sequence]

  supabase.from = (table) => {
    const next = queue.shift()
    if (!next) {
      throw new Error(`mockSupabaseSequence: unexpected supabase.from("${table}") call — queue exhausted`)
    }
    if (next.table !== table) {
      const expected = next.rpc ? `rpc("${next.rpc}")` : `from("${next.table}")`
      throw new Error(`mockSupabaseSequence: expected ${expected} but got from("${table}")`)
    }
    return makeQueryBuilder(next.result)
  }

  supabase.rpc = (fn) => {
    const next = queue.shift()
    if (!next) {
      throw new Error(`mockSupabaseSequence: unexpected supabase.rpc("${fn}") call — queue exhausted`)
    }
    if (next.rpc !== fn) {
      const expected = next.table ? `from("${next.table}")` : `rpc("${next.rpc}")`
      throw new Error(`mockSupabaseSequence: expected ${expected} but got rpc("${fn}")`)
    }
    return Promise.resolve(next.result)
  }

  return function restoreSupabase() {
    supabase.from = originalFrom
    if (originalRpc) supabase.rpc = originalRpc
  }
}
