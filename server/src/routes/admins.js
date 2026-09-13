import { Router } from 'express'
import bcrypt from 'bcryptjs'
import supabase from '../lib/supabase.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { authGate } from '../middleware/jwtGate.js'
import { requireSuperadmin } from '../middleware/requireSuperadmin.js'
import { httpError } from '../lib/httpError.js'
import { isUniqueViolation, isNoRowsReturned } from '../lib/pgErrors.js'
import { PUNTOS_DE_VENTA } from '../lib/puntosDeVenta.js'

export const adminsRouter = Router()

const BCRYPT_COST = 12
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_ROLES = ['admin', 'superadmin']
const PUNTO_DE_VENTA_ERROR = `punto_de_venta must be one of: ${PUNTOS_DE_VENTA.join(', ')}`

// Every route here is superadmin-only. requireAdmin keeps the legacy token
// gate honest under AUTH_MODE=legacy; authGate attaches req.admin under jwt;
// requireSuperadmin enforces the role.
const superadminOnly = [requireAdmin, authGate, requireSuperadmin]

// GET /api/admins — list every admin (superadmin only). punto_de_venta is
// part of the list so a superadmin can see which accounts still lack a store
// (migration 010 refuses to run while any of them is NULL).
adminsRouter.get('/', ...superadminOnly, async (req, res, next) => {
  const { data, error } = await supabase
    .from('admins')
    .select('id, email, role, is_active, punto_de_venta, created_at')
    .order('created_at', { ascending: true })

  if (error) return next(error)
  res.json(data ?? [])
})

// POST /api/admins — create an admin with a chosen role (superadmin only).
adminsRouter.post('/', ...superadminOnly, async (req, res, next) => {
  const { email, password, role = 'admin', punto_de_venta } = req.body ?? {}

  if (!email || !EMAIL_RE.test(email)) return next(httpError(400, 'A valid email is required'))
  if (!password) return next(httpError(400, 'password is required'))
  if (!VALID_ROLES.includes(role)) return next(httpError(400, 'role must be admin or superadmin'))
  // admins.punto_de_venta is NOT NULL with no default (migration 010) and
  // there is no safe fallback store — so it is required here, never guessed.
  if (!PUNTOS_DE_VENTA.includes(punto_de_venta)) return next(httpError(400, PUNTO_DE_VENTA_ERROR))

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
    .insert({ email, password_hash: passwordHash, role, punto_de_venta })
    .select('id, email, role, is_active, punto_de_venta')
    .single()

  if (error) {
    if (isUniqueViolation(error)) return next(httpError(409, 'An admin with this email already exists'))
    return next(error)
  }

  res.status(201).json(admin)
})

// PATCH /api/admins/:id — change an admin's role, active status and/or
// punto_de_venta (superadmin only). Guards against self-lockout and losing
// the last active superadmin.
//
// punto_de_venta is here because migration 010 flips the column to NOT NULL
// and refuses to run while any admin row is still NULL: this is the API path
// an operator uses to perform that manual backfill.
adminsRouter.patch('/:id', ...superadminOnly, async (req, res, next) => {
  const { id } = req.params
  const { role, is_active, punto_de_venta } = req.body ?? {}

  if (role === undefined && is_active === undefined && punto_de_venta === undefined) {
    return next(httpError(400, 'Provide role, is_active and/or punto_de_venta'))
  }
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return next(httpError(400, 'role must be admin or superadmin'))
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return next(httpError(400, 'is_active must be a boolean'))
  }
  if (punto_de_venta !== undefined && !PUNTOS_DE_VENTA.includes(punto_de_venta)) {
    return next(httpError(400, PUNTO_DE_VENTA_ERROR))
  }

  // Deactivating your own account logs you out instantly (requireAuth rejects
  // inactive admins) — always a footgun, so block it outright. Self-demotion
  // is allowed and instead governed by the last-superadmin guard below.
  if (id === req.admin.id && is_active === false) {
    return next(httpError(400, 'You cannot deactivate your own account'))
  }

  let updated = null

  if (role !== undefined || is_active !== undefined) {
    // The update + last-active-superadmin invariant runs inside a DB function
    // serialized by an advisory lock (migration 005), so concurrent PATCHes
    // can't race it into leaving zero active superadmins. It raises
    // 'admin_not_found' / 'last_active_superadmin', mapped to 404 / 409 here.
    const { data, error } = await supabase.rpc('update_admin_role_status', {
      target_id: id,
      new_role: role ?? null,
      new_active: is_active ?? null,
      // Carried INSIDE the same locked transaction (migration 011) rather than
      // as a follow-up write: applying the role/status change first and
      // punto_de_venta second meant a failure of the second left the first
      // already committed while the caller saw a total failure. NULL means
      // "leave unchanged" here, same as new_role/new_active.
      new_punto_de_venta: punto_de_venta ?? null
    })

    if (error) {
      // The raised message can surface in message/details/hint depending on the
      // PostgREST version — check all three.
      const text = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`
      if (text.includes('last_active_superadmin')) {
        return next(httpError(409, 'Cannot demote or deactivate the last active superadmin'))
      }
      if (text.includes('admin_not_found')) {
        return next(httpError(404, 'Admin not found'))
      }
      return next(error)
    }

    // The function RETURNS the full admins row (incl. password_hash) — expose
    // only the safe fields.
    updated = Array.isArray(data) ? data[0] : data

  // punto_de_venta ALONE is a plain column update: it carries none of the
  // last-active-superadmin invariant the RPC exists to serialize. Combined with
  // role/is_active it is NOT reachable here — the RPC above already applied it
  // atomically, and re-writing it separately is what made a combined PATCH
  // partially mutating.
  } else if (punto_de_venta !== undefined) {
    const { data: row, error: storeError } = await supabase
      .from('admins')
      .update({ punto_de_venta })
      .eq('id', id)
      .select('id, email, role, is_active, punto_de_venta')
      .single()

    // `.single()` over zero rows resolves as a PGRST116 ERROR (which carries no
    // `.status`, so errorHandler would fall through to a raw 500) — never as
    // `{ data: null, error: null }`. An unknown id is a 404 here, exactly like
    // the RPC's 'admin_not_found' above; any OTHER error is a real failure and
    // must not be disguised as one.
    if (isNoRowsReturned(storeError) || (!storeError && !row)) {
      return next(httpError(404, 'Admin not found'))
    }
    if (storeError) return next(storeError)
    updated = row
  }

  res.json({
    id: updated.id,
    email: updated.email,
    role: updated.role,
    is_active: updated.is_active,
    punto_de_venta: updated.punto_de_venta
  })
})
