import supabase from '../lib/supabase.js'
import { verifyToken } from '../lib/jwt.js'
import { httpError } from '../lib/httpError.js'

// requireAuth — validates a JWT bearer token and attaches req.admin.
// Used by the new jwt auth flow (register guard, and future PR2 ownership checks).
export async function requireAuth(req, res, next) {
  const header = req.headers['authorization']
  if (!header || !header.startsWith('Bearer ')) {
    return next(httpError(401, 'Missing bearer token'))
  }

  const token = header.slice('Bearer '.length).trim()
  if (!token) return next(httpError(401, 'Missing bearer token'))

  let payload
  try {
    payload = verifyToken(token)
  } catch {
    return next(httpError(401, 'Invalid or expired token'))
  }

  const { data: admin, error } = await supabase
    .from('admins')
    .select('id, email, role, is_active')
    .eq('id', payload.sub)
    .single()

  // Read fresh every request so a role change or deactivation takes effect
  // immediately, even while a previously-issued token is still unexpired.
  if (error || !admin || !admin.is_active) return next(httpError(401, 'Invalid or expired token'))

  req.admin = { id: admin.id, email: admin.email, role: admin.role }
  next()
}
