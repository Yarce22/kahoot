// An error carrying an explicit .status/.statusCode was raised deliberately
// (see lib/httpError.js): its message is written FOR the caller — "Admin not
// found", "Invalid or expired token" — so it is returned verbatim.
//
// Anything else is an UNEXPECTED failure, and its message is internal detail:
// a driver string, a Postgres error, or a rethrown `verifyToken: options.
// audience must be a non-empty string when provided`. Echoing that told a
// caller who has not even authenticated yet exactly how the server is broken —
// far more useful to an attacker than to a legitimate client. The real error
// stays loud in the server log; the wire gets a generic body.
export function errorHandler(err, req, res, next) {
  console.error(err)

  const status = err.status || err.statusCode
  if (status) {
    return res.status(status).json({ error: err.message || 'Internal server error' })
  }

  res.status(500).json({ error: 'Internal server error' })
}
