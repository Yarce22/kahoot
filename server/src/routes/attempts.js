import { Router } from 'express'
import supabase from '../lib/supabase.js'
import { requireJwtMode } from '../middleware/jwtGate.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireStoreScope, resolveStoreFilter, applyStoreFilter } from '../middleware/requireStoreScope.js'
import { httpError } from '../lib/httpError.js'

export const attemptsRouter = Router()

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

// Mirrors quiz_attempts.status' CHECK constraint (migration 009). A value
// outside this set can only ever match zero rows, so it is a client error,
// not an empty result.
const ATTEMPT_STATUSES = ['in_progress', 'completed', 'expired']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Accepts the two shapes the client actually sends: a bare calendar day
// (YYYY-MM-DD, what an <input type="date"> submits) and a full ISO datetime.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/

// This namespace has no legacy identity to fall back to — store scoping is
// meaningless without a JWT admin identity (design D3/D4).
attemptsRouter.use(requireJwtMode, requireAuth, requireStoreScope)

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.page_size, 10) || DEFAULT_PAGE_SIZE))
  return { page, pageSize }
}

function serializeAttemptRow(a) {
  return {
    id: a.id,
    quiz: a.quiz ?? null,
    user: a.user
      ? { id: a.user.id, fullName: a.user.full_name, email: a.user.email, puntoDeVenta: a.user.punto_de_venta }
      : null,
    cycle: a.cycle,
    status: a.status,
    totalQuestions: a.total_questions,
    correctCount: a.correct_count,
    scorePercent: a.score_percent,
    startedAt: a.started_at,
    submittedAt: a.submitted_at
  }
}

// GET /api/attempts — admin-facing history, store-scoped via the joined
// user's punto_de_venta (D8: deliberately NOT owner_id — a store manager
// must see their staff's results on any quiz, including ones they don't
// own). spec: Filter by User and Punto de Venta.
attemptsRouter.get('/', async (req, res, next) => {
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

  // Filters are validated BEFORE they reach the query builder. Previously
  // every one of them was forwarded verbatim: `cycle=abc` became Number('abc')
  // = NaN inside .eq(), and quiz_id/user_id/status were never checked against
  // the UUID columns and CHECK enum they filter — so a malformed value
  // surfaced as a Postgres error (500) instead of a 400.
  if (req.query.quiz_id !== undefined && !UUID_RE.test(req.query.quiz_id)) {
    return next(httpError(400, 'quiz_id must be a UUID'))
  }
  if (req.query.user_id !== undefined && !UUID_RE.test(req.query.user_id)) {
    return next(httpError(400, 'user_id must be a UUID'))
  }
  if (req.query.status !== undefined && !ATTEMPT_STATUSES.includes(req.query.status)) {
    return next(httpError(400, `status must be one of: ${ATTEMPT_STATUSES.join(', ')}`))
  }

  let cycle
  if (req.query.cycle !== undefined) {
    cycle = Number(req.query.cycle)
    // Number('') is 0 and Number('abc') is NaN — Number.isInteger rejects the
    // latter, and the explicit emptiness check rejects the former, which would
    // otherwise silently become a filter for cycle 0.
    if (req.query.cycle === '' || !Number.isInteger(cycle)) {
      return next(httpError(400, 'cycle must be an integer'))
    }
  }

  // from/to bound started_at (route contract). Date.parse alone is NOT a
  // stand-in for what timestamptz accepts — it happily reads '5' and '0' as
  // years, so those passed the gate and then failed inside Postgres as a 500,
  // the exact outcome this check exists to prevent. The shape is pinned to
  // ISO 8601 first (date-only or full datetime, which is what the client
  // sends), then Date.parse rejects the shapes that are well-formed but not
  // real dates (2026-13-45). The NORMALIZED value is what reaches the query:
  // forwarding the raw string handed Postgres whatever the caller typed.
  const range = {}
  for (const key of ['from', 'to']) {
    const value = req.query[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || !ISO_DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
      return next(httpError(400, `${key} must be an ISO 8601 date`))
    }
    range[key] = new Date(value).toISOString()
  }

  const { page, pageSize } = parsePagination(req.query)
  const start = (page - 1) * pageSize

  // Paged server-side with `.range()` + `{ count: 'exact' }`: the previous
  // "fetch everything, then slice in JS" approach silently inherited
  // PostgREST's max-rows cap, so `total` reported the size of the truncated
  // response rather than the real match count, and every page past the cap was
  // unreachable no matter what `page` the caller asked for.
  let query = supabase
    .from('quiz_attempts')
    .select('id, quiz_id, cycle, status, total_questions, correct_count, score_percent, started_at, submitted_at, quiz:quizzes(id, title), user:users!inner(id, full_name, email, punto_de_venta)', { count: 'exact' })
    .order('started_at', { ascending: false })

  if (req.query.quiz_id) query = query.eq('quiz_id', req.query.quiz_id)
  if (req.query.user_id) query = query.eq('user_id', req.query.user_id)
  if (req.query.status) query = query.eq('status', req.query.status)
  if (cycle !== undefined) query = query.eq('cycle', cycle)
  if (range.from) query = query.gte('started_at', range.from)
  if (range.to) query = query.lte('started_at', range.to)
  query = applyStoreFilter(query, effectiveStore, 'user.punto_de_venta')

  // `.range` is inclusive on both ends, hence the -1.
  query = query.range(start, start + pageSize - 1)

  const { data, error, count } = await query
  if (error) return next(error)

  // Defense in depth behind the `!inner` embed above. `!inner` is what makes
  // the store filter EXCLUDE non-matching rows rather than return them with a
  // nulled user, so a row arriving here without a user means that embed is not
  // doing its job. Such a row's store cannot be verified, so it is dropped
  // rather than serialized as `user: null` — fail closed, not open.
  const verifiableRows = (data ?? []).filter((a) => a.user)

  res.json({
    attempts: verifiableRows.map(serializeAttemptRow),
    page,
    page_size: pageSize,
    total: count ?? 0
  })
})

// GET /api/attempts/:id — admins MAY see correct answers (same contract as
// GET /api/sessions/:pin/results). 404 (not 403) when the attempt exists
// but is outside the caller's store — a 403 would confirm the row exists
// to another store's admin (D9).
attemptsRouter.get('/:id', async (req, res, next) => {
  const { id } = req.params

  const { data: attempt, error } = await supabase
    .from('quiz_attempts')
    .select('id, quiz_id, cycle, status, total_questions, correct_count, score_percent, started_at, submitted_at, quiz:quizzes(id, title), user:users(id, full_name, email, punto_de_venta)')
    .eq('id', id)
    .single()

  if (error || !attempt) return next(httpError(404, 'Attempt not found'))

  if (req.admin.role !== 'superadmin' && attempt.user?.punto_de_venta !== req.admin.punto_de_venta) {
    return next(httpError(404, 'Attempt not found'))
  }

  const { data: answers, error: answersError } = await supabase
    .from('quiz_attempt_answers')
    .select('question_id, answer_text, selected_option_id, is_correct, question:questions(id, text, type)')
    .eq('attempt_id', id)

  if (answersError) return next(answersError)

  const rows = answers ?? []
  const questionIds = [...new Set(rows.map((a) => a.question_id))]
  let correctTextsByQuestion = {}

  if (questionIds.length > 0) {
    const { data: options, error: optionsError } = await supabase
      .from('answer_options')
      .select('id, question_id, text, is_correct')
      .in('question_id', questionIds)

    if (optionsError) return next(optionsError)

    for (const opt of options ?? []) {
      if (!opt.is_correct) continue
      if (!correctTextsByQuestion[opt.question_id]) correctTextsByQuestion[opt.question_id] = []
      correctTextsByQuestion[opt.question_id].push(opt.text)
    }
  }

  res.json({
    ...serializeAttemptRow(attempt),
    answers: rows.map((a) => ({
      questionId: a.question_id,
      questionText: a.question?.text ?? null,
      questionType: a.question?.type ?? null,
      answerText: a.answer_text,
      isCorrect: a.is_correct,
      correctAnswer: (correctTextsByQuestion[a.question_id] ?? []).join(', ') || null
    }))
  })
})
