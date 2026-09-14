import { Router } from 'express'
import supabase from '../lib/supabase.js'
import { requireJwtMode } from '../middleware/jwtGate.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireStoreScope, resolveStoreFilter, applyStoreFilter } from '../middleware/requireStoreScope.js'
import { httpError } from '../lib/httpError.js'
import { isUniqueViolation } from '../lib/pgErrors.js'

export const assignmentsRouter = Router()

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

  const { data: quiz, error: quizError } = await supabase
    .from('quizzes')
    .select('id, owner_id, total_time_seconds, assignment_cycle')
    .eq('id', quiz_id)
    .single()

  if (quizError || !quiz) return next(httpError(404, 'Quiz not found'))
  if (!isQuizOwner(req.admin, quiz)) return next(httpError(403, 'Not the quiz owner'))
  if (quiz.total_time_seconds === null) return next(httpError(409, 'QUIZ_NOT_ASSIGNABLE'))

  const { data: targetUsers, error: usersError } = await supabase
    .from('users')
    .select('id, punto_de_venta')
    .in('id', user_ids)

  if (usersError) return next(usersError)

  if (req.admin.role !== 'superadmin') {
    const hasCrossStoreTarget = (targetUsers ?? []).some((u) => u.punto_de_venta !== req.admin.punto_de_venta)
    if (hasCrossStoreTarget) return next(httpError(403, 'CROSS_STORE_ASSIGNMENT_FORBIDDEN'))
  }

  const created = []
  const skipped = []

  // Per-row insert (not a single bulk insert) so ONE conflicting row can be
  // skipped without failing the rest of the batch — supabase-js has no
  // per-row ON CONFLICT reporting from a single multi-row insert call.
  for (const userId of user_ids) {
    const { data: row, error } = await supabase
      .from('quiz_assignments')
      .insert({ quiz_id, user_id: userId, cycle: quiz.assignment_cycle, assigned_by: req.admin.id })
      .select('id, user_id')
      .single()

    if (error) {
      if (isUniqueViolation(error)) {
        skipped.push({ userId, reason: 'already_assigned' })
        continue
      }
      return next(error)
    }

    created.push({ id: row.id, userId: row.user_id })
  }

  res.status(201).json({ created, skipped })
})

// GET /api/assignments — store-scoped list, filtered through the user's
// punto_de_venta (D8: the assignment row itself carries no store column).
assignmentsRouter.get('/', async (req, res, next) => {
  let effectiveStore
  try {
    effectiveStore = resolveStoreFilter(req, req.query.punto_de_venta)
  } catch (err) {
    return next(err)
  }

  let query = supabase
    .from('quiz_assignments')
    .select('id, quiz_id, quiz:quizzes(title), status, cycle, assigned_at, completed_at, user:users!inner(id, full_name, email, punto_de_venta)')
    .order('assigned_at', { ascending: false })

  if (req.query.quiz_id) query = query.eq('quiz_id', req.query.quiz_id)
  if (req.query.user_id) query = query.eq('user_id', req.query.user_id)
  if (req.query.status) query = query.eq('status', req.query.status)
  query = applyStoreFilter(query, effectiveStore, 'user.punto_de_venta')

  const { data: assignments, error } = await query
  if (error) return next(error)

  const rows = assignments ?? []
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
    }))
  })
})

// DELETE /api/assignments/:id — unassign. An assignment that was ever
// attempted cannot be removed (the FK cascade would destroy the attempt
// history requirement #9 depends on) — 409 ASSIGNMENT_HAS_ATTEMPTS instead.
assignmentsRouter.delete('/:id', async (req, res, next) => {
  const { id } = req.params

  const { data: assignment, error } = await supabase
    .from('quiz_assignments')
    .select('id, quiz_id, user:users(punto_de_venta)')
    .eq('id', id)
    .single()

  if (error || !assignment) return next(httpError(404, 'Assignment not found'))

  if (req.admin.role !== 'superadmin' && assignment.user?.punto_de_venta !== req.admin.punto_de_venta) {
    return next(httpError(404, 'Assignment not found'))
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

  const { data: quiz, error: quizError } = await supabase
    .from('quizzes')
    .select('id, owner_id')
    .eq('id', quiz_id)
    .single()

  if (quizError || !quiz) return next(httpError(404, 'Quiz not found'))
  if (!isQuizOwner(req.admin, quiz)) return next(httpError(403, 'Not the quiz owner'))

  const { data, error } = await supabase.rpc('reactivate_quiz_assignments', {
    target_quiz_id: quiz_id,
    target_user_ids: user_ids ?? null,
    scope_punto_de_venta: req.admin.role === 'superadmin' ? null : req.admin.punto_de_venta
  })

  if (error) {
    const text = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`
    if (text.includes('quiz_not_found')) return next(httpError(404, 'Quiz not found'))
    return next(error)
  }

  const rows = data ?? []
  res.json({ reactivated: rows.length, cycle: rows[0]?.new_cycle ?? null })
})
