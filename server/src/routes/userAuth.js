import { Router } from 'express'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
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

// userLoginLimiter — login's OWN budget, applied to this route only.
//
// The whole /api/user/* namespace is metered by src/index.js's much wider
// userFlowLimiter, because the quiz-taking flow is chatty by design (one POST
// per answer). Login is not part of that flow: it verifies a password with
// bcrypt, so it is simultaneously a credential-guessing oracle and a
// CPU-exhaustion lever, and nothing in userFlowLimiter's sizing rationale
// (question_count + 5 requests per attempt) accounts for login abuse. Without
// this limiter, moving the namespace off the global /api budget silently
// multiplied usuario login's per-IP guessing budget tenfold.
//
// The value is POST /api/auth/login's established budget, not a new number:
// admin login has no dedicated limiter and is therefore metered by
// src/index.js's global 100/15min. Both login endpoints now cost an attacker
// the same, and a punto de venta's whole staff — NATed behind ONE public IP,
// so this budget is store-wide rather than per-user — still has room to sign
// in with the odd typo. Deliberately looser than auth.js's 5/10 budgets for
// forgot-password/reset-password: those guard e-mail bombing and token
// guessing, neither of which has legitimate store-wide volume.
//
// Exported so tests can call the documented `resetKey()` API between cases —
// same reason auth.js exports its two limiters.
export const userLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
})

// POST /api/user/login — usuario login. Mirrors POST /api/auth/login's
// anti-enumeration shape exactly: unknown email, wrong password, and a
// deactivated account all collapse into the identical 401 (spec: Usuario
// login issues usuario-audience token).
userAuthRouter.post('/login', userLoginLimiter, async (req, res, next) => {
  const { email, password } = req.body ?? {}

  if (typeof email !== 'string' || !email || !password) {
    return next(httpError(400, 'email and password are required'))
  }

  // Normalized identically to routes/users.js's create path. The column's
  // UNIQUE index is case-sensitive, so an un-normalized lookup would fail to
  // match a stored address the caller typed with different casing.
  const normalizedEmail = email.trim().toLowerCase()

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, password_hash, full_name, punto_de_venta, is_active')
    .eq('email', normalizedEmail)
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
