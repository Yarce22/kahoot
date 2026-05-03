<template>
  <div class="game">
    <template v-if="store.currentQuestion">
      <!-- Timer bar -->
      <div
        class="timer-bar-wrap"
        role="progressbar"
        :aria-valuenow="store.secondsLeft"
        :aria-valuemax="store.currentQuestion.timeLimitSeconds"
        aria-label="Time remaining"
      >
        <div class="timer-bar-fill" :style="{ width: timerPercent + '%' }"></div>
      </div>

      <!-- Question header -->
      <div class="question-header">
        <p class="timer-label" aria-live="polite" aria-atomic="true">
          {{ store.secondsLeft }}s
        </p>
        <h2>{{ store.currentQuestion.text }}</h2>
      </div>

      <!-- Closed question -->
      <div
        v-if="store.currentQuestion.type === 'closed'"
        class="answer-grid"
        role="group"
        :aria-label="`Answer options for: ${store.currentQuestion.text}`"
      >
        <button
          v-for="(opt, i) in store.currentQuestion.options"
          :key="opt.id"
          :class="['opt', `opt-${i % 4}`, { 'opt-selected': store.myAnswer === opt.id }]"
          :disabled="!!store.myAnswer"
          :aria-pressed="store.myAnswer === opt.id"
          @click="answerClosed(opt.id)"
        >
          {{ opt.text }}
        </button>
      </div>

      <!-- True/False question -->
      <div
        v-else-if="store.currentQuestion.type === 'true_false'"
        class="tf-grid"
        role="group"
        :aria-label="`Answer options for: ${store.currentQuestion.text}`"
      >
        <button
          v-for="(opt, i) in store.currentQuestion.options"
          :key="opt.id"
          :class="['opt', `opt-tf-${i}`, { 'opt-selected': store.myAnswer === opt.id }]"
          :disabled="!!store.myAnswer"
          :aria-pressed="store.myAnswer === opt.id"
          @click="answerClosed(opt.id)"
        >
          {{ opt.text }}
        </button>
      </div>

      <!-- Open question -->
      <div v-else class="open-answer">
        <form @submit.prevent="answerOpen" aria-label="Open answer form">
          <label for="open-input" class="sr-only">Your answer</label>
          <input
            id="open-input"
            v-model="openText"
            type="text"
            placeholder="Type your answer…"
            maxlength="500"
            :disabled="!!store.myAnswer"
            autocomplete="off"
          />
          <button type="submit" :disabled="!!store.myAnswer">Submit</button>
        </form>
      </div>

      <p v-if="store.myAnswer" class="submitted" role="status">
        Answer submitted!
      </p>
    </template>

    <p v-else class="waiting">Waiting for question…</p>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useGameStore } from '../stores/game.js'
import { useGame } from '../composables/useGame.js'

const route = useRoute()
const pin = route.params.pin
const store = useGameStore()
const { submitAnswer } = useGame(pin)
const openText = ref('')

const timerPercent = computed(() => {
  if (!store.currentQuestion) return 100
  return Math.round((store.secondsLeft / store.currentQuestion.timeLimitSeconds) * 100)
})

function answerClosed(optionId) {
  store.myAnswer = optionId
  submitAnswer({ questionIndex: store.currentQuestion.index, selectedOptionId: optionId })
}

function answerOpen() {
  const text = openText.value.trim()
  if (!text) return
  store.myAnswer = text
  submitAnswer({ questionIndex: store.currentQuestion.index, answerText: text })
}
</script>
