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
