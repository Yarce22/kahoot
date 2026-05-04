import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'
import { useSocket } from './useSocket.js'
import { onMounted, onUnmounted } from 'vue'

export function useGame(pin) {
  const store = useGameStore()
  const router = useRouter()
  const { connect, getSocket } = useSocket()

  function registerListeners() {
    const socket = getSocket()
    if (!socket) return

    socket.on('player-joined', ({ nickname, playerCount }) => {
      if (!store.players.find(p => p.nickname === nickname)) {
        store.players.push({ nickname })
      }
    })

    socket.on('player-left', ({ nickname }) => {
      store.players = store.players.filter(p => p.nickname !== nickname)
    })

    socket.on('game-started', ({ totalQuestions }) => {
      store.phase = 'question'
      // Wait for question-show before navigating
    })

    socket.on('question-show', (question) => {
      store.currentQuestion = question
      store.secondsLeft = question.timeLimitSeconds
      store.myAnswer = null
      store.phase = 'question'
      router.push(`/game/${pin}`)
    })

    socket.on('timer-tick', ({ secondsLeft }) => {
      store.secondsLeft = secondsLeft
    })

    socket.on('question-end', (reveal) => {
      store.lastReveal = reveal
      store.phase = 'reveal'
      router.push(`/leaderboard/${pin}`)
    })

    socket.on('show-leaderboard', ({ entries }) => {
      store.leaderboard = entries
    })

    socket.on('game-end', ({ leaderboard }) => {
      store.leaderboard = leaderboard
      store.phase = 'ended'
      router.push(`/results/${pin}`)
    })

    socket.on('error', ({ code, message }) => {
      store.lastError = { code, message }
    })
  }

  function removeListeners() {
    const socket = getSocket()
    if (!socket) return
    socket.off('player-joined')
    socket.off('player-left')
    socket.off('game-started')
    socket.off('question-show')
    socket.off('timer-tick')
    socket.off('question-end')
    socket.off('show-leaderboard')
    socket.off('game-end')
    socket.off('error')
  }

  onMounted(registerListeners)
  onUnmounted(removeListeners)

  function joinGame(gamePin, nickname) {
    const socket = connect()
    return new Promise((resolve, reject) => {
      socket.emit('join-game', { pin: gamePin, nickname }, (ack) => {
        if (ack?.error) reject(new Error(ack.error))
        else resolve(ack)
      })
    })
  }

  function submitAnswer(payload) {
    getSocket()?.emit('submit-answer', payload)
  }

  function nextQuestion(gamePin) {
    getSocket()?.emit('next-question', { pin: gamePin })
  }

  function endGame(gamePin) {
    getSocket()?.emit('host:end-game', { pin: gamePin })
  }

  return { store, joinGame, submitAnswer, nextQuestion, endGame }
}
