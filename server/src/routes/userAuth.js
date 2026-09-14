import { Router } from 'express'
import bcrypt from 'bcryptjs'
import supabase from '../lib/supabase.js'
import { signToken } from '../lib/jwt.js'
import { httpError } from '../lib/httpError.js'
import { requireJwtMode } from '../middleware/jwtGate.js'

export const userAuthRouter = Router()

// This namespace has no legacy identity to fall back to — see requireJwtMode
// (design D3). Every route below requires AUTH_MODE=jwt.
userAuthRouter.use(requireJwtMode)

// Static dummy hash used to keep the unknown-email path's timing comparable
// to the wrong-password path — same rationale and same literal value as
// routes/auth.js's DUMMY_HASH (design: "same static DUMMY_HASH bcrypt
// compare for timing parity as auth.js:87"). Generated once with:
// bcrypt.hashSync('not-a-real-password', 12)
const DUMMY_HASH = '$2b$12$fLW7OVDfaQDuxoDkJ7EWWOiDMJL77XGv/x.iF1N4el6P300rNwPsq'

// POST /api/user/login — usuario login. Mirrors POST /api/auth/login's
// anti-enumeration shape exactly: unknown email, wrong password, and a
// deactivated account all collapse into the identical 401 (spec: Usuario
// login issues usuario-audience token).
userAuthRouter.post('/login', async (req, res, next) => {
  const { email, password } = req.body ?? {}

  if (!email || !password) return next(httpError(400, 'email and password are required'))

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, password_hash, full_name, punto_de_venta, is_active')
    .eq('email', email)
    .single()

  // Unknown email still runs bcrypt.compare against the dummy hash so the
  // response time doesn't leak whether the email exists.
  const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH)

  if (error || !user || !passwordMatches || !user.is_active) {
    return next(httpError(401, 'Invalid email or password'))
  }

  const token = signToken({ sub: user.id, email: user.email, aud: 'usuario' })

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      puntoDeVenta: user.punto_de_venta
    }
  })
})
