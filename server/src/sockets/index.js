import he from 'he'
import supabase from '../lib/supabase.js'
import { getIO } from '../lib/io.js'
import { activeGames } from '../runtime/activeGames.js'
import { startQuestion, endQuestion, endGame } from '../domain/gameEngine.js'
import { matchOpenAnswer } from '../domain/openAnswer.js'
import { evaluateMultipleAnswer } from '../domain/multipleChoice.js'
import { hostAuthMiddleware, jwtHostAuthMiddleware } from './hostAuth.js'

// HOST_DISCONNECT_GRACE_MS — how long a session waits, after its last host
// socket disconnects, before auto-ending via endGame(pin). Overridable via
// env var (same `env-var || default` shape as PORT in src/index.js) so
// tests can shrink it instead of waiting 5 real minutes; read once at
// module load, so tests must set the env var BEFORE importing this module
// (transitively, via ../src/index.js) — see socket.hostDisconnect.test.js.
const HOST_DISCONNECT_GRACE_MS = Number(process.env.HOST_DISCONNECT_GRACE_MS) || 5 * 60 * 1000

export function registerSocketHandlers(io) {
  // Apply host auth check lazily — only sockets that provide a token
  // (jwt `auth.token` or legacy `auth.adminToken`) get isHost=true.
  // Player sockets provide neither and proceed normally.
  io.use((socket, next) => {
    const jwtToken = socket.handshake.auth?.token
    const legacyToken = socket.handshake.auth?.adminToken

    // Symmetric gating: a jwt `auth.token` handshake is only accepted under
    // AUTH_MODE=jwt, exactly like the legacy `adminToken` handshake is only
    // accepted under legacy mode. Under legacy, presenting a JWT must NOT
    // grant host status — it falls through to the anonymous/next() path.
    if (jwtToken && process.env.AUTH_MODE === 'jwt') {
      jwtHostAuthMiddleware(socket, next)
    } else if (legacyToken && process.env.AUTH_MODE !== 'jwt') {
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
  const { questionIndex, selectedOptionId: answerId, selectedOptionIds, answerText } = data ?? {}
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
  // For 'multiple', the FK selected_option_id can't hold several ids, so the
  // player's picks are stored as comma-joined option texts in answer_text.
  let recordedAnswerText = answerText ?? null
  // Track the option ids to tally into answerStats (one id for single-choice,
  // the whole set for 'multiple').
  let countedOptionIds = answerId ? [answerId] : []

  if ((question.type === 'closed' || question.type === 'true_false') && answerId) {
    const option = question.options.find(o => o.id === answerId)
    isCorrect = option?.is_correct ?? false
    selectedOptionId = answerId
  } else if (question.type === 'multiple') {
    // All-or-nothing: the set of picked options must match the correct set
    // exactly — no missing correct, no extra incorrect.
    const { picked, isCorrect: multiCorrect } = evaluateMultipleAnswer(
      question.options,
      selectedOptionIds ?? []
    )
    isCorrect = multiCorrect
    countedOptionIds = picked
    recordedAnswerText = picked.length
      ? question.options.filter(o => picked.includes(o.id)).map(o => o.text).join(', ')
      : null
  } else if (question.type === 'open' && answerText) {
    // The correct option's text holds the comma-separated required keywords.
    const correctOption = question.options?.find(o => o.is_correct)
    if (correctOption) {
      isCorrect = matchOpenAnswer(answerText, correctOption.text)
    }
  }

  // Accumulate answer time on EVERY submission, not only correct ones: the
  // leaderboard tie-break is cumulative answer time (faster wins), so it must
  // reflect how long the player took overall, regardless of correctness.
  player.totalTimeMs += timeTakenMs

  if (isCorrect) {
    player.score += 1
    if (!game.firstCorrectAnswered) {
      game.firstCorrectAnswered = true
      player.score += 1
    }
  }

  // Insert answer to DB
  const { error } = await supabase.from('player_answers').insert({
    player_id: player.playerId,
    question_id: question.id,
    answer_text: recordedAnswerText,
    selected_option_id: selectedOptionId,
    answered_at: new Date().toISOString(),
    time_taken_ms: timeTakenMs,
    is_correct: isCorrect
  })
  if (error) return ack?.({ error: 'SERVER_ERROR' })

  // Persist the running score/time immediately, not only at endGame. Scores
  // live in the volatile in-memory game.players map; if a player disconnects
  // before the host ends the game (common: players close their tab after the
  // last question), endGame would flush nothing and their score would read 0.
  // Writing incrementally makes the players table the source of truth,
  // independent of socket lifecycle. endGame's bulk update stays as a
  // redundant safety net.
  await supabase
    .from('players')
    .update({ score: player.score, total_time_ms: player.totalTimeMs })
    .eq('id', player.playerId)

  for (const id of countedOptionIds) {
    game.answerCounts.set(id, (game.answerCounts.get(id) ?? 0) + 1)
  }
  game.answersReceived.add(player.playerId)

  getIO().to(`session:${pin}`).emit('player-answered', { nickname: player.nickname })

  ack?.({ received: true })

  // Auto-end question if all players answered
  if (game.answersReceived.size >= game.players.size) {
    await endQuestion(pin)
  }
}

// verifyHostOwnership — re-resolves the CURRENT active game's quiz owner_id
// and checks it against socket.admin.id. Called on every host action (not
// cached) so a recycled PIN pointing at a different session/quiz can never
// be authorized by a stale cache (see W3). Under legacy mode socket.admin is
// never set — there is no per-admin identity, so isHost alone is the guard,
// matching pre-existing legacy behavior.
async function verifyHostOwnership(socket, game) {
  if (!socket.admin) return true
  if (!game) return false

  // Superadmins host any admin's game — mirrors the HTTP requireQuizOwner
  // bypass so the "iniciar any quiz" flow works over sockets too.
  if (socket.admin.role === 'superadmin') return true

  const { data: quiz, error } = await supabase
    .from('quizzes')
    .select('owner_id')
    .eq('id', game.quizId)
    .single()

  return !(error || !quiz || quiz.owner_id !== socket.admin.id)
}

// ─── HOST: host:join-session ──────────────────────────────────────────────────

async function handleHostJoinSession(socket, data, ack) {
  if (!socket.isHost) return ack?.({ error: 'UNAUTHORIZED' })
  const { pin } = data ?? {}
  if (!pin) return ack?.({ error: 'VALIDATION_ERROR' })
  const game = activeGames.get(pin)
  if (!game) return ack?.({ error: 'SESSION_NOT_FOUND' })

  // Ownership check — runs whenever a JWT was accepted (socket.admin is
  // set), regardless of AUTH_MODE. Legacy has a single shared admin token
  // and no per-admin identity, so verifyHostOwnership is a no-op there.
  const authorized = await verifyHostOwnership(socket, game)
  if (!authorized) return ack?.({ error: 'UNAUTHORIZED' })

  // Cache the authorized SESSION id (not just the PIN) — PINs are recycled
  // after endGame, so a bare pin match is not proof of ownership across
  // sessions (see W3). next-question / host:end-game re-verify both the
  // session identity and ownership on every action.
  socket.authorizedSessionId = game.sessionId

  // If this same socket was already hosting a DIFFERENT session, drop it
  // from that OLD game's hostSocketIds — keeps host-abandonment tracking
  // correct even when a host's socket hops sessions without a real
  // 'disconnect' event. If that empties the old game and it has no pending
  // grace timer yet, start one for the OLD pin too.
  if (socket.gamePin && socket.gamePin !== pin) {
    const oldGame = activeGames.get(socket.gamePin)
    if (oldGame) {
      oldGame.hostSocketIds.delete(socket.id)
      if (oldGame.hostSocketIds.size === 0 && !oldGame.hostDisconnectTimer) {
        const oldPin = socket.gamePin
        oldGame.hostDisconnectTimer = setTimeout(() => endGame(oldPin), HOST_DISCONNECT_GRACE_MS)
      }
    }
  }

  // A host (re)joining within the grace window cancels the pending auto-end.
  if (game.hostDisconnectTimer) {
    clearTimeout(game.hostDisconnectTimer)
    game.hostDisconnectTimer = null
  }
  game.hostSocketIds.add(socket.id)

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

async function handleNextQuestion(socket, io, data) {
  if (!socket.isHost) return socket.emit('error', { code: 'UNAUTHORIZED' })
  const { pin } = data ?? {}
  if (!pin) return socket.emit('error', { code: 'VALIDATION_ERROR' })

  const game = activeGames.get(pin)
  if (!game) return socket.emit('error', { code: 'SESSION_NOT_FOUND' })

  // Reject if the PIN was recycled into a different session since this
  // socket was authorized, then re-verify ownership against the DB (W3) —
  // never trust a cached pin alone as proof of ownership.
  if (socket.admin && socket.authorizedSessionId !== game.sessionId) {
    return socket.emit('error', { code: 'UNAUTHORIZED' })
  }
  const authorized = await verifyHostOwnership(socket, game)
  if (!authorized) return socket.emit('error', { code: 'UNAUTHORIZED' })

  game.currentQuestionIndex++

  if (game.currentQuestionIndex >= game.questions.length) {
    endGame(pin)
  } else {
    startQuestion(pin)
  }
}

// ─── HOST: host:end-game ──────────────────────────────────────────────────────

async function handleHostEndGame(socket, data) {
  if (!socket.isHost) return socket.emit('error', { code: 'UNAUTHORIZED' })
  const { pin } = data ?? {}

  const game = activeGames.get(pin)
  if (!game) return socket.emit('error', { code: 'SESSION_NOT_FOUND' })

  // Reject if the PIN was recycled into a different session since this
  // socket was authorized, then re-verify ownership against the DB (W3) —
  // never trust a cached pin alone as proof of ownership.
  if (socket.admin && socket.authorizedSessionId !== game.sessionId) {
    return socket.emit('error', { code: 'UNAUTHORIZED' })
  }
  const authorized = await verifyHostOwnership(socket, game)
  if (!authorized) return socket.emit('error', { code: 'UNAUTHORIZED' })

  if (game.currentQuestionIndex === -1) return socket.emit('error', { code: 'SESSION_INVALID_TRANSITION' })
  endGame(pin)
}

// ─── DISCONNECT ───────────────────────────────────────────────────────────────

function handleDisconnect(socket, io) {
  const pin = socket.gamePin
  if (!pin) return

  const game = activeGames.get(pin)
  if (!game) return

  // Player-side and host-side cleanup are independent — a socket could in
  // principle be both, so one must not early-return past the other.
  const player = game.players.get(socket.id)
  if (player) {
    game.players.delete(socket.id)

    // Broadcast updated count (only meaningful in lobby; in active game just removes from map)
    io.to(`session:${pin}`).emit('player-left', {
      nickname: player.nickname,
      playerCount: game.players.size
    })
    // Do NOT delete from DB — answers stay intact
  }

  if (game.hostSocketIds.has(socket.id)) {
    game.hostSocketIds.delete(socket.id)
    if (game.hostSocketIds.size === 0) {
      game.hostDisconnectTimer = setTimeout(() => endGame(pin), HOST_DISCONNECT_GRACE_MS)
    }
  }
}
