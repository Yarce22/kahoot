<template>
  <div class="leaderboard-view view-transition-enter">

    <!-- Correct answer banner -->
    <div
      v-if="store.lastReveal"
      class="correct-answer-banner"
      role="status"
      aria-live="polite"
    >
      <template v-if="store.lastReveal.correctOptionIds?.length">
        <p class="correct-answer-label">Respuestas correctas</p>
        <p class="correct-answer-text">{{ correctOptionTexts }}</p>
      </template>
      <template v-else-if="store.lastReveal.correctOptionId">
        <p class="correct-answer-label">Respuesta correcta</p>
        <p class="correct-answer-text">{{ correctOptionText }}</p>
      </template>
      <template v-else-if="store.lastReveal.correctAnswerText">
        <p class="correct-answer-label">Respuesta esperada</p>
        <p class="correct-answer-text">{{ store.lastReveal.correctAnswerText }}</p>
      </template>
      <template v-else>
        <p class="correct-answer-text" style="font-size: 16px;">Pregunta abierta</p>
      </template>
    </div>

    <!-- Leaderboard -->
    <h2 class="leaderboard-title">🏆 Clasificación</h2>

    <div
      v-if="store.leaderboard.length"
      class="leaderboard-list"
      aria-label="Clasificación actual"
    >
      <div
        v-for="(entry, i) in store.leaderboard"
        :key="entry.nickname"
        :class="['leaderboard-item', rankClass(i)]"
        :style="{ animationDelay: (i * 0.07) + 's' }"
      >
        <div class="rank-badge">{{ rankLabel(i) }}</div>
        <span class="player-name">{{ entry.nickname }}</span>
        <span class="player-score">{{ entry.score }} pts</span>
      </div>
    </div>

    <p v-else role="status" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
      Esperando la siguiente pregunta…
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useGameStore } from '../stores/game.js'
import { useGame } from '../composables/useGame.js'

const route = useRoute()
const pin = route.params.pin
const store = useGameStore()
useGame(pin)

const correctOptionText = computed(() => {
  const id = store.lastReveal?.correctOptionId
  if (!id || !store.currentQuestion?.options) return ''
  return store.currentQuestion.options.find(o => o.id === id)?.text || ''
})

const correctOptionTexts = computed(() => {
  const ids = store.lastReveal?.correctOptionIds
  if (!ids?.length || !store.currentQuestion?.options) return ''
  return store.currentQuestion.options
    .filter(o => ids.includes(o.id))
    .map(o => o.text)
    .join(', ')
})

function rankClass(i) {
  if (i === 0) return 'rank-1'
  if (i === 1) return 'rank-2'
  if (i === 2) return 'rank-3'
  return 'rank-default'
}

function rankLabel(i) {
  return ['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`
}
</script>

<style scoped>
.leaderboard-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 20px;
  gap: 20px;
  position: relative;
  z-index: 1;
}

.correct-answer-banner {
  width: 100%;
  max-width: 640px;
  background: linear-gradient(135deg, rgba(70, 217, 138, 0.2), rgba(46, 204, 113, 0.1));
  border: 1px solid rgba(70, 217, 138, 0.35);
  border-radius: var(--radius-xl);
  padding: 18px 24px;
  text-align: center;
  animation: fadeSlideUp 0.4s ease both;
}

.correct-answer-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--accent-green);
  font-weight: 700;
  margin-bottom: 6px;
  font-family: 'Nunito', sans-serif;
}

.correct-answer-text {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 20px;
  color: var(--text-primary);
}

.leaderboard-title {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 26px;
  text-align: center;
  color: var(--text-primary);
}

.leaderboard-list {
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.leaderboard-item {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 18px;
  animation: staggerIn 0.4s ease both;
  transition: transform 0.2s;
}

.leaderboard-item:hover { transform: translateX(4px); }

.leaderboard-item.rank-1 {
  border-color: rgba(245, 200, 66, 0.5);
  background: linear-gradient(135deg, rgba(245, 200, 66, 0.12), var(--bg-card));
}
.leaderboard-item.rank-2 {
  border-color: rgba(180, 180, 200, 0.4);
  background: linear-gradient(135deg, rgba(180, 180, 200, 0.1), var(--bg-card));
}
.leaderboard-item.rank-3 {
  border-color: rgba(200, 120, 60, 0.4);
  background: linear-gradient(135deg, rgba(200, 120, 60, 0.1), var(--bg-card));
}

.rank-badge {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 16px;
  flex-shrink: 0;
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.rank-1 .rank-badge {
  background: linear-gradient(135deg, #f5c842, #e8b800);
  color: #1a1035;
  box-shadow: var(--shadow-glow-yellow);
}
.rank-2 .rank-badge {
  background: linear-gradient(135deg, #c0c0d0, #a0a0b0);
  color: #1a1035;
}
.rank-3 .rank-badge {
  background: linear-gradient(135deg, #cd7f32, #b8692a);
  color: white;
}

.player-name {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 17px;
  flex: 1;
  color: var(--text-primary);
}

.player-score {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 18px;
  color: var(--accent-yellow);
  animation: countUp 0.5s ease both;
}
</style>
