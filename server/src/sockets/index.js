import he from 'he'

function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

function fuzzyMatch(submitted, correct) {
  const s = submitted.trim().toLowerCase()
  const c = correct.trim().toLowerCase()
  if (s === c) return true
  const threshold = Math.max(2, Math.floor(c.length * 0.2))
  return levenshtein(s, c) <= threshold
}
import supabase from '../lib/supabase.js'
import { getIO } from '../lib/io.js'
import { activeGames } from '../runtime/activeGames.js'
import { startQuestion, endQuestion, endGame } from '../domain/gameEngine.js'
import { hostAuthMiddleware } from './hostAuth.js'

export function registerSocketHandlers(io) {
  // Apply host auth check lazily — only sockets that provide adminToken get isHost=true
  // Player sockets provide no token and proceed normally
  io.use((socket, next) => {
    const token = socket.handshake.auth?.adminToken
    if (token) {
      hostAuthMiddleware(socket, next)
    } else {
      next()
    }
  })

  io.on('connection', (socket) => {
    // === PLAYER EVENTS ===
    socket.on('join-game', (data, ack) => handleJoinGame(socket, io, data, ack))
    socket.on('submit-answer', (data, ack) => handleSubmitAnswer(socket, data, ack))

    // === HOST EVENTS ===
    socket.on('host:join-session', (data, ack) => handleHostJoinSession(socket, data, ack))
    socket.on('next-question', (data) => handleNextQuestion(socket, io, data))
    socket.on('host:end-game', (data) => handleHostEndGame(socket, data))

    // === DISCONNECT ===
    socket.on('disconnect', () => handleDisconnect(socket, io))
  })
}

// ─── PLAYER: join-game ────────────────────────────────────────────────────────

async function handleJoinGame(socket, io, data, ack) {
  const { pin, nickname } = data ?? {}

  if (!pin || !nickname) {
    return ack?.({ error: 'VALIDATION_ERROR', message: 'pin and nickname are required' })
  }

  // Nickname length check (Task 7.3 pre-implemented)
  if (nickname.length > 30) {
    return ack?.({ error: 'VALIDATION_ERROR', message: 'Nickname too long (max 30 chars)' })
  }

  const game = activeGames.get(pin)
  if (!game) return ack?.({ error: 'SESSION_NOT_FOUND' })
  if (game.currentQuestionIndex !== -1) return ack?.({ error: 'SESSION_NOT_JOINABLE' })

  // Check nickname uniqueness in memory
  const taken = [...game.players.values()].some(p => p.nickname === nickname)
  if (taken) return ack?.({ error: 'NICKNAME_TAKEN' })

  // Sanitize nickname before storing/broadcasting (Task 7.2 pre-implemented)
  const safeName = he.escape(nickname)

  // Insert player to DB
  const { data: player, error } = await supabase
    .from('players')
    .insert({ session_id: game.sessionId, nickname: safeName })
    .select('id')
    .single()
  if (error) return ack?.({ error: 'SERVER_ERROR' })

  // Add to in-memory map
  game.players.set(socket.id, {
    playerId: player.id,
    nickname: safeName,
    score: 0,
    totalTimeMs: 0
  })

  // Join socket room
  socket.join(`session:${pin}`)
  socket.gamePin = pin

  // Broadcast to all in lobby
  io.to(`session:${pin}`).emit('player-joined', {
    nickname: safeName,
    playerCount: game.players.size
  })

  // Return full current player list so the joining client can populate its lobby
  const players = [...game.players.values()].map(p => ({ nickname: p.nickname }))
  ack?.({ playerId: player.id, sessionId: game.sessionId, players })
}

// ─── PLAYER: submit-answer ────────────────────────────────────────────────────

async function handleSubmitAnswer(socket, data, ack) {
  const { questionIndex, selectedOptionId: answerId, answerText } = data ?? {}
  const pin = socket.gamePin
  if (!pin) return ack?.({ error: 'SESSION_NOT_FOUND' })

  const game = activeGames.get(pin)
  if (!game) return ack?.({ error: 'SESSION_NOT_FOUND' })

  if (questionIndex !== game.currentQuestionIndex) return ack?.({ error: 'QUESTION_CLOSED' })

  const player = game.players.get(socket.id)
  if (!player) return ack?.({ error: 'PLAYER_NOT_FOUND' })

  if (game.answersReceived.has(player.playerId)) return ack?.({ error: 'ALREADY_ANSWERED' })

  if (!game.timeoutHandle && !game.tickHandle) return ack?.({ error: 'QUESTION_CLOSED' })

  // Answer text length check (Task 7.3 pre-implemented)
  if (answerText && answerText.length > 500) {
    return ack?.({ error: 'VALIDATION_ERROR', message: 'Answer too long (max 500 chars)' })
  }

  const timeTakenMs = Date.now() - game.questionStartedAt
  const question = game.questions[game.currentQuestionIndex]

  // Determine correctness
  let isCorrect = null
  let selectedOptionId = null
  if ((question.type === 'closed' || question.type === 'true_false') && answerId) {
    const option = question.options.find(o => o.id === answerId)
    isCorrect = option?.is_correct ?? false
    selectedOptionId = answerId
  } else if (question.type === 'open' && answerText) {
    const correctOption = question.options?.find(o => o.is_correct)
    if (correctOption) {
      isCorrect = fuzzyMatch(answerText, correctOption.text)
    }
  }

  if (isCorrect) {
    player.score += 1
    player.totalTimeMs += timeTakenMs
    if (!game.firstCorrectAnswered) {
      game.firstCorrectAnswered = true
      player.score += 1
    }
  }

  // Insert answer to DB
  const { error } = await supabase.from('player_answers').insert({
    player_id: player.playerId,
    question_id: question.id,
    answer_text: answerText ?? null,
    selected_option_id: selectedOptionId,
    answered_at: new Date().toISOString(),
    time_taken_ms: timeTakenMs,
    is_correct: isCorrect
  })
  if (error) return ack?.({ error: 'SERVER_ERROR' })

  if (answerId) {
    game.answerCounts.set(answerId, (game.answerCounts.get(answerId) ?? 0) + 1)
  }
  game.answersReceived.add(player.playerId)

  getIO().to(`session:${pin}`).emit('player-answered', { nickname: player.nickname })

  ack?.({ received: true })

  // Auto-end question if all players answered
  if (game.answersReceived.size >= game.players.size) {
    await endQuestion(pin)
  }
}

// ─── HOST: host:join-session ──────────────────────────────────────────────────

function handleHostJoinSession(socket, data, ack) {
  if (!socket.isHost) return ack?.({ error: 'UNAUTHORIZED' })
  const { pin } = data ?? {}
  if (!pin) return ack?.({ error: 'VALIDATION_ERROR' })
  const game = activeGames.get(pin)
  if (!game) return ack?.({ error: 'SESSION_NOT_FOUND' })

  // Leave previous session room if switching sessions
  if (socket.gamePin && socket.gamePin !== pin) {
    socket.leave(`session:${socket.gamePin}`)
  }

  socket.join(`session:${pin}`)
  socket.gamePin = pin

  const players = [...game.players.values()].map(p => ({ nickname: p.nickname }))
  ack?.({ ok: true, players })
}

// ─── HOST: next-question ──────────────────────────────────────────────────────

function handleNextQuestion(socket, io, data) {
  if (!socket.isHost) return socket.emit('error', { code: 'UNAUTHORIZED' })
  const { pin } = data ?? {}
  if (!pin) return socket.emit('error', { code: 'VALIDATION_ERROR' })

  const game = activeGames.get(pin)
  if (!game) return socket.emit('error', { code: 'SESSION_NOT_FOUND' })

  game.currentQuestionIndex++

  if (game.currentQuestionIndex >= game.questions.length) {
    endGame(pin)
  } else {
    startQuestion(pin)
  }
}

// ─── HOST: host:end-game ──────────────────────────────────────────────────────

function handleHostEndGame(socket, data) {
  if (!socket.isHost) return socket.emit('error', { code: 'UNAUTHORIZED' })
  const { pin } = data ?? {}
  const game = activeGames.get(pin)
  if (!game) return socket.emit('error', { code: 'SESSION_NOT_FOUND' })
  if (game.currentQuestionIndex === -1) return socket.emit('error', { code: 'SESSION_INVALID_TRANSITION' })
  endGame(pin)
}

// ─── DISCONNECT ───────────────────────────────────────────────────────────────

function handleDisconnect(socket, io) {
  const pin = socket.gamePin
  if (!pin) return

  const game = activeGames.get(pin)
  if (!game) return

  const player = game.players.get(socket.id)
  if (!player) return

  game.players.delete(socket.id)

  // Broadcast updated count (only meaningful in lobby; in active game just removes from map)
  io.to(`session:${pin}`).emit('player-left', {
    nickname: player.nickname,
    playerCount: game.players.size
  })
  // Do NOT delete from DB — answers stay intact
}
