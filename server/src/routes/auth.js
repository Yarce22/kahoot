import { Router } from 'express'
import { timingSafeEqual, randomBytes, createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import supabase from '../lib/supabase.js'
import { signToken } from '../lib/jwt.js'
import { httpError } from '../lib/httpError.js'
import { getClientOrigin } from '../lib/clientOrigin.js'
import emailService from '../lib/email.js'

export const authRouter = Router()

const BCRYPT_COST = 12
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000
const MIN_PASSWORD_LENGTH = 8

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

// Generic, identical response for forgot-password regardless of whether the
// email is registered — mirrors the anti-enumeration philosophy already
// used in /login (never let the response shape/content reveal account
// existence).
const FORGOT_PASSWORD_MESSAGE = 'Si ese email está registrado, te enviamos un enlace para restablecer tu contraseña.'

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

// POST /api/auth/forgot-password — always open, rate-limited.
//
// GUARANTEE: past input validation, this endpoint has exactly ONE response —
// 200 with FORGOT_PASSWORD_MESSAGE — on every single path: unknown email,
// known-but-deactivated admin, known-and-active admin, and even when the
// side effects (token cleanup, token insert, email send) fail. Nothing
// downstream of the admin lookup may `return next(...)`: a differing status
// code is itself an account-existence oracle, so failures are logged
// server-side and the flow falls through to the same 200.
//
// The email send is deliberately NOT awaited. Awaiting an external network
// call (Resend) only on the known-active branch made response time a
// measurable enumeration side-channel — badly so whenever Resend was merely
// slow. What remains is one extra DB write vs. the unknown branch's one DB
// read, which is comparable rather than a usable oracle.
authRouter.post('/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
  const { email } = req.body ?? {}

  if (!email || !EMAIL_RE.test(email)) return next(httpError(400, 'A valid email is required'))

  const { data: admin } = await supabase
    .from('admins')
    .select('id, email, is_active')
    .eq('email', email)
    .single()

  if (admin?.is_active) {
    const token = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString()

    // Opportunistic cleanup — reap THIS admin's already-used/expired token
    // rows while we're here. No scheduled job exists in this codebase and
    // adding one would be out of proportion for the MVP; piggybacking on the
    // request that creates a new row keeps the table from growing forever.
    const { error: cleanupError } = await supabase
      .from('password_reset_tokens')
      .delete()
      .eq('admin_id', admin.id)
      .or(`used_at.not.is.null,expires_at.lt.${now}`)

    if (cleanupError) {
      console.error('[forgot-password] failed to clean up stale reset tokens', { error: cleanupError })
    }

    const { error: insertError } = await supabase
      .from('password_reset_tokens')
      .insert({ admin_id: admin.id, token_hash: tokenHash, expires_at: expiresAt })

    if (insertError) {
      console.error('[forgot-password] failed to store reset token', { error: insertError })
    } else {
      // Only send the email once the token row actually landed — sending it
      // on an insert failure would hand out a link that can never resolve.
      // This costs nothing timing-wise: the send is already fire-and-forget.
      const resetUrl = `${getClientOrigin()}/reset-password?token=${token}`
      emailService
        .sendPasswordResetEmail({ to: admin.email, resetUrl })
        .catch((err) => console.error('[forgot-password] failed to send reset email', { error: err }))
    }
  }

  res.json({ message: FORGOT_PASSWORD_MESSAGE })
})

// POST /api/auth/reset-password — always open. Consumes a reset token
// (single use, time-limited) and sets a new password hash.
//
// Best-effort two-step (password update + token consumption) rather than a
// single transactional RPC — an accepted MVP tradeoff. The race window
// (token replayed between the two writes) is low-severity: worst case the
// same valid token resets the password twice before being marked used,
// which is not meaningfully worse than a single reset.
authRouter.post('/reset-password', resetPasswordLimiter, async (req, res, next) => {
  const { token, password } = req.body ?? {}

  if (!token) return next(httpError(400, 'token is required'))
  if (!password) return next(httpError(400, 'password is required'))
  if (password.length < MIN_PASSWORD_LENGTH) {
    return next(httpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`))
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')

  const { data: resetToken, error } = await supabase
    .from('password_reset_tokens')
    .select('id, admin_id, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .single()

  // Not found, already used, or expired all collapse into the same generic
  // 400 — the response never distinguishes which, so a token's state can't
  // be probed from the outside.
  const isValid = !error && resetToken && !resetToken.used_at && new Date(resetToken.expires_at) > new Date()

  if (!isValid) return next(httpError(400, 'Invalid or expired reset link'))

  // The token being valid is not enough — it may have been issued before the
  // owning admin was deactivated, which would otherwise let a revoked
  // account rotate its own password back into use. Flat second query rather
  // than a PostgREST embedded join, matching /login and /forgot-password.
  const { data: admin, error: adminError } = await supabase
    .from('admins')
    .select('id, is_active')
    .eq('id', resetToken.admin_id)
    .single()

  // Folded into the SAME generic 400 as the not-found/expired/used cases —
  // "account deactivated" as a distinct reason would leak account state.
  if (adminError || !admin || !admin.is_active) {
    return next(httpError(400, 'Invalid or expired reset link'))
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

  const { error: updateError } = await supabase
    .from('admins')
    .update({ password_hash: passwordHash })
    .eq('id', resetToken.admin_id)

  if (updateError) return next(updateError)

  // Past this point the password HAS changed, so the response is always the
  // success message. The token-bookkeeping writes below are best effort —
  // failing them cannot un-change the password, so surfacing an error to the
  // user would be actively misleading. They are loud in the logs instead:
  // an unconsumed token stays replayable until its 30-min TTL expires, and
  // that must not fail silently.
  const usedAt = new Date().toISOString()

  const { error: consumeError } = await supabase
    .from('password_reset_tokens')
    .update({ used_at: usedAt })
    .eq('id', resetToken.id)

  if (consumeError) {
    console.error('[reset-password] failed to mark token as used', { tokenId: resetToken.id, error: consumeError })
  }

  // Invalidate this admin's OTHER outstanding tokens too. Requesting several
  // reset emails leaves several live tokens; once one is redeemed an old
  // link that leaked (forwarded email, shared inbox, browser history) must
  // not still be able to change the password inside its TTL window.
  const { error: siblingError } = await supabase
    .from('password_reset_tokens')
    .update({ used_at: usedAt })
    .eq('admin_id', resetToken.admin_id)
    .is('used_at', null)

  if (siblingError) {
    console.error('[reset-password] failed to invalidate sibling reset tokens', { adminId: resetToken.admin_id, error: siblingError })
  }

  res.json({ message: 'Contraseña actualizada correctamente' })
})

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
