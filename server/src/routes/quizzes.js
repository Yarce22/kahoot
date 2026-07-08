import { Router } from 'express'
import supabase from '../lib/supabase.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { authGate, ownerGate } from '../middleware/jwtGate.js'
import { resolveBootstrapAdminOwnerId } from '../lib/bootstrapAdmin.js'
import { httpError } from '../lib/httpError.js'

export const quizzesRouter = Router()

// POST /api/quizzes — create quiz.
// Ownership (owner_id) is mandatory after migration 002:
//   - AUTH_MODE=jwt: owner_id = req.admin.id (the authenticated admin)
//   - AUTH_MODE=legacy: owner_id = the bootstrap admin (single lookup),
//     since legacy requests carry no JWT identity.
quizzesRouter.post('/', requireAdmin, authGate, async (req, res, next) => {
  const { title, description } = req.body

  if (!title) return next(httpError(400, 'title is required'))
  if (title.length > 200) return next(httpError(400, 'title must be 200 characters or fewer'))

  let ownerId
  try {
    ownerId = process.env.AUTH_MODE === 'jwt' ? req.admin.id : await resolveBootstrapAdminOwnerId()
  } catch (err) {
    return next(err)
  }

  const { data, error } = await supabase
    .from('quizzes')
    .insert({ title, description: description ?? null, owner_id: ownerId })
    .select('id')
    .single()

  if (error) return next(error)

  res.status(201).json({ quizId: data.id })
})

// GET /api/quizzes — list quizzes.
// Under AUTH_MODE=jwt this is a per-admin list (owner_id = req.admin.id) —
// there is no "list all admins' quizzes" use case once identity exists.
// Under legacy there is no per-admin identity, so it keeps listing all.
quizzesRouter.get('/', requireAdmin, authGate, async (req, res, next) => {
  let query = supabase
    .from('quizzes')
    .select('id, title, description, created_at, questions(count), owner:admins(id, email)')
    .order('created_at', { ascending: false })

  // A superadmin lists every admin's quizzes; a plain admin only its own.
  // Legacy mode (no req.admin) keeps listing all.
  if (req.admin && req.admin.role !== 'superadmin') {
    query = query.eq('owner_id', req.admin.id)
  }

  const { data, error } = await query

  if (error) return next(error)

  // questions(count) comes back as a nested aggregate array: [{ count: N }].
  // Flatten it to a plain questionCount and drop the nested array so the
  // list shape stays clean for the client. owner is surfaced so the
  // superadmin UI can show whose quiz each one is.
  const quizzes = (data ?? []).map(({ questions, owner, ...quiz }) => ({
    ...quiz,
    questionCount: questions?.[0]?.count ?? 0,
    owner: owner ?? null
  }))

  res.json(quizzes)
})

// GET /api/quizzes/:id — get quiz with questions and options
quizzesRouter.get('/:id', requireAdmin, authGate, ownerGate(), async (req, res, next) => {
  const { id } = req.params

  const { data: quiz, error: quizError } = await supabase
    .from('quizzes')
    .select('id, title, description')
    .eq('id', id)
    .single()

  if (quizError || !quiz) return next(httpError(404, 'Quiz not found'))

  const { data: questions, error: questionsError } = await supabase
    .from('questions')
    .select('id, text, type, time_limit_seconds, order_index')
    .eq('quiz_id', id)
    .order('order_index', { ascending: true })

  if (questionsError) return next(questionsError)

  const questionIds = questions.map(q => q.id)
  let optionsByQuestion = {}

  if (questionIds.length > 0) {
    const { data: options, error: optionsError } = await supabase
      .from('answer_options')
      .select('id, question_id, text, is_correct')
      .in('question_id', questionIds)

    if (optionsError) return next(optionsError)

    for (const opt of options) {
      if (!optionsByQuestion[opt.question_id]) optionsByQuestion[opt.question_id] = []
      optionsByQuestion[opt.question_id].push({ id: opt.id, text: opt.text, is_correct: opt.is_correct })
    }
  }

  const result = {
    ...quiz,
    questions: questions.map(q => ({
      ...q,
      options: optionsByQuestion[q.id] ?? []
    }))
  }

  res.json(result)
})

// GET /api/quizzes/:id/sessions — session history for a quiz (admin only,
// must own the quiz). Lists finished sessions newest-first, each with its
// player count, so the admin can revisit past games and open their results.
quizzesRouter.get('/:id/sessions', requireAdmin, authGate, ownerGate(), async (req, res, next) => {
  const { id } = req.params

  const { data, error } = await supabase
    .from('game_sessions')
    .select('id, pin, status, started_at, ended_at, created_at, players(count)')
    .eq('quiz_id', id)
    .eq('status', 'finished')
    .order('created_at', { ascending: false })

  if (error) return next(httpError(500, 'Failed to fetch sessions'))

  const sessions = (data ?? []).map(s => ({
    id: s.id,
    pin: s.pin,
    status: s.status,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    createdAt: s.created_at,
    // players(count) comes back as a nested aggregate array: [{ count: N }].
    playerCount: s.players?.[0]?.count ?? 0
  }))

  res.json({ sessions })
})

// PUT /api/quizzes/:id — update quiz
quizzesRouter.put('/:id', requireAdmin, authGate, ownerGate(), async (req, res, next) => {
  const { id } = req.params
  const { title, description } = req.body

  const updates = {}
  if (title !== undefined) {
    if (title.length > 200) return next(httpError(400, 'title must be 200 characters or fewer'))
    updates.title = title
  }
  if (description !== undefined) updates.description = description

  const { data, error } = await supabase
    .from('quizzes')
    .update(updates)
    .eq('id', id)
    .select('id, title, description, created_at')
    .single()

  if (error || !data) return next(httpError(404, 'Quiz not found'))

  res.json(data)
})

// DELETE /api/quizzes/:id — delete quiz
quizzesRouter.delete('/:id', requireAdmin, authGate, ownerGate(), async (req, res, next) => {
  const { id } = req.params

  const { data: activeSessions, error: sessionError } = await supabase
    .from('game_sessions')
    .select('id')
    .eq('quiz_id', id)
    .in('status', ['lobby', 'active'])
    .limit(1)

  if (sessionError) return next(sessionError)
  if (activeSessions && activeSessions.length > 0) {
    return next(httpError(409, 'Quiz has active sessions'))
  }

  const { error } = await supabase
    .from('quizzes')
    .delete()
    .eq('id', id)

  if (error) return next(error)

  res.status(204).end()
})
