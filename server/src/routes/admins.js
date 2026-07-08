import { Router } from 'express'
import bcrypt from 'bcryptjs'
import supabase from '../lib/supabase.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { authGate } from '../middleware/jwtGate.js'
import { requireSuperadmin } from '../middleware/requireSuperadmin.js'
import { httpError } from '../lib/httpError.js'

export const adminsRouter = Router()

const BCRYPT_COST = 12
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_ROLES = ['admin', 'superadmin']
const PG_UNIQUE_VIOLATION = '23505'

// Every route here is superadmin-only. requireAdmin keeps the legacy token
// gate honest under AUTH_MODE=legacy; authGate attaches req.admin under jwt;
// requireSuperadmin enforces the role.
const superadminOnly = [requireAdmin, authGate, requireSuperadmin]

// GET /api/admins — list every admin (superadmin only).
adminsRouter.get('/', ...superadminOnly, async (req, res, next) => {
  const { data, error } = await supabase
    .from('admins')
    .select('id, email, role, is_active, created_at')
    .order('created_at', { ascending: true })

  if (error) return next(error)
  res.json(data ?? [])
})

// POST /api/admins — create an admin with a chosen role (superadmin only).
adminsRouter.post('/', ...superadminOnly, async (req, res, next) => {
  const { email, password, role = 'admin' } = req.body ?? {}

  if (!email || !EMAIL_RE.test(email)) return next(httpError(400, 'A valid email is required'))
  if (!password) return next(httpError(400, 'password is required'))
  if (!VALID_ROLES.includes(role)) return next(httpError(400, 'role must be admin or superadmin'))

  // Fast-path pre-check (not the source of truth — the UNIQUE constraint is;
  // its violation is mapped to 409 below).
  const { data: existing } = await supabase
    .from('admins')
    .select('id')
    .eq('email', email)
    .single()

  if (existing) return next(httpError(409, 'An admin with this email already exists'))

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

  const { data: admin, error } = await supabase
    .from('admins')
    .insert({ email, password_hash: passwordHash, role })
    .select('id, email, role, is_active')
    .single()

  if (error) {
    if (isUniqueViolation(error)) return next(httpError(409, 'An admin with this email already exists'))
    return next(error)
  }

  res.status(201).json(admin)
})

// PATCH /api/admins/:id — change an admin's role and/or active status
// (superadmin only). Guards against self-lockout and losing the last
// active superadmin.
adminsRouter.patch('/:id', ...superadminOnly, async (req, res, next) => {
  const { id } = req.params
  const { role, is_active } = req.body ?? {}

  if (role === undefined && is_active === undefined) {
    return next(httpError(400, 'Provide role and/or is_active'))
  }
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return next(httpError(400, 'role must be admin or superadmin'))
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return next(httpError(400, 'is_active must be a boolean'))
  }

  // Deactivating your own account logs you out instantly (requireAuth rejects
  // inactive admins) — always a footgun, so block it outright. Self-demotion
  // is allowed and instead governed by the last-superadmin guard below.
  if (id === req.admin.id && is_active === false) {
    return next(httpError(400, 'You cannot deactivate your own account'))
  }

  const { data: target, error: targetErr } = await supabase
    .from('admins')
    .select('id, role, is_active')
    .eq('id', id)
    .single()

  if (targetErr || !target) return next(httpError(404, 'Admin not found'))

  // If this change would strip superadmin/active from a currently-active
  // superadmin, make sure at least one active superadmin remains.
  const removesSuperadminAccess =
    target.role === 'superadmin' && target.is_active &&
    (role === 'admin' || is_active === false)

  if (removesSuperadminAccess) {
    const { count } = await supabase
      .from('admins')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'superadmin')
      .eq('is_active', true)

    if ((count ?? 0) <= 1) {
      return next(httpError(409, 'Cannot demote or deactivate the last active superadmin'))
    }
  }

  const updates = {}
  if (role !== undefined) updates.role = role
  if (is_active !== undefined) updates.is_active = is_active

  const { data: updated, error } = await supabase
    .from('admins')
    .update(updates)
    .eq('id', id)
    .select('id, email, role, is_active')
    .single()

  if (error || !updated) return next(httpError(404, 'Admin not found'))
  res.json(updated)
})

function isUniqueViolation(error) {
  if (!error) return false
  if (error.code === PG_UNIQUE_VIOLATION) return true
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  return text.includes('duplicate key') || text.includes('unique constraint') || text.includes('already exists')
}
