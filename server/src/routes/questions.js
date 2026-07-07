import { Router } from 'express'
import supabase from '../lib/supabase.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { authGate, ownerGate } from '../middleware/jwtGate.js'
import { httpError } from '../lib/httpError.js'

export const questionsRouter = Router()

const VALID_TYPES = ['open', 'closed', 'true_false']

function validateQuestionBody({ text, type, time_limit_seconds }) {
  if (!text) return 'text is required'
  if (!VALID_TYPES.includes(type)) return "type must be 'open', 'closed', or 'true_false'"
  if (
    time_limit_seconds === undefined ||
    time_limit_seconds < 5 ||
    time_limit_seconds > 120
  ) return 'time_limit_seconds must be between 5 and 120'
  return null
}

function validateOptions(options) {
  if (!Array.isArray(options) || options.length < 2) {
    return 'closed questions require at least 2 options'
  }
  const correctCount = options.filter(o => o.is_correct).length
  if (correctCount !== 1) return 'closed questions must have exactly one correct option'
  return null
}

// resolveQuizIdFromOption — answer_options has no quiz_id column; resolve
// via its parent question's quiz_id. Used for the /options/:id routes,
// which requireQuizOwner has no built-in 'option' resource for.
async function resolveQuizIdFromOption(req) {
  const { data: option, error } = await supabase
    .from('answer_options')
    .select('question_id')
    .eq('id', req.params.id)
    .single()
  if (error || !option) return null

  const { data: question, error: qError } = await supabase
    .from('questions')
    .select('quiz_id')
    .eq('id', option.question_id)
    .single()
  if (qError || !question) return null

  return question.quiz_id
}

// POST /api/quizzes/:id/questions
questionsRouter.post('/quizzes/:id/questions', requireAdmin, authGate, ownerGate(), async (req, res, next) => {
  const { id: quizId } = req.params
  const { text, type, time_limit_seconds, options, correct_answer } = req.body

  const validationError = validateQuestionBody({ text, type, time_limit_seconds })
  if (validationError) return next(httpError(400, validationError))

  if (type === 'closed') {
    const optionsError = validateOptions(options)
    if (optionsError) return next(httpError(422, optionsError))
  }

  if (type === 'true_false' && !['true', 'false'].includes(correct_answer)) {
    return next(httpError(422, "true_false questions require correct_answer: 'true' or 'false'"))
  }

  if (type === 'open' && !correct_answer?.trim()) {
    return next(httpError(422, 'open questions require a correct_answer'))
  }

  // Determine order_index
  const { data: maxRow, error: maxError } = await supabase
    .from('questions')
    .select('order_index')
    .eq('quiz_id', quizId)
    .order('order_index', { ascending: false })
    .limit(1)
    .single()

  const orderIndex = maxError || !maxRow ? 0 : maxRow.order_index + 1

  const { data: question, error: insertError } = await supabase
    .from('questions')
    .insert({ quiz_id: quizId, text, type, time_limit_seconds, order_index: orderIndex })
    .select('id')
    .single()

  if (insertError) return next(insertError)

  let optionRows = null

  if (type === 'closed') {
    optionRows = options.map(o => ({ question_id: question.id, text: o.text, is_correct: o.is_correct }))
  } else if (type === 'true_false') {
    optionRows = [
      { question_id: question.id, text: 'True', is_correct: correct_answer === 'true' },
      { question_id: question.id, text: 'False', is_correct: correct_answer === 'false' }
    ]
  } else if (type === 'open') {
    optionRows = [{ question_id: question.id, text: correct_answer.trim(), is_correct: true }]
  }

  if (optionRows) {
    const { error: optInsertError } = await supabase.from('answer_options').insert(optionRows)
    if (optInsertError) return next(optInsertError)
  }

  res.status(201).json({ questionId: question.id })
})

// PUT /api/questions/:id
questionsRouter.put('/questions/:id', requireAdmin, authGate, ownerGate({ resource: 'question' }), async (req, res, next) => {
  const { id } = req.params
  const { text, type, time_limit_seconds, order_index, options, correct_answer } = req.body

  const updates = {}
  if (text !== undefined) updates.text = text
  if (type !== undefined) {
    if (!VALID_TYPES.includes(type)) return next(httpError(400, "type must be 'open', 'closed', or 'true_false'"))
    updates.type = type
  }
  if (time_limit_seconds !== undefined) {
    if (time_limit_seconds < 5 || time_limit_seconds > 120) {
      return next(httpError(400, 'time_limit_seconds must be between 5 and 120'))
    }
    updates.time_limit_seconds = time_limit_seconds
  }
  if (order_index !== undefined) updates.order_index = order_index

  const { data: question, error: updateError } = await supabase
    .from('questions')
    .update(updates)
    .eq('id', id)
    .select('id, quiz_id, text, type, time_limit_seconds, order_index')
    .single()

  if (updateError || !question) return next(httpError(404, 'Question not found'))

  const effectiveType = updates.type ?? question.type

  if (effectiveType === 'closed' && options !== undefined) {
    const optionsError = validateOptions(options)
    if (optionsError) return next(httpError(422, optionsError))

    const { error: deleteError } = await supabase
      .from('answer_options')
      .delete()
      .eq('question_id', id)

    if (deleteError) return next(deleteError)

    const optionRows = options.map(o => ({
      question_id: id,
      text: o.text,
      is_correct: o.is_correct
    }))
    const { error: insertError } = await supabase.from('answer_options').insert(optionRows)
    if (insertError) return next(insertError)
  }

  if (effectiveType === 'true_false' && correct_answer !== undefined) {
    if (!['true', 'false'].includes(correct_answer)) {
      return next(httpError(422, "true_false questions require correct_answer: 'true' or 'false'"))
    }
    await supabase.from('answer_options').delete().eq('question_id', id)
    const { error: insertError } = await supabase.from('answer_options').insert([
      { question_id: id, text: 'True', is_correct: correct_answer === 'true' },
      { question_id: id, text: 'False', is_correct: correct_answer === 'false' }
    ])
    if (insertError) return next(insertError)
  }

  if (effectiveType === 'open' && correct_answer !== undefined) {
    if (!correct_answer?.trim()) {
      return next(httpError(422, 'open questions require a correct_answer'))
    }
    await supabase.from('answer_options').delete().eq('question_id', id)
    const { error: insertError } = await supabase.from('answer_options').insert([
      { question_id: id, text: correct_answer.trim(), is_correct: true }
    ])
    if (insertError) return next(insertError)
  }

  res.json(question)
})

// DELETE /api/questions/:id
questionsRouter.delete('/questions/:id', requireAdmin, authGate, ownerGate({ resource: 'question' }), async (req, res, next) => {
  const { id } = req.params

  // player_answers FK has no CASCADE in the DB — delete manually first
  await supabase.from('player_answers').delete().eq('question_id', id)

  const { error } = await supabase
    .from('questions')
    .delete()
    .eq('id', id)

  if (error) return next(error)

  res.status(204).end()
})

// POST /api/questions/:id/options
questionsRouter.post('/questions/:id/options', requireAdmin, authGate, ownerGate({ resource: 'question' }), async (req, res, next) => {
  const { id: questionId } = req.params
  const { text, is_correct } = req.body

  if (!text) return next(httpError(400, 'text is required'))
  if (typeof is_correct !== 'boolean') return next(httpError(400, 'is_correct must be a boolean'))

  const { data, error } = await supabase
    .from('answer_options')
    .insert({ question_id: questionId, text, is_correct })
    .select('id')
    .single()

  if (error) return next(error)

  res.status(201).json({ optionId: data.id })
})

// PUT /api/options/:id
questionsRouter.put('/options/:id', requireAdmin, authGate, ownerGate({ resolve: resolveQuizIdFromOption }), async (req, res, next) => {
  const { id } = req.params
  const { text, is_correct } = req.body

  const updates = {}
  if (text !== undefined) updates.text = text
  if (is_correct !== undefined) updates.is_correct = is_correct

  const { data, error } = await supabase
    .from('answer_options')
    .update(updates)
    .eq('id', id)
    .select('id, question_id, text, is_correct')
    .single()

  if (error || !data) return next(httpError(404, 'Option not found'))

  res.json(data)
})

// DELETE /api/options/:id
questionsRouter.delete('/options/:id', requireAdmin, authGate, ownerGate({ resolve: resolveQuizIdFromOption }), async (req, res, next) => {
  const { id } = req.params

  const { error } = await supabase
    .from('answer_options')
    .delete()
    .eq('id', id)

  if (error) return next(error)

  res.status(204).end()
})
