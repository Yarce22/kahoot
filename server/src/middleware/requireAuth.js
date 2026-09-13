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
    // No native `audience` option here (unlike requireUserAuth) — this
    // namespace must tolerate a pre-deploy token with NO aud claim for one
    // release. The audience is instead checked manually below.
    payload = verifyToken(token)
  } catch (err) {
    // A TypeError is not a bad token — it is verifyToken refusing a broken
    // `audience` option, i.e. a programming/config error. Mapping it to the
    // ordinary 401 is what made that deliberate loud failure indistinguishable
    // from normal traffic: an audience check degraded into no check at all
    // would just look like every request failing to authenticate. Rethrow so it
    // surfaces as a 500 instead of hiding among the rejections.
    if (err instanceof TypeError) throw err
    return next(httpError(401, 'Invalid or expired token'))
  }

  // A missing aud is treated as 'admin' (transitional, pre-deploy tokens);
  // any OTHER audience (e.g. 'usuario') is rejected outright.
  // TODO(next release): switch to verifyToken(token, { audience: 'admin' })
  // once every legacy no-aud token has expired, and delete this check.
  if (payload.aud !== undefined && payload.aud !== 'admin') {
    return next(httpError(401, 'Invalid or expired token'))
  }

  const { data: admin, error } = await supabase
    .from('admins')
    .select('id, email, role, is_active, punto_de_venta')
    .eq('id', payload.sub)
    .single()

  // Read fresh every request so a role change or deactivation takes effect
  // immediately, even while a previously-issued token is still unexpired.
  if (error || !admin || !admin.is_active) return next(httpError(401, 'Invalid or expired token'))

  req.admin = { id: admin.id, email: admin.email, role: admin.role, punto_de_venta: admin.punto_de_venta }
  next()
}
