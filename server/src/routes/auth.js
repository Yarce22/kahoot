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

// POST /api/auth/login — always open.
authRouter.post('/login', async (req, res, next) => {
  const { email, password } = req.body ?? {}

  if (!email || !password) return next(httpError(400, 'email and password are required'))

  const { data: admin, error } = await supabase
    .from('admins')
    .select('id, email, password_hash')
    .eq('email', email)
    .single()

  // Unknown email and wrong password return the identical response —
  // no email enumeration.
  if (error || !admin) return next(httpError(401, 'Invalid email or password'))

  const passwordMatches = await bcrypt.compare(password, admin.password_hash)
  if (!passwordMatches) return next(httpError(401, 'Invalid email or password'))

  const token = signToken({ sub: admin.id, email: admin.email })

  res.json({ token, admin: { id: admin.id, email: admin.email } })
})

// POST /api/auth/register — bootstrap-first, NOT open.
// Allowed only when AUTH_LEGACY_TOKEN_ENABLED is truthy AND either:
//   - the request carries a valid legacy ADMIN_TOKEN header, OR
//   - the request is from an already-authenticated admin (jwt bearer token)
authRouter.post('/register', async (req, res, next) => {
  if (!process.env.AUTH_LEGACY_TOKEN_ENABLED) {
    return next(httpError(403, 'Registration is disabled'))
  }

  const hasValidLegacyToken = legacyAdminTokenMatches(req)

  if (!hasValidLegacyToken) {
    return requireAuth(req, res, (err) => {
      if (err) return next(err)
      createAdmin(req, res, next)
    })
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

  if (error) return next(error)

  res.status(201).json({ admin: { id: admin.id, email: admin.email } })
}
