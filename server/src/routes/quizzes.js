import { Router } from 'express'
import { randomBytes } from 'crypto'
import supabase from '../lib/supabase.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { httpError } from '../lib/httpError.js'

export const quizzesRouter = Router()

// POST /api/quizzes — create quiz (no auth required in MVP)
quizzesRouter.post('/', requireAdmin, async (req, res, next) => {
  const { title, description } = req.body

  if (!title) return next(httpError(400, 'title is required'))
  if (title.length > 200) return next(httpError(400, 'title must be 200 characters or fewer'))

  const adminToken = randomBytes(32).toString('hex')

  const { data, error } = await supabase
    .from('quizzes')
    .insert({ title, description: description ?? null, admin_token: adminToken })
    .select('id')
    .single()

  if (error) return next(error)

  res.status(201).json({ quizId: data.id, adminToken })
})

// GET /api/quizzes — list all quizzes
quizzesRouter.get('/', requireAdmin, async (req, res, next) => {
  const { data, error } = await supabase
    .from('quizzes')
    .select('id, title, description, created_at')
    .order('created_at', { ascending: false })

  if (error) return next(error)

  res.json(data)
})

// GET /api/quizzes/:id — get quiz with questions and options
quizzesRouter.get('/:id', requireAdmin, async (req, res, next) => {
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

// PUT /api/quizzes/:id — update quiz
quizzesRouter.put('/:id', requireAdmin, async (req, res, next) => {
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
quizzesRouter.delete('/:id', requireAdmin, async (req, res, next) => {
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
