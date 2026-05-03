import { Router } from 'express'
import { randomInt } from 'crypto'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { httpError } from '../lib/httpError.js'
import supabase from '../lib/supabase.js'
import { activeGames } from '../runtime/activeGames.js'
import { getIO } from '../lib/io.js'

export const sessionsRouter = Router()

// POST /api/sessions — create a new game session (admin only)
sessionsRouter.post('/', requireAdmin, async (req, res, next) => {
  const { quizId } = req.body
  if (!quizId) return next(httpError(400, 'quizId is required'))

  // Verify quiz exists
  const { data: quiz, error: quizErr } = await supabase
    .from('quizzes')
    .select('id')
    .eq('id', quizId)
    .single()
  if (quizErr || !quiz) return next(httpError(404, 'Quiz not found'))

  // Generate PIN with retry on collision (partial unique index on active sessions)
  let pin, sessionId
  for (let attempt = 0; attempt < 10; attempt++) {
    pin = String(randomInt(100000, 1000000)) // 6 digits: 100000–999999
    const { data, error } = await supabase
      .from('game_sessions')
      .insert({ quiz_id: quizId, pin, status: 'lobby' })
      .select('id')
      .single()
    if (!error) { sessionId = data.id; break }
    if (!error?.message?.includes('sessions_pin_active_idx')) {
      return next(httpError(500, 'Failed to create session'))
    }
    pin = null
  }
  if (!pin) return next(httpError(503, 'Could not generate unique PIN, try again'))

  // Initialize in-memory game state (lobby phase)
  activeGames.set(pin, {
    sessionId,
    quizId,
    questions: [],
    currentQuestionIndex: -1,
    tickHandle: null,
    timeoutHandle: null,
    questionStartedAt: null,
    players: new Map(),
    answersReceived: new Set(),
    answerCounts: new Map()
  })

  res.status(201).json({ pin, sessionId })
})

// GET /api/sessions/:pin — validate PIN before joining (no auth required)
sessionsRouter.get('/:pin', async (req, res, next) => {
  const { pin } = req.params
  const { data, error } = await supabase
    .from('game_sessions')
    .select('id, status, quiz:quizzes(title)')
    .eq('pin', pin)
    .in('status', ['lobby', 'active'])
    .single()
  if (error || !data) return next(httpError(404, 'Session not found'))

  // Count players joined so far
  const { count } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', data.id)

  res.json({
    status: data.status,
    quizTitle: data.quiz?.title ?? '',
    playerCount: count ?? 0
  })
})

// POST /api/sessions/:pin/start — start the game (admin only)
sessionsRouter.post('/:pin/start', requireAdmin, async (req, res, next) => {
  const { pin } = req.params
  const game = activeGames.get(pin)
  if (!game) return next(httpError(404, 'Session not found'))
  if (game.currentQuestionIndex !== -1) return next(httpError(409, 'Game already started'))

  // Verify session is still lobby in DB
  const { data: session, error: sessionErr } = await supabase
    .from('game_sessions')
    .select('id, status')
    .eq('pin', pin)
    .single()
  if (sessionErr || !session) return next(httpError(404, 'Session not found'))
  if (session.status !== 'lobby') return next(httpError(409, 'Session is not in lobby state'))

  // Load questions with nested options
  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('id, text, type, time_limit_seconds, order_index, options:answer_options(id, text, is_correct)')
    .eq('quiz_id', game.quizId)
    .order('order_index')
  if (qErr) return next(httpError(500, 'Failed to load questions'))
  if (!questions?.length) return next(httpError(400, 'Quiz has no questions'))

  // Update DB status
  await supabase
    .from('game_sessions')
    .update({ status: 'active', started_at: new Date().toISOString() })
    .eq('pin', pin)

  // Update memory
  game.questions = questions

  // Notify all clients in the session room
  getIO().to(`session:${pin}`).emit('game-started', { totalQuestions: questions.length })

  res.json({ ok: true, totalQuestions: questions.length })
})

// GET /api/sessions/:pin/results — full player answers (admin only)
sessionsRouter.get('/:pin/results', requireAdmin, async (req, res, next) => {
  const { pin } = req.params

  const { data: session, error: sessionErr } = await supabase
    .from('game_sessions')
    .select('id, status, started_at, ended_at')
    .eq('pin', pin)
    .single()
  if (sessionErr || !session) return next(httpError(404, 'Session not found'))

  const { data: results, error } = await supabase
    .from('player_answers')
    .select(`
      id,
      answer_text,
      selected_option_id,
      answered_at,
      time_taken_ms,
      is_correct,
      player:players(id, nickname),
      question:questions(id, text, type)
    `)
    .eq('players.session_id', session.id)
    .not('player', 'is', null)

  if (error) return next(httpError(500, 'Failed to fetch results'))

  res.json({ sessionId: session.id, status: session.status, results: results ?? [] })
})
