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

  let query = supabase
    .from('quiz_attempts')
    .select('id, quiz_id, cycle, status, total_questions, correct_count, score_percent, started_at, submitted_at, quiz:quizzes(id, title), user:users!inner(id, full_name, email, punto_de_venta)')
    .order('started_at', { ascending: false })

  if (req.query.quiz_id) query = query.eq('quiz_id', req.query.quiz_id)
  if (req.query.user_id) query = query.eq('user_id', req.query.user_id)
  if (req.query.status) query = query.eq('status', req.query.status)
  if (req.query.cycle !== undefined) query = query.eq('cycle', Number(req.query.cycle))
  query = applyStoreFilter(query, effectiveStore, 'user.punto_de_venta')

  const { data, error } = await query
  if (error) return next(error)

  const all = data ?? []
  const { page, pageSize } = parsePagination(req.query)
  const start = (page - 1) * pageSize

  res.json({
    attempts: all.slice(start, start + pageSize).map(serializeAttemptRow),
    page,
    page_size: pageSize,
    total: all.length
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
