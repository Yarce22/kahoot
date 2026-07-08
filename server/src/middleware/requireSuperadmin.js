import { httpError } from '../lib/httpError.js'

// requireSuperadmin — authorization guard for superadmin-only actions.
// Must run AFTER requireAuth (which attaches req.admin, including the role
// read fresh from the database on every request). A plain admin gets 403;
// an unauthenticated request gets 401.
export function requireSuperadmin(req, res, next) {
  if (!req.admin) return next(httpError(401, 'Authentication required'))
  if (req.admin.role !== 'superadmin') return next(httpError(403, 'Superadmin role required'))
  next()
}
