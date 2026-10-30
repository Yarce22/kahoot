import { Router } from 'express'
import supabase from '../lib/supabase.js'
import { requireJwtMode } from '../middleware/jwtGate.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireStoreScope, resolveStoreFilter, applyStoreFilter } from '../middleware/requireStoreScope.js'
import { toProgressRow, summarizeProgress } from '../domain/progress.js'

export const dashboardRouter = Router()

// Safety bound on the single un-paged read below (the client must not loop over
// pages). shortcut: rows past this are silently dropped — move to server-side
// aggregation (SQL view/RPC) if a scope ever approaches it.
const MAX_ROWS = 5000

// Same reasoning as assignmentsRouter: no legacy identity to fall back to.
dashboardRouter.use(requireJwtMode, requireAuth, requireStoreScope)

// GET /api/dashboard/progress — per-usuario completion progress for the
// caller's store scope. One query: attempts are embedded through the
// quiz_attempts.assignment_id FK rather than fetched through an `.in()` fan-out
// that would grow with the table.
dashboardRouter.get('/progress', async (req, res, next) => {
  let effectiveStore
  try {
    // `|| undefined`: an "All stores" <select> submits `?punto_de_venta=`.
    effectiveStore = resolveStoreFilter(req, req.query.punto_de_venta || undefined)
  } catch (err) {
    return next(err)
  }

  let query = supabase
    .from('quiz_assignments')
    .select('id, quiz_id, quiz:quizzes(title, due_at), status, cycle, user:users!inner(id, full_name, email, punto_de_venta), attempts:quiz_attempts(id, cycle, status, score_percent, submitted_at)')
    // Ordered so a MAX_ROWS truncation is deterministic and each user's quiz
    // list comes back in assignment order.
    .order('assigned_at', { ascending: true })
    .limit(MAX_ROWS)
  query = applyStoreFilter(query, effectiveStore, 'user.punto_de_venta')

  const { data, error } = await query
  if (error) return next(error)

  // Fail closed like GET /api/assignments: a row without its user cannot be
  // store-verified.
  const byUser = new Map()
  for (const a of (data ?? []).filter((r) => r.user)) {
    if (!byUser.has(a.user.id)) byUser.set(a.user.id, { user: a.user, quizzes: [] })
    byUser.get(a.user.id).quizzes.push({ ...toProgressRow(a), quizTitle: a.quiz?.title ?? null })
  }

  const users = [...byUser.values()]
    .map(({ user, quizzes }) => ({
      userId: user.id,
      fullName: user.full_name,
      email: user.email,
      puntoDeVenta: user.punto_de_venta,
      ...summarizeProgress(quizzes),
      quizzes
    }))
    .sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? ''))

  res.json({ users })
})
