// Postgres unique_violation error code.
const PG_UNIQUE_VIOLATION = '23505'

// isUniqueViolation — the primary signal is the Postgres error code, but
// supabase-js's error shape for constraint violations isn't formally
// guaranteed across versions/transports (e.g. PostgREST can surface the
// code differently, or omit it, while still describing the conflict in
// `message`/`details`). Fall back to a text match on the unique-constraint
// signal so the 409 mapping stays robust either way.
//
// Extracted from routes/auth.js and routes/admins.js, which duplicated this
// exact function; both now import it from here.
export function isUniqueViolation(error) {
  if (!error) return false
  if (error.code === PG_UNIQUE_VIOLATION) return true
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  return text.includes('duplicate key') || text.includes('unique constraint') || text.includes('already exists')
}

// PostgREST's code for "`.single()` did not match exactly one row".
const PGRST_NO_ROWS = 'PGRST116'

// isNoRowsReturned — `.single()` over ZERO rows resolves as an ERROR, not as
// `{ data: null, error: null }`. Callers that read that as a generic failure
// return a raw 500 (with the Postgres message in the body) where the honest
// answer is 404, and their `if (!data)` branch is dead code.
//
// Same two-signal shape as isUniqueViolation above and for the same reason:
// the code is the primary signal, the message a version-tolerant fallback.
export function isNoRowsReturned(error) {
  if (!error) return false
  if (error.code === PGRST_NO_ROWS) return true
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  return text.includes('multiple (or no) rows returned')
}
