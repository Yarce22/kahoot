import { timingSafeEqual } from 'crypto'
import supabase from '../lib/supabase.js'
import { verifyToken } from '../lib/jwt.js'

// hostAuthMiddleware — legacy global-token socket guard.
// Stays active only while AUTH_MODE !== 'jwt' (mirrors requireAdmin's
// gating). Under AUTH_MODE=jwt, host sockets must authenticate via
// jwtHostAuthMiddleware instead.
export function hostAuthMiddleware(socket, next) {
  if (process.env.AUTH_MODE === 'jwt') return next(new Error('UNAUTHORIZED'))

  const token = socket.handshake.auth?.adminToken
  if (!token) return next(new Error('UNAUTHORIZED'))
  const expected = process.env.ADMIN_TOKEN
  if (!expected) return next(new Error('UNAUTHORIZED'))
  try {
    const a = Buffer.from(token)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return next(new Error('UNAUTHORIZED'))
  } catch {
    return next(new Error('UNAUTHORIZED'))
  }
  socket.isHost = true
  next()
}

// jwtHostAuthMiddleware — validates a JWT bearer token carried in the
// socket handshake (`auth.token`) and attaches the admin identity.
// Stays active only while AUTH_MODE === 'jwt' (mirrors hostAuthMiddleware's
// gating, symmetrically). Under legacy mode, a JWT handshake must NOT grant
// host status — the caller (sockets/index.js io.use) should not even reach
// this middleware under legacy, but the check is repeated here as
// defense in depth.
export async function jwtHostAuthMiddleware(socket, next) {
  if (process.env.AUTH_MODE !== 'jwt') return next(new Error('UNAUTHORIZED'))

  const token = socket.handshake.auth?.token
  if (!token) return next(new Error('UNAUTHORIZED'))

  let payload
  try {
    payload = verifyToken(token)
  } catch (err) {
    // A TypeError is not a bad token — it is verifyToken refusing a broken
    // `audience` option, i.e. a programming/config error. Reporting it as the
    // ordinary UNAUTHORIZED made that deliberate loud failure indistinguishable
    // from normal traffic. Unlike the HTTP middlewares this one cannot rethrow:
    // sockets/index.js calls it WITHOUT awaiting, so a rejected promise would be
    // an unhandled rejection. It logs and reports a distinct error instead —
    // still failing closed, since a misconfiguration must never grant host.
    if (err instanceof TypeError) {
      console.error('jwtHostAuthMiddleware: verifyToken is misconfigured —', err)
      return next(new Error('AUTH_MISCONFIGURED'))
    }
    return next(new Error('UNAUTHORIZED'))
  }

  // Same audience rule as requireAuth on the HTTP side, including the same
  // one-release tolerance for pre-deploy tokens with no aud claim: a missing
  // aud is treated as 'admin', any OTHER audience (e.g. 'usuario') is
  // refused. Without this, a usuario token passes signature verification and
  // is blocked only incidentally, by an admins lookup on a users.id.
  // TODO(next release): switch to verifyToken(token, { audience: 'admin' })
  // once every legacy no-aud token has expired, and delete this check.
  if (payload.aud !== undefined && payload.aud !== 'admin') {
    return next(new Error('UNAUTHORIZED'))
  }

  const { data: admin, error } = await supabase
    .from('admins')
    .select('id, email, role, is_active')
    .eq('id', payload.sub)
    .single()

  // Read fresh so a deactivated admin loses host access immediately, even
  // with a still-valid token (mirrors requireAuth on the HTTP side).
  if (error || !admin || !admin.is_active) return next(new Error('UNAUTHORIZED'))

  socket.admin = { id: admin.id, email: admin.email, role: admin.role }
  socket.isHost = true
  next()
}
