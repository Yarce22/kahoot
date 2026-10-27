import { Router } from 'express'
import { timingSafeEqual } from 'crypto'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import supabase from '../lib/supabase.js'
import { signToken } from '../lib/jwt.js'
import { httpError } from '../lib/httpError.js'
import { createPasswordRecoveryHandlers } from '../lib/passwordRecovery.js'
import { isUniqueViolation } from '../lib/pgErrors.js'
import { PUNTOS_DE_VENTA } from '../lib/puntosDeVenta.js'

export const authRouter = Router()

const BCRYPT_COST = 12
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PUNTO_DE_VENTA_ERROR = `punto_de_venta must be one of: ${PUNTOS_DE_VENTA.join(', ')}`

// Stricter than the global /api limiter (100 req/15min) — forgot-password
// can be abused for email enumeration (timing/behavior probing) or
// email-bombing a target inbox, so it gets its own tight budget.
// Exported so tests can call the documented `resetKey()` API between cases —
// the limiter is a module-level singleton, so without a reset every test in a
// file would silently spend the same budget and the assertions would become
// coupled to how many requests the preceding tests happened to make.
export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false
})

// reset-password gets its own budget too — it's an unauthenticated endpoint
// that runs bcrypt (CPU) per call and is otherwise a free token-guessing
// oracle. Looser than forgot-password's 5 because legitimate retries here
// are more likely (typo in the new password, mismatched confirmation).
export const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
})


// Static dummy hash used to keep the unknown-email path's timing comparable
// to the wrong-password path — otherwise skipping bcrypt.compare entirely
// when the email doesn't exist leaks account existence via response time.
// Generated once with: bcrypt.hashSync('not-a-real-password', 12)
const DUMMY_HASH = '$2b$12$fLW7OVDfaQDuxoDkJ7EWWOiDMJL77XGv/x.iF1N4el6P300rNwPsq'

// POST /api/auth/login — always open.
authRouter.post('/login', async (req, res, next) => {
  const { email, password } = req.body ?? {}

  if (!email || !password) return next(httpError(400, 'email and password are required'))

  const { data: admin, error } = await supabase
    .from('admins')
    .select('id, email, password_hash, role, is_active')
    .eq('email', email)
    .single()

  // Unknown email and wrong password return the identical response AND take
  // comparable time — when the email isn't found we still run bcrypt.compare
  // against a static dummy hash so the response time doesn't leak whether
  // the email exists (timing side-channel / email enumeration).
  const passwordMatches = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH)

  // A deactivated admin is folded into the same generic 401 as a bad
  // credential so the response never reveals that the account exists but is
  // disabled.
  if (error || !admin || !passwordMatches || !admin.is_active) {
    return next(httpError(401, 'Invalid email or password'))
  }

  // aud is explicit (not left to signToken's default) so this call site
  // reads correctly on its own and stays correct even if the default ever
  // changes — admin login must always issue an admin-audience token
  // (spec: Audience-Separated JWT Issuance).
  const token = signToken({ sub: admin.id, email: admin.email, aud: 'admin' })

  res.json({ token, admin: { id: admin.id, email: admin.email, role: admin.role } })
})

// Forgot/reset handlers are shared with the usuario flow — see
// lib/passwordRecovery.js for the anti-enumeration and token guarantees.
const { forgotPassword, resetPassword } = createPasswordRecoveryHandlers({
  accountTable: 'admins',
  tokenTable: 'password_reset_tokens',
  fkColumn: 'admin_id',
  resetPath: '/reset-password'
})

// POST /api/auth/forgot-password — always open, rate-limited.
authRouter.post('/forgot-password', forgotPasswordLimiter, forgotPassword)

// POST /api/auth/reset-password — always open, rate-limited.
authRouter.post('/reset-password', resetPasswordLimiter, resetPassword)


// POST /api/auth/register — legacy break-glass ONLY, for bootstrapping the
// very first admin. Requires a valid legacy ADMIN_TOKEN header and is active
// only when AUTH_LEGACY_TOKEN_ENABLED is truthy.
//
// Admin-to-admin creation under RBAC goes through the superadmin-only
// POST /api/admins route — a JWT-authenticated (non-break-glass) path here
// would bypass that gate, letting a plain admin provision accounts, so it is
// intentionally NOT offered.
authRouter.post('/register', async (req, res, next) => {
  if (!process.env.AUTH_LEGACY_TOKEN_ENABLED || !legacyAdminTokenMatches(req)) {
    return next(httpError(403, 'Registration is disabled'))
  }

  return createAdmin(req, res, next)
})

function legacyAdminTokenMatches(req) {
  const token = req.headers['x-admin-token']
  const expected = process.env.ADMIN_TOKEN
  if (!token || !expected) return false

  try {
    const tokenBuf = Buffer.from(token)
    const expectedBuf = Buffer.from(expected)
    if (tokenBuf.length !== expectedBuf.length) return false
    return timingSafeEqual(tokenBuf, expectedBuf)
  } catch {
    return false
  }
}

async function createAdmin(req, res, next) {
  const { email, password, punto_de_venta } = req.body ?? {}

  if (!email || !EMAIL_RE.test(email)) return next(httpError(400, 'A valid email is required'))
  if (!password) return next(httpError(400, 'password is required'))
  // Same NOT NULL column as POST /api/admins (migration 010): the bootstrap
  // admin must name its store too, and there is no safe default to fall back on.
  if (!PUNTOS_DE_VENTA.includes(punto_de_venta)) return next(httpError(400, PUNTO_DE_VENTA_ERROR))

  // Note: the pre-check below is a UX fast path only, NOT the source of
  // truth for uniqueness — it has a TOCTOU race (two concurrent registers
  // with the same email can both pass this check). The `admins.email`
  // UNIQUE constraint is the actual guard; its violation is caught below
  // and mapped to 409 instead of leaking a raw 500.
  const { data: existing } = await supabase
    .from('admins')
    .select('id')
    .eq('email', email)
    .single()

  if (existing) return next(httpError(409, 'An admin with this email already exists'))

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

  const { data: admin, error } = await supabase
    .from('admins')
    .insert({ email, password_hash: passwordHash, punto_de_venta })
    // punto_de_venta is read back and returned so both admin-creation paths
    // answer with the same shape — POST /api/admins already exposes it, and the
    // column is required on the way in, so hiding it on the way out is just an
    // inconsistency a caller has to work around.
    .select('id, email, punto_de_venta')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      return next(httpError(409, 'An admin with this email already exists'))
    }
    return next(error)
  }

  res.status(201).json({ admin: { id: admin.id, email: admin.email, punto_de_venta: admin.punto_de_venta } })
}
