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
 * Queue an ordered sequence of { table, result } responses. Each call to
 * `supabase.from(table)` consumes the next queued entry IN ORDER and
 * asserts the table name matches what the code under test is expected
 * to query — this keeps the mock honest about call order instead of
 * silently returning wrong data.
 *
 * @param {Array<{table: string, result: {data: any, error: any}}>} sequence
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
      throw new Error(`mockSupabaseSequence: expected supabase.from("${next.table}") but got supabase.from("${table}")`)
    }
    return makeQueryBuilder(next.result)
  }

  return function restoreSupabase() {
    supabase.from = originalFrom
  }
}
