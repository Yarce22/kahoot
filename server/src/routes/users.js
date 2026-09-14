import { Router } from 'express'
import bcrypt from 'bcryptjs'
import supabase from '../lib/supabase.js'
import { requireJwtMode } from '../middleware/jwtGate.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireStoreScope, resolveStoreFilter, applyStoreFilter, assertSameStore } from '../middleware/requireStoreScope.js'
import { httpError } from '../lib/httpError.js'
import { isUniqueViolation, isNoRowsReturned } from '../lib/pgErrors.js'
import { PUNTOS_DE_VENTA } from '../lib/puntosDeVenta.js'

export const usersRouter = Router()

const BCRYPT_COST = 12
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8
const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100
const PUNTO_DE_VENTA_ERROR = `punto_de_venta must be one of: ${PUNTOS_DE_VENTA.join(', ')}`

// This namespace has no legacy identity to fall back to — store scoping is
// meaningless without a JWT admin identity (design D3/D4).
usersRouter.use(requireJwtMode, requireAuth, requireStoreScope)

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.page_size, 10) || DEFAULT_PAGE_SIZE))
  return { page, pageSize }
}

// GET /api/users — store-scoped usuario list (spec: Non-superadmin Read
// Scoping). Filtered/paged in application code rather than via supabase's
// `.range()` — the same "fetch the matching set, then page" approach this
// codebase already uses (routes/quizzes.js has no server-side pagination
// either); acceptable for this internal tool's per-store row counts.
usersRouter.get('/', async (req, res, next) => {
  let effectiveStore
  try {
    effectiveStore = resolveStoreFilter(req, req.query.punto_de_venta)
  } catch (err) {
    return next(err)
  }

  let query = supabase
    .from('users')
    .select('id, email, full_name, punto_de_venta, is_active, created_at')
    .order('created_at', { ascending: false })

  query = applyStoreFilter(query, effectiveStore)
  if (req.query.is_active !== undefined) query = query.eq('is_active', req.query.is_active === 'true')

  const { data, error } = await query
  if (error) return next(error)

  const all = data ?? []
  const { page, pageSize } = parsePagination(req.query)
  const start = (page - 1) * pageSize

  res.json({
    users: all.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total: all.length
  })
})

// POST /api/users — create a usuario account (spec: Store-Scoped Usuario
// CRUD). An omitted punto_de_venta defaults to the caller's own store;
// assertSameStore blocks a non-superadmin from targeting another one.
usersRouter.post('/', async (req, res, next) => {
  const { email, password, full_name, punto_de_venta } = req.body ?? {}

  if (!email || !EMAIL_RE.test(email)) return next(httpError(400, 'A valid email is required'))
  // `typeof` first, deliberately: a non-string has no usable `.length`, so a
  // NUMBER password sailed past `undefined < 8` (false) and only blew up later
  // inside bcrypt.hash, which refuses non-string input.
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return next(httpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`))
  }
  if (typeof full_name !== 'string' || full_name.trim().length === 0) {
    return next(httpError(400, 'full_name is required'))
  }

  const targetStore = punto_de_venta ?? req.admin.punto_de_venta
  if (!PUNTOS_DE_VENTA.includes(targetStore)) return next(httpError(400, PUNTO_DE_VENTA_ERROR))

  try {
    assertSameStore(req, targetStore)
  } catch (err) {
    return next(err)
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      email,
      password_hash: passwordHash,
      full_name,
      punto_de_venta: targetStore,
      created_by: req.admin.id
    })
    .select('id, email, full_name, punto_de_venta, is_active')
    .single()

  if (error) {
    if (isUniqueViolation(error)) return next(httpError(409, 'A user with this email already exists'))
    return next(error)
  }

  res.status(201).json(user)
})

// PATCH /api/users/:id — update a usuario account. 404 when the target row
// exists but is outside the caller's store (D9 — a 403 there would confirm
// the row exists to another store's admin); 403 when the caller explicitly
// tries to move it to a different store than their own.
usersRouter.patch('/:id', async (req, res, next) => {
  const { id } = req.params
  const { full_name, is_active, punto_de_venta, password } = req.body ?? {}

  if (full_name === undefined && is_active === undefined && punto_de_venta === undefined && password === undefined) {
    return next(httpError(400, 'Provide at least one field to update'))
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return next(httpError(400, 'is_active must be a boolean'))
  }
  if (punto_de_venta !== undefined && !PUNTOS_DE_VENTA.includes(punto_de_venta)) {
    return next(httpError(400, PUNTO_DE_VENTA_ERROR))
  }
  // Same typing contract as POST, checked up front with the other body
  // validations: `null.length` used to throw a raw TypeError here (a crash,
  // not a 400) and a NUMBER bypassed the length gate before reaching
  // bcrypt.hash. full_name was not validated here at all, unlike POST.
  if (full_name !== undefined && (typeof full_name !== 'string' || full_name.trim().length === 0)) {
    return next(httpError(400, 'full_name must be a non-empty string'))
  }
  if (password !== undefined && (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH)) {
    return next(httpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`))
  }

  const { data: target, error: targetError } = await supabase
    .from('users')
    .select('id, punto_de_venta')
    .eq('id', id)
    .single()

  if (targetError || !target) return next(httpError(404, 'User not found'))

  if (req.admin.role !== 'superadmin' && target.punto_de_venta !== req.admin.punto_de_venta) {
    return next(httpError(404, 'User not found'))
  }

  if (punto_de_venta !== undefined) {
    try {
      assertSameStore(req, punto_de_venta)
    } catch (err) {
      return next(err)
    }
  }

  const updates = {}
  if (full_name !== undefined) updates.full_name = full_name
  if (is_active !== undefined) updates.is_active = is_active
  if (punto_de_venta !== undefined) updates.punto_de_venta = punto_de_venta
  if (password !== undefined) updates.password_hash = await bcrypt.hash(password, BCRYPT_COST)

  const { data: updated, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', id)
    .select('id, email, full_name, punto_de_venta, is_active')
    .single()

  // `.single()` over zero rows resolves as an error, not `{ data: null }` —
  // treat a race (the row vanished between the lookup above and this write)
  // the same as the not-found case rather than a raw 500.
  if (isNoRowsReturned(error) || (!error && !updated)) return next(httpError(404, 'User not found'))
  if (error) return next(error)

  res.json(updated)
})
