import { getIO } from '../lib/io.js'
import supabase from '../lib/supabase.js'
import { activeGames } from '../runtime/activeGames.js'
import { rankPlayers } from './leaderboard.js'

export function startQuestion(pin) {
  const game = activeGames.get(pin)
  if (!game) return
  const io = getIO()
  const question = game.questions[game.currentQuestionIndex]

  clearInterval(game.tickHandle)
  clearTimeout(game.timeoutHandle)
  game.tickHandle = null
  game.timeoutHandle = null

  game.questionStartedAt = Date.now()
  game.answersReceived = new Set()
  game.answerCounts = new Map()
  game.firstCorrectAnswered = false

  // Broadcast question (never send is_correct to players)
  const payload = {
    index: game.currentQuestionIndex,
    text: question.text,
    type: question.type,
    timeLimitSeconds: question.time_limit_seconds,
    ...((question.type === 'closed' || question.type === 'true_false' || question.type === 'multiple') && {
      options: question.options.map(o => ({ id: o.id, text: o.text }))
    })
  }
  io.to(`session:${pin}`).emit('question-show', payload)

  // Tick every second
  let secondsLeft = question.time_limit_seconds
  game.tickHandle = setInterval(() => {
    secondsLeft--
    io.to(`session:${pin}`).emit('timer-tick', { secondsLeft })
    if (secondsLeft <= 0) clearInterval(game.tickHandle)
  }, 1000)

  // Auto-end after time limit
  game.timeoutHandle = setTimeout(() => endQuestion(pin), question.time_limit_seconds * 1000)
}

export async function endQuestion(pin) {
  const game = activeGames.get(pin)
  if (!game) return
  const io = getIO()

  // Clear timers
  clearInterval(game.tickHandle)
  clearTimeout(game.timeoutHandle)
  game.tickHandle = null
  game.timeoutHandle = null

  const question = game.questions[game.currentQuestionIndex]

  // Build answer stats
  const isSingleChoice = question.type === 'closed' || question.type === 'true_false'
  const isChoiceType = isSingleChoice || question.type === 'multiple'

  // Single-choice reveals one correct option id; 'multiple' reveals the full
  // set of correct option ids so the client can highlight every right answer.
  const correctOptionId = isSingleChoice
    ? question.options.find(o => o.is_correct)?.id ?? null
    : null
  const correctOptionIds = question.type === 'multiple'
    ? question.options.filter(o => o.is_correct).map(o => o.id)
    : null

  const totalPlayers = game.players.size
  const answeredCount = game.answersReceived.size

  const answerStats = {}
  if (isChoiceType) {
    for (const opt of question.options) {
      answerStats[opt.id] = game.answerCounts.get(opt.id) ?? 0
    }
  }

  const correctAnswerText = question.type === 'open'
    ? question.options?.find(o => o.is_correct)?.text ?? null
    : null

  io.to(`session:${pin}`).emit('question-end', { correctOptionId, correctOptionIds, correctAnswerText, answerStats })

  // Emit interim leaderboard
  const leaderboard = buildLeaderboard(game)
  io.to(`session:${pin}`).emit('show-leaderboard', { entries: leaderboard })
}

export async function endGame(pin) {
  const game = activeGames.get(pin)
  if (!game) return
  const io = getIO()

  clearInterval(game.tickHandle)
  clearTimeout(game.timeoutHandle)
  // A manual/host-initiated end (or the last-question auto-end) makes any
  // pending host-abandonment timer moot — clear it so it doesn't dangle and
  // pointlessly re-fire endGame later. That later call would already be a
  // safe no-op (see the `if (!game) return` guard above), but leaving the
  // timer around is needless.
  clearTimeout(game.hostDisconnectTimer)

  // Persist each player's final score + total time before the in-memory game
  // is discarded — otherwise the leaderboard can't be reconstructed later.
  const players = [...game.players.values()]
  await Promise.all(players.map(p =>
    supabase
      .from('players')
      .update({ score: p.score, total_time_ms: p.totalTimeMs })
      .eq('id', p.playerId)
  ))

  // Mark the session finished.
  await supabase
    .from('game_sessions')
    .update({ status: 'finished', ended_at: new Date().toISOString() })
    .eq('id', game.sessionId)

  const leaderboard = buildLeaderboard(game)
  io.to(`session:${pin}`).emit('game-end', { leaderboard })

  activeGames.delete(pin)
}

function buildLeaderboard(game) {
  return rankPlayers([...game.players.values()])
}
