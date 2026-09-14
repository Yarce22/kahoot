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

// buildSearchFilter — renders `q` into a PostgREST `or` expression matching
// either name or email. Two layers of neutralization, applied IN ORDER, because
// the value lands inside a filter STRING, not a bound parameter:
//   1. `%` and `_` are LIKE metacharacters, and PostgREST additionally treats
//      `*` as an alias for `%` inside a like/ilike pattern — so a bare `%` or a
//      bare `*` turns the search into "match everything". They are ESCAPED with
//      `\` (Postgres LIKE's DEFAULT escape character, so no ESCAPE clause is
//      needed and PostgREST not exposing one does not matter), never deleted:
//      deleting `_` silently broke a legitimate search for `john_doe`. `\`
//      itself is escaped here too, so a user-typed backslash cannot smuggle in
//      an escape sequence of its own. Postgres matches `\<char>` literally for
//      ANY char, so this is safe for `*` as well; the only illegal form is a
//      pattern ENDING in the escape character, which cannot happen because the
//      term is always followed by the trailing `%`.
//   2. `,` separates the two branches of `or` and `"` terminates a quoted
//      value, so the term is wrapped in quotes with `\` and `"` escaped —
//      otherwise the search box could rewrite the filter expression itself.
//      This doubles the backslashes introduced by step 1; PostgREST collapses
//      them back to one before Postgres ever sees the pattern.
// Returns null when nothing searchable survives, so no filter is applied.
function buildSearchFilter(q) {
  if (typeof q !== 'string') return null
  const term = q.trim()
  if (term.length === 0) return null
  const wildcardSafe = term.replace(/[\\%_*]/g, (c) => `\\${c}`)
  const escaped = wildcardSafe.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `full_name.ilike."%${escaped}%",email.ilike."%${escaped}%"`
}

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.page_size, 10) || DEFAULT_PAGE_SIZE))
  return { page, pageSize }
}

// GET /api/users — store-scoped usuario list (spec: Non-superadmin Read
// Scoping). Paged server-side with `.range()` + `{ count: 'exact' }`: the
// previous "fetch everything, then slice in JS" approach silently inherited
// PostgREST's max-rows cap, so `total` reported the size of the truncated
// response rather than the real match count, and every page past the cap was
// unreachable no matter what `page` the caller asked for.
usersRouter.get('/', async (req, res, next) => {
  let effectiveStore
  try {
    // `|| undefined`: `?punto_de_venta=` (what an "All stores" <select> option
    // with value="" submits) is not nullish, so passing it through would read
    // as an EXPLICIT filter for the store literally named '' — zero rows for a
    // superadmin who asked for everything, and a spurious 403 for anyone else.
    effectiveStore = resolveStoreFilter(req, req.query.punto_de_venta || undefined)
  } catch (err) {
    return next(err)
  }

  // Validated as a literal before it can reach the query: `=== 'true'` read
  // EVERY other value — 'TRUE', '1', 'yes', a typo — as a filter for
  // is_active=false, the OPPOSITE of what the caller asked for, and answered
  // 200. Same contract the other filters in this namespace enforce.
  if (req.query.is_active !== undefined && req.query.is_active !== 'true' && req.query.is_active !== 'false') {
    return next(httpError(400, 'is_active must be true or false'))
  }

  const { page, pageSize } = parsePagination(req.query)
  const start = (page - 1) * pageSize

  let query = supabase
    .from('users')
    .select('id, email, full_name, punto_de_venta, is_active, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })

  query = applyStoreFilter(query, effectiveStore)
  if (req.query.is_active !== undefined) query = query.eq('is_active', req.query.is_active === 'true')

  const searchFilter = buildSearchFilter(req.query.q)
  if (searchFilter) query = query.or(searchFilter)

  // `.range` is inclusive on both ends, hence the -1.
  query = query.range(start, start + pageSize - 1)

  const { data, error, count } = await query
  if (error) return next(error)

  res.json({
    users: data ?? [],
    page,
    page_size: pageSize,
    total: count ?? 0
  })
})

// POST /api/users — create a usuario account (spec: Store-Scoped Usuario
// CRUD). An omitted punto_de_venta defaults to the caller's own store;
// assertSameStore blocks a non-superadmin from targeting another one.
usersRouter.post('/', async (req, res, next) => {
  const { email, password, full_name, punto_de_venta } = req.body ?? {}

  // Normalized before validation AND before insert: the DB's UNIQUE index and
  // the login lookup (routes/userAuth.js) are both case-sensitive, so storing
  // `Ana@X.com` creates a row that `ana@x.com` can never log into and that the
  // UNIQUE constraint will not recognize as a duplicate.
  if (typeof email !== 'string') return next(httpError(400, 'A valid email is required'))
  const normalizedEmail = email.trim().toLowerCase()
  if (!EMAIL_RE.test(normalizedEmail)) return next(httpError(400, 'A valid email is required'))
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
      email: normalizedEmail,
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

  // Same contract as the write-back below: `targetError || !target` could not
  // tell "no such user" apart from "the database itself failed", so a
  // connection drop or a permission error came back as a confident 404 — an
  // outage disguised as a routine answer.
  if (isNoRowsReturned(targetError) || (!targetError && !target)) return next(httpError(404, 'User not found'))
  if (targetError) return next(targetError)

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
