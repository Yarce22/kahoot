import { Router } from 'express'
import { timingSafeEqual } from 'crypto'
import bcrypt from 'bcryptjs'
import supabase from '../lib/supabase.js'
import { signToken } from '../lib/jwt.js'
import { httpError } from '../lib/httpError.js'
import { requireAuth } from '../middleware/requireAuth.js'

export const authRouter = Router()

const BCRYPT_COST = 12
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Static dummy hash used to keep the unknown-email path's timing comparable
// to the wrong-password path — otherwise skipping bcrypt.compare entirely
// when the email doesn't exist leaks account existence via response time.
// Generated once with: bcrypt.hashSync('not-a-real-password', 12)
const DUMMY_HASH = '$2b$12$fLW7OVDfaQDuxoDkJ7EWWOiDMJL77XGv/x.iF1N4el6P300rNwPsq'

// Postgres unique_violation error code
const PG_UNIQUE_VIOLATION = '23505'

// isUniqueViolation — the primary signal is the Postgres error code, but
// supabase-js's error shape for constraint violations isn't formally
// guaranteed across versions/transports (e.g. PostgREST can surface the
// code differently, or omit it, while still describing the conflict in
// `message`/`details`). Fall back to a text match on the unique-constraint
// signal so the 409 mapping stays robust either way.
function isUniqueViolation(error) {
  if (!error) return false
  if (error.code === PG_UNIQUE_VIOLATION) return true
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  return text.includes('duplicate key') || text.includes('unique constraint') || text.includes('already exists')
}

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

  const token = signToken({ sub: admin.id, email: admin.email })

  res.json({ token, admin: { id: admin.id, email: admin.email, role: admin.role } })
})

// POST /api/auth/register — bootstrap-first, NOT open.
// Allowed via either:
//   - an already-authenticated admin (valid jwt bearer token) — always
//     allowed, independent of AUTH_LEGACY_TOKEN_ENABLED, since disabling
//     that flag is meant to retire the legacy break-glass token, not lock
//     out admin creation entirely for admins who already have accounts.
//   - a valid legacy ADMIN_TOKEN header — only when AUTH_LEGACY_TOKEN_ENABLED
//     is truthy (the break-glass path for bootstrapping the very first admin).
authRouter.post('/register', async (req, res, next) => {
  const authHeader = req.headers['authorization']

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return requireAuth(req, res, (err) => {
      if (err) return next(err)
      createAdmin(req, res, next)
    })
  }

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
  const { email, password } = req.body ?? {}

  if (!email || !EMAIL_RE.test(email)) return next(httpError(400, 'A valid email is required'))
  if (!password) return next(httpError(400, 'password is required'))

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
    .insert({ email, password_hash: passwordHash })
    .select('id, email')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      return next(httpError(409, 'An admin with this email already exists'))
    }
    return next(error)
  }

  res.status(201).json({ admin: { id: admin.id, email: admin.email } })
}
