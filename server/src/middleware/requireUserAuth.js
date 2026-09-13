import supabase from '../lib/supabase.js'
import { verifyToken } from '../lib/jwt.js'
import { httpError } from '../lib/httpError.js'

// requireUserAuth — validates a usuario-audience JWT bearer token and
// attaches req.user. Structural clone of requireAuth.js for the usuario
// namespace (spec: Audience-Separated JWT Issuance, Usuario Account Must Be
// Active).
export async function requireUserAuth(req, res, next) {
  const header = req.headers['authorization']
  if (!header || !header.startsWith('Bearer ')) {
    return next(httpError(401, 'Missing bearer token'))
  }

  const token = header.slice('Bearer '.length).trim()
  if (!token) return next(httpError(401, 'Missing bearer token'))

  let payload
  try {
    // Native audience check: jwt.verify REJECTS a token with no aud claim,
    // which is exactly the required rule — a pre-deploy admin token (or any
    // admin-audience token) can never satisfy this namespace.
    payload = verifyToken(token, { audience: 'usuario' })
  } catch (err) {
    // A TypeError is not a bad token — it is verifyToken refusing a broken
    // `audience` option, i.e. a programming/config error. Mapping it to the
    // ordinary 401 is what made that deliberate loud failure indistinguishable
    // from normal traffic: an audience check degraded into no check at all
    // would just look like every request failing to authenticate. Rethrow so it
    // surfaces as a 500 instead of hiding among the rejections.
    //
    // Reach, honestly: NO current call site can trigger this. verifyToken only
    // throws that TypeError for a present-but-invalid `options.audience`, and
    // the audience passed above is a hardcoded valid string literal. It is
    // defense-in-depth for a future caller that passes a dynamic or
    // config-derived audience — not a guard against a live bug.
    if (err instanceof TypeError) throw err
    return next(httpError(401, 'Invalid or expired token'))
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, full_name, punto_de_venta, is_active')
    .eq('id', payload.sub)
    .single()

  // Read fresh every request (same rationale as requireAuth): deactivating a
  // usuario takes effect immediately even with an unexpired token.
  if (error || !user || !user.is_active) return next(httpError(401, 'Invalid or expired token'))

  req.user = {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    puntoDeVenta: user.punto_de_venta
  }
  next()
}
