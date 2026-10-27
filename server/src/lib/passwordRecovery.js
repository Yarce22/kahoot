import { randomBytes, createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import supabase from './supabase.js'
import { httpError } from './httpError.js'
import { getClientOrigin } from './clientOrigin.js'
import emailService from './email.js'

// Shared forgot-password / reset-password handlers for the two account types
// (admins, usuarios). Only the storage names and the reset link differ, so they
// are parameters; every anti-enumeration and token-lifecycle guarantee lives
// here once. Rate limiters stay with each router (they are per-audience budgets).

export const FORGOT_PASSWORD_MESSAGE = 'Si ese email está registrado, te enviamos un enlace para restablecer tu contraseña.'

const BCRYPT_COST = 12
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000
const MIN_PASSWORD_LENGTH = 8

/**
 * @param {object} config
 * @param {string} config.accountTable   e.g. 'admins'
 * @param {string} config.tokenTable     e.g. 'password_reset_tokens'
 * @param {string} config.fkColumn       token table column pointing at the account, e.g. 'admin_id'
 * @param {string} config.resetPath      client route the emailed link points at, e.g. '/reset-password'
 * @param {(email: string) => string} [config.normalizeEmail] applied before the account lookup
 */
export function createPasswordRecoveryHandlers({
  accountTable,
  tokenTable,
  fkColumn,
  resetPath,
  normalizeEmail = (email) => email
}) {
  // POST forgot-password — GUARANTEE: past input validation this has exactly
  // ONE response (200 + FORGOT_PASSWORD_MESSAGE) on every path: unknown email,
  // deactivated account, active account, and even when the side effects (token
  // cleanup, insert, email send) fail. Nothing downstream of the account lookup
  // may `return next(...)`: a differing status is an account-existence oracle.
  // The email send is deliberately NOT awaited — awaiting an external call only
  // on the known-active branch would make response time an enumeration channel.
  async function forgotPassword(req, res, next) {
    const { email: rawEmail } = req.body ?? {}

    if (!rawEmail || typeof rawEmail !== 'string') return next(httpError(400, 'A valid email is required'))

    const email = normalizeEmail(rawEmail)
    if (!EMAIL_RE.test(email)) return next(httpError(400, 'A valid email is required'))

    const { data: account } = await supabase
      .from(accountTable)
      .select('id, email, is_active')
      .eq('email', email)
      .single()

    if (account?.is_active) {
      const token = randomBytes(32).toString('hex')
      const tokenHash = createHash('sha256').update(token).digest('hex')
      const now = new Date().toISOString()
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString()

      // Opportunistic cleanup — reap THIS account's already-used/expired token
      // rows. No scheduled job exists, so piggyback on the request that creates
      // a new row to keep the table from growing forever.
      const { error: cleanupError } = await supabase
        .from(tokenTable)
        .delete()
        .eq(fkColumn, account.id)
        .or(`used_at.not.is.null,expires_at.lt.${now}`)

      if (cleanupError) {
        console.error('[forgot-password] failed to clean up stale reset tokens', { error: cleanupError })
      }

      const { error: insertError } = await supabase
        .from(tokenTable)
        .insert({ [fkColumn]: account.id, token_hash: tokenHash, expires_at: expiresAt })

      if (insertError) {
        console.error('[forgot-password] failed to store reset token', { error: insertError })
      } else {
        // Only send once the token row landed — otherwise the link can never resolve.
        const resetUrl = `${getClientOrigin()}${resetPath}?token=${token}`
        emailService
          .sendPasswordResetEmail({ to: account.email, resetUrl })
          .catch((err) => console.error('[forgot-password] failed to send reset email', { error: err }))
      }
    }

    res.json({ message: FORGOT_PASSWORD_MESSAGE })
  }

  // POST reset-password — consumes a reset token (single use, time-limited) and
  // sets a new password hash. Best-effort two-step (password update + token
  // consumption) rather than a transactional RPC — an accepted MVP tradeoff.
  async function resetPassword(req, res, next) {
    const { token, password } = req.body ?? {}

    if (!token) return next(httpError(400, 'token is required'))
    if (!password) return next(httpError(400, 'password is required'))
    if (password.length < MIN_PASSWORD_LENGTH) {
      return next(httpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`))
    }

    const tokenHash = createHash('sha256').update(token).digest('hex')

    const { data: resetToken, error } = await supabase
      .from(tokenTable)
      .select(`id, ${fkColumn}, expires_at, used_at`)
      .eq('token_hash', tokenHash)
      .single()

    // Not found, already used, or expired collapse into the same generic 400 so
    // a token's state can't be probed from the outside.
    const isValid = !error && resetToken && !resetToken.used_at && new Date(resetToken.expires_at) > new Date()

    if (!isValid) return next(httpError(400, 'Invalid or expired reset link'))

    const accountId = resetToken[fkColumn]

    // A valid token isn't enough — it may predate the account's deactivation,
    // which would let a revoked account rotate its password back into use.
    const { data: account, error: accountError } = await supabase
      .from(accountTable)
      .select('id, is_active')
      .eq('id', accountId)
      .single()

    // Same generic 400: "account deactivated" as a distinct reason would leak state.
    if (accountError || !account || !account.is_active) {
      return next(httpError(400, 'Invalid or expired reset link'))
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

    const { error: updateError } = await supabase
      .from(accountTable)
      .update({ password_hash: passwordHash })
      .eq('id', accountId)

    if (updateError) return next(updateError)

    // The password HAS changed, so the response is always success from here on;
    // the token-bookkeeping writes are best effort but loud in the logs, since an
    // unconsumed token stays replayable until its 30-min TTL expires.
    const usedAt = new Date().toISOString()

    const { error: consumeError } = await supabase
      .from(tokenTable)
      .update({ used_at: usedAt })
      .eq('id', resetToken.id)

    if (consumeError) {
      console.error('[reset-password] failed to mark token as used', { tokenId: resetToken.id, error: consumeError })
    }

    // Invalidate the account's OTHER outstanding tokens too, so an older leaked
    // link can't change the password inside its TTL window.
    const { error: siblingError } = await supabase
      .from(tokenTable)
      .update({ used_at: usedAt })
      .eq(fkColumn, accountId)
      .is('used_at', null)

    if (siblingError) {
      console.error('[reset-password] failed to invalidate sibling reset tokens', { accountId, error: siblingError })
    }

    res.json({ message: 'Contraseña actualizada correctamente' })
  }

  return { forgotPassword, resetPassword }
}
