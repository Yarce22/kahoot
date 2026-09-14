import { Router } from 'express'
import supabase from '../lib/supabase.js'
import { requireJwtMode } from '../middleware/jwtGate.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireStoreScope, resolveStoreFilter, applyStoreFilter } from '../middleware/requireStoreScope.js'
import { httpError } from '../lib/httpError.js'
import { isNoRowsReturned } from '../lib/pgErrors.js'

export const assignmentsRouter = Router()

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 25
// Doubles as the bound on the attempt-status `.in()` fan-out in GET / — the id
// set handed to that lookup is exactly one page of assignment ids, so it can
// never exceed this.
const MAX_PAGE_SIZE = 100

// Mirrors quiz_assignments.status' CHECK constraint (migration 009) — note it
// is NOT the same set as quiz_attempts.status. A value outside it can only
// ever match zero rows, so it is a client error, not an empty result.
const ASSIGNMENT_STATUSES = ['pending', 'completed']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value)

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.page_size, 10) || DEFAULT_PAGE_SIZE))
  return { page, pageSize }
}

// This namespace has no legacy identity to fall back to — store scoping is
// meaningless without a JWT admin identity (design D3/D4).
assignmentsRouter.use(requireJwtMode, requireAuth, requireStoreScope)

// isQuizOwner — superadmins bypass ownership entirely, same rule as
// requireQuizOwner.js. Kept inline (rather than chaining that middleware)
// because this router needs the SAME quiz row for total_time_seconds and
// assignment_cycle right after the ownership check.
function isQuizOwner(admin, quiz) {
  return admin.role === 'superadmin' || quiz.owner_id === admin.id
}

// POST /api/assignments — bulk-assign a quiz to usuarios (spec: Same-Store-
// Only Assignment for Non-Superadmin). All-or-nothing on the store check:
// if ANY target user is outside the caller's store, nothing is created.
assignmentsRouter.post('/', async (req, res, next) => {
  const { quiz_id, user_ids } = req.body ?? {}

  if (!quiz_id) return next(httpError(400, 'quiz_id is required'))
  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    return next(httpError(400, 'user_ids must be a non-empty array'))
  }
  // Bounded by the same page cap the rest of this router uses, and bounded
  // BEFORE the round trip: user_ids feeds `.in('id', user_ids)`, which
  // supabase-js renders as a GET query STRING, so a few hundred UUIDs blow
  // past gateway/PostgREST URL length limits and come back as an uncontrolled
  // 500 instead of a controlled 400.
  if (user_ids.length > MAX_PAGE_SIZE) {
    return next(httpError(400, `user_ids must not exceed ${MAX_PAGE_SIZE} items`))
  }
  // UUID-shaped, not merely "a non-empty string": user_ids filter a uuid
  // column, so 'not-a-uuid' reaches Postgres as an uncastable literal (22P02)
  // and surfaces as an uncontrolled 500 instead of a 400. Same contract the
  // GET / quiz_id/user_id filters already enforce.
  if (!user_ids.every(isUuid)) {
    return next(httpError(400, 'user_ids must be an array of UUIDs'))
  }

  const { data: quiz, error: quizError } = await supabase
    .from('quizzes')
    .select('id, owner_id, total_time_seconds, assignment_cycle')
    .eq('id', quiz_id)
    .single()

  // `quizError || !quiz` could not tell "no such quiz" apart from "the database
  // itself failed", so a connection drop or a permission error came back as a
  // confident 404 — an outage disguised as a routine answer. Only PostgREST's
  // no-rows signal means not found; anything else propagates. Same contract at
  // every `.single()` lookup in this router.
  if (isNoRowsReturned(quizError) || (!quizError && !quiz)) return next(httpError(404, 'Quiz not found'))
  if (quizError) return next(quizError)
  if (!isQuizOwner(req.admin, quiz)) return next(httpError(403, 'Not the quiz owner'))
  if (quiz.total_time_seconds === null) return next(httpError(409, 'QUIZ_NOT_ASSIGNABLE'))

  const { data: targetUsers, error: usersError } = await supabase
    .from('users')
    .select('id, punto_de_venta')
    .in('id', user_ids)

  if (usersError) return next(usersError)

  const resolvedUsers = targetUsers ?? []

  // Store scoping is applied BEFORE the existence check, not after it, and
  // both failures collapse into the SAME 404 (spec: Same-Store-Only
  // Assignment, all-or-nothing). Reporting a distinct 403 for "this id lives
  // in another store" turned the endpoint into an existence oracle: a plain
  // admin could probe arbitrary UUIDs and learn which ones are real users in
  // stores they cannot otherwise see — precisely what D9 forbids, and what
  // DELETE /:id below and PATCH /api/users/:id already avoid by answering 404
  // for an out-of-store row. A superadmin has no cross-store boundary to hide,
  // so for them this is purely the existence check.
  //
  // Every requested id MUST resolve to a VISIBLE row before anything is
  // written. Without that, an id that matched no user was invisible to the
  // store guard (which only inspects what the DB returned) yet still reached
  // the write — a cross-store check bypassed by a typo.
  const visibleUsers = req.admin.role === 'superadmin'
    ? resolvedUsers
    : resolvedUsers.filter((u) => u.punto_de_venta === req.admin.punto_de_venta)

  if (visibleUsers.length !== new Set(user_ids).size) {
    return next(httpError(404, 'One or more user_ids do not exist'))
  }

  // ONE upsert, not a per-row insert loop. A loop meant a mid-batch failure
  // (a concurrent delete of a target user, say) left every row written before
  // it durably committed while the caller was told the whole request failed.
  // `ignoreDuplicates` makes Postgres SKIP a row that hits the (quiz_id,
  // user_id) unique constraint from migration 009 instead of erroring on it,
  // so a real conflict and a hard failure stay distinguishable: a conflict
  // yields fewer returned rows, anything else yields `error`. Built from the
  // VERIFIED rows, never the raw request body — only ids that survived the
  // existence and store checks above can ever be written (and a duplicated id
  // collapses to one row for free).
  const rows = visibleUsers.map(({ id: userId }) => ({
    quiz_id,
    user_id: userId,
    cycle: quiz.assignment_cycle,
    assigned_by: req.admin.id
  }))

  const { data, error } = await supabase
    .from('quiz_assignments')
    .upsert(rows, { onConflict: 'quiz_id,user_id', ignoreDuplicates: true })
    .select('id, user_id')

  if (error) return next(error)

  const createdRows = data ?? []
  const createdUserIds = new Set(createdRows.map((row) => row.user_id))
  const created = createdRows.map((row) => ({ id: row.id, userId: row.user_id }))
  const skipped = visibleUsers
    .filter(({ id: userId }) => !createdUserIds.has(userId))
    .map(({ id: userId }) => ({ userId, reason: 'already_assigned' }))

  res.status(201).json({ created, skipped })
})

// GET /api/assignments — store-scoped list, filtered through the user's
// punto_de_venta (D8: the assignment row itself carries no store column).
assignmentsRouter.get('/', async (req, res, next) => {
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

  // Same contract as GET /api/attempts: quiz_id/user_id filter UUID columns
  // and status filters a CHECK enum, so a malformed value is a 400 here
  // rather than a Postgres error surfacing as a 500.
  if (req.query.quiz_id !== undefined && !UUID_RE.test(req.query.quiz_id)) {
    return next(httpError(400, 'quiz_id must be a UUID'))
  }
  if (req.query.user_id !== undefined && !UUID_RE.test(req.query.user_id)) {
    return next(httpError(400, 'user_id must be a UUID'))
  }
  if (req.query.status !== undefined && !ASSIGNMENT_STATUSES.includes(req.query.status)) {
    return next(httpError(400, `status must be one of: ${ASSIGNMENT_STATUSES.join(', ')}`))
  }

  const { page, pageSize } = parsePagination(req.query)
  const start = (page - 1) * pageSize

  // Paged server-side with `.range()` + `{ count: 'exact' }`. Beyond the usual
  // unbounded-list concern, this list FEEDS the `.in('assignment_id', ...)`
  // lookup below — without a page bound that fan-out grew with the table.
  let query = supabase
    .from('quiz_assignments')
    .select('id, quiz_id, quiz:quizzes(title), status, cycle, assigned_at, completed_at, user:users!inner(id, full_name, email, punto_de_venta)', { count: 'exact' })
    .order('assigned_at', { ascending: false })

  if (req.query.quiz_id) query = query.eq('quiz_id', req.query.quiz_id)
  if (req.query.user_id) query = query.eq('user_id', req.query.user_id)
  if (req.query.status) query = query.eq('status', req.query.status)
  query = applyStoreFilter(query, effectiveStore, 'user.punto_de_venta')

  // `.range` is inclusive on both ends, hence the -1.
  query = query.range(start, start + pageSize - 1)

  const { data: assignments, error, count } = await query
  if (error) return next(error)

  // Defense in depth behind the `!inner` embed above. `!inner` is what makes
  // the store filter EXCLUDE non-matching rows rather than return them with a
  // nulled user, so a row arriving here without a user means that embed is not
  // doing its job. Such a row's store cannot be verified, so it is dropped
  // rather than serialized as `user: null` — fail closed, not open. Filtered
  // BEFORE assignmentIds so a dropped row cannot leak into the fan-out either.
  const rows = (assignments ?? []).filter((a) => a.user)
  const assignmentIds = rows.map((a) => a.id)

  // attemptStatus — the CURRENT-cycle attempt only (an older cycle's
  // attempt belongs to that cycle's history, not this row's live state).
  let attemptStatusByKey = {}
  if (assignmentIds.length) {
    const { data: attempts, error: attemptsError } = await supabase
      .from('quiz_attempts')
      .select('assignment_id, cycle, status')
      .in('assignment_id', assignmentIds)

    if (attemptsError) return next(attemptsError)

    for (const attempt of attempts ?? []) {
      attemptStatusByKey[`${attempt.assignment_id}:${attempt.cycle}`] = attempt.status
    }
  }

  res.json({
    assignments: rows.map((a) => ({
      id: a.id,
      quizId: a.quiz_id,
      quizTitle: a.quiz?.title ?? null,
      user: a.user
        ? { id: a.user.id, fullName: a.user.full_name, email: a.user.email, puntoDeVenta: a.user.punto_de_venta }
        : null,
      status: a.status,
      cycle: a.cycle,
      assignedAt: a.assigned_at,
      completedAt: a.completed_at,
      attemptStatus: attemptStatusByKey[`${a.id}:${a.cycle}`] ?? null
    })),
    page,
    page_size: pageSize,
    total: count ?? 0
  })
})

// DELETE /api/assignments/:id — unassign. An assignment that was ever
// attempted cannot be removed (the FK cascade would destroy the attempt
// history requirement #9 depends on) — 409 ASSIGNMENT_HAS_ATTEMPTS instead.
assignmentsRouter.delete('/:id', async (req, res, next) => {
  const { id } = req.params

  const { data: assignment, error } = await supabase
    .from('quiz_assignments')
    .select('id, quiz_id, user:users(punto_de_venta), quiz:quizzes(id, owner_id)')
    .eq('id', id)
    .single()

  if (isNoRowsReturned(error) || (!error && !assignment)) return next(httpError(404, 'Assignment not found'))
  if (error) return next(error)

  if (req.admin.role !== 'superadmin' && assignment.user?.punto_de_venta !== req.admin.punto_de_venta) {
    return next(httpError(404, 'Assignment not found'))
  }

  // Ownership is checked here for the same reason POST / checks it: without
  // it the boundary is one-directional — a plain admin forbidden from
  // ASSIGNING a quiz they don't own could still UNassign it, as long as the
  // target user happened to be in their store. The owner_id is embedded in
  // the lookup above rather than fetched separately: one round trip, and the
  // 404-before-403 order keeps D9's enumeration guard intact.
  if (!assignment.quiz || !isQuizOwner(req.admin, assignment.quiz)) {
    return next(httpError(403, 'Not the quiz owner'))
  }

  const { data: attempts, error: attemptsError } = await supabase
    .from('quiz_attempts')
    .select('id')
    .eq('assignment_id', id)
    .limit(1)

  if (attemptsError) return next(attemptsError)
  if (attempts && attempts.length > 0) return next(httpError(409, 'ASSIGNMENT_HAS_ATTEMPTS'))

  const { error: deleteError } = await supabase
    .from('quiz_assignments')
    .delete()
    .eq('id', id)

  if (deleteError) return next(deleteError)

  res.status(204).end()
})

// POST /api/assignments/reactivate — bump the quiz's assignment cycle via
// the advisory-locked RPC (design D6). scope_punto_de_venta=null lets a
// superadmin reactivate every store's assignments on the quiz; a
// non-superadmin is always scoped to their own store, even for a quiz that
// also carries cross-store assignments a superadmin created.
assignmentsRouter.post('/reactivate', async (req, res, next) => {
  const { quiz_id, user_ids } = req.body ?? {}

  if (!quiz_id) return next(httpError(400, 'quiz_id is required'))

  // user_ids stays OPTIONAL (omitted/null = every assignment on the quiz),
  // but when supplied it must be a non-empty array of UUIDs — the same
  // contract POST / enforces, and the RPC's target_user_ids parameter is
  // uuid[], so a non-UUID string is a 22P02 cast error (an uncontrolled 500),
  // not a zero-match run. Validated BEFORE the RPC because the RPC bumps
  // quizzes.assignment_cycle unconditionally, before it matches any row: a
  // request that could never match anything would still advance the cycle.
  const hasUserIds = user_ids !== undefined && user_ids !== null
  if (hasUserIds) {
    const isValid = Array.isArray(user_ids) && user_ids.length > 0 && user_ids.every(isUuid)
    if (!isValid) return next(httpError(400, 'user_ids must be a non-empty array of UUIDs'))
  }

  const { data: quiz, error: quizError } = await supabase
    .from('quizzes')
    .select('id, owner_id')
    .eq('id', quiz_id)
    .single()

  if (isNoRowsReturned(quizError) || (!quizError && !quiz)) return next(httpError(404, 'Quiz not found'))
  if (quizError) return next(quizError)
  if (!isQuizOwner(req.admin, quiz)) return next(httpError(403, 'Not the quiz owner'))

  const { data, error } = await supabase.rpc('reactivate_quiz_assignments', {
    target_quiz_id: quiz_id,
    target_user_ids: hasUserIds ? user_ids : null,
    scope_punto_de_venta: req.admin.role === 'superadmin' ? null : req.admin.punto_de_venta
  })

  if (error) {
    const text = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`
    if (text.includes('quiz_not_found')) return next(httpError(404, 'Quiz not found'))
    return next(error)
  }

  const rows = data ?? []

  // Zero matched rows does NOT mean "nothing happened": the RPC already bumped
  // assignment_cycle before filtering. Reporting `cycle: null` here told the
  // caller the opposite of what the database now holds, so read the real value
  // back instead. A failed read-back degrades to null rather than turning a
  // successful reactivation into a 500.
  let cycle = rows[0]?.new_cycle ?? null
  if (rows.length === 0) {
    const { data: bumped } = await supabase
      .from('quizzes')
      .select('assignment_cycle')
      .eq('id', quiz_id)
      .single()
    cycle = bumped?.assignment_cycle ?? null
  }

  res.json({ reactivated: rows.length, cycle })
})
