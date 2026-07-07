import { requireAuth } from './requireAuth.js'
import { requireQuizOwner } from './requireQuizOwner.js'

// jwtGate helpers — wrap the jwt-based middlewares so they only enforce
// under AUTH_MODE=jwt. Under AUTH_MODE=legacy they are no-ops, so the
// legacy requireAdmin token guard remains the sole active check (no
// behavior change until the AUTH_MODE=jwt flip in PR3).

// authGate — enforces requireAuth (attaches req.admin) only under jwt mode.
export function authGate(req, res, next) {
  if (process.env.AUTH_MODE === 'jwt') return requireAuth(req, res, next)
  return next()
}

// ownerGate — enforces requireQuizOwner(options) only under jwt mode.
export function ownerGate(options) {
  const ownerMiddleware = requireQuizOwner(options)
  return function (req, res, next) {
    if (process.env.AUTH_MODE === 'jwt') return ownerMiddleware(req, res, next)
    return next()
  }
}
