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

function makeQueryBuilder(result, calls = [], table) {
  const resolved = Promise.resolve(result)
  // record — the write-shaping calls (`insert`/`update`) and the filter that
  // scopes them (`eq`) are the only things a test can use to assert WHAT was
  // actually persisted, so their arguments are captured. Everything else
  // stays a bare passthrough.
  const record = (method) => (...args) => {
    calls.push({ table, method, args })
    return builder
  }
  const builder = {
    // `select` is recorded too: the column list is the only observable proof
    // that a read actually asks for a given column (e.g. punto_de_venta).
    // `select` is recorded with ALL its arguments, so a test can assert the
    // options bag too — notably `{ count: 'exact' }`, which is what makes the
    // reported `total` a real row count rather than the length of one page.
    select: record('select'),
    eq: record('eq'),
    in: record('in'),
    is: () => builder,
    or: record('or'),
    gte: record('gte'),
    lte: record('lte'),
    // `range` is recorded, not simulated: PostgREST answers a ranged request
    // with the ALREADY-SLICED page plus the full count, so a fixture supplies
    // `{ data, count }` for the window it represents and the test asserts the
    // window that was actually requested.
    range: record('range'),
    order: () => builder,
    limit: () => builder,
    insert: record('insert'),
    // `upsert` is recorded with ALL its arguments, options bag included: the
    // `{ onConflict, ignoreDuplicates }` pair is the only observable proof that
    // a batch write is ONE conflict-tolerant statement rather than a loop of
    // inserts, which is what makes it atomic.
    upsert: record('upsert'),
    update: record('update'),
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
 * A `result` may carry `count` alongside `data`/`error`; it flows through
 * untouched, mirroring what PostgREST returns for a `{ count: 'exact' }`
 * select — the total matching row count, independent of the page returned.
 *
 * The returned restore function additionally carries a `.calls` array
 * recording every
 * `select`/`insert`/`upsert`/`update`/`eq`/`in`/`or`/`gte`/`lte`/`range`
 * made across the whole sequence
 * (plus every `rpc`, as `{ table: fnName, method: 'rpc', args: [params] }`)
 * as `{ table, method, args }` — so a test can assert the payload that was
 * actually sent (e.g. that a password was stored as a bcrypt hash, not
 * plaintext) and the filter it was scoped by, not merely that some write
 * happened. Purely additive: callers that only need `restore()` can keep
 * ignoring it.
 *
 * @param {Array<{table?: string, rpc?: string, result: {data?: any, error?: any}}>} sequence
 * @returns {(() => void) & { calls: Array<{table: string, method: string, args: any[]}> }} restore function — call in test teardown
 */
export function mockSupabaseSequence(sequence) {
  const queue = [...sequence]
  const calls = []

  supabase.from = (table) => {
    const next = queue.shift()
    if (!next) {
      throw new Error(`mockSupabaseSequence: unexpected supabase.from("${table}") call — queue exhausted`)
    }
    if (next.table !== table) {
      const expected = next.rpc ? `rpc("${next.rpc}")` : `from("${next.table}")`
      throw new Error(`mockSupabaseSequence: expected ${expected} but got from("${table}")`)
    }
    return makeQueryBuilder(next.result, calls, table)
  }

  supabase.rpc = (fn, args) => {
    const next = queue.shift()
    if (!next) {
      throw new Error(`mockSupabaseSequence: unexpected supabase.rpc("${fn}") call — queue exhausted`)
    }
    if (next.rpc !== fn) {
      const expected = next.table ? `from("${next.table}")` : `rpc("${next.rpc}")`
      throw new Error(`mockSupabaseSequence: expected ${expected} but got rpc("${fn}")`)
    }
    // Recorded like insert/update: the RPC arguments are the only observable
    // proof of WHAT a route asked the database function to change — and of how
    // many writes it took to get there.
    calls.push({ table: fn, method: 'rpc', args: [args] })
    return Promise.resolve(next.result)
  }

  function restoreSupabase() {
    supabase.from = originalFrom
    if (originalRpc) supabase.rpc = originalRpc
  }

  restoreSupabase.calls = calls

  return restoreSupabase
}
