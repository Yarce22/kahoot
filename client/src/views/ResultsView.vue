<template>
  <div class="results">
    <h2>Round Results</h2>

    <div v-if="store.lastReveal" role="status" aria-live="polite">
      <p v-if="store.lastReveal.correctOptionId" class="correct-badge">
        ✓ Correct: {{ correctOptionText }}
      </p>
      <p v-else class="correct-badge">
        Open question — no automatic scoring
      </p>
    </div>

    <div v-if="store.leaderboard.length" class="interim-board" aria-label="Current leaderboard">
      <h3>Leaderboard</h3>
      <ol>
        <li v-for="(entry, i) in store.leaderboard" :key="entry.nickname">
          <span class="rank">#{{ i + 1 }}</span>
          <span class="nickname">{{ entry.nickname }}</span>
          <span class="score">{{ entry.score }} pts</span>
        </li>
      </ol>
    </div>

    <p v-else role="status">Waiting for next question…</p>
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
</script>
