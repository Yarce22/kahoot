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
  } catch {
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
