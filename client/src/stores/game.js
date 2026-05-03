import { defineStore } from 'pinia'

export const useGameStore = defineStore('game', {
  state: () => ({
    pin: null,
    sessionId: null,
    playerId: null,
    nickname: null,
    players: [],
    currentQuestion: null,  // { index, text, type, timeLimitSeconds, options? }
    secondsLeft: 0,
    phase: 'idle',  // 'idle' | 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'ended'
    lastReveal: null,  // { correctOptionId, answerStats }
    leaderboard: [],   // [{ rank, nickname, score, totalTimeMs }]
    myAnswer: null,    // what the player submitted for current question
  }),
  actions: {
    reset() {
      this.$patch({
        pin: null, sessionId: null, playerId: null, nickname: null,
        players: [], currentQuestion: null, secondsLeft: 0,
        phase: 'idle', lastReveal: null, leaderboard: [], myAnswer: null
      })
    }
  }
})
