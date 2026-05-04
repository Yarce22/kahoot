<template>
  <div class="game-view view-transition-enter">
    <template v-if="store.currentQuestion">
      <!-- Timer bar -->
      <div
        class="timer-bar-container"
        role="progressbar"
        :aria-valuenow="store.secondsLeft"
        :aria-valuemax="store.currentQuestion.timeLimitSeconds"
        aria-label="Tiempo restante"
      >
        <div
          class="timer-bar-fill"
          :class="{ urgent: timerPercent <= 25 }"
          :style="{ width: timerPercent + '%', background: timerColor }"
        ></div>
      </div>

      <!-- Question area -->
      <div class="question-area">
        <p class="question-number">
          Pregunta {{ (store.currentQuestion.index ?? 0) + 1 }}
        </p>
        <h2 class="question-text">{{ store.currentQuestion.text }}</h2>
        <p
          class="timer-countdown"
          :class="{ urgent: store.secondsLeft <= 5 && store.secondsLeft > 0 }"
          aria-live="polite"
          aria-atomic="true"
        >
          {{ store.secondsLeft }}s
        </p>
      </div>

      <!-- Closed (multiple choice) -->
      <div
        v-if="store.currentQuestion.type === 'closed'"
        class="answer-grid"
        role="group"
        :aria-label="`Opciones de respuesta para: ${store.currentQuestion.text}`"
      >
        <button
          v-for="(opt, i) in store.currentQuestion.options"
          :key="opt.id"
          :class="[
            'answer-btn',
            `answer-btn-${i % 4}`,
            { 'selected': store.myAnswer === opt.id, 'dimmed': store.myAnswer && store.myAnswer !== opt.id }
          ]"
          :disabled="!!store.myAnswer"
          :aria-pressed="store.myAnswer === opt.id"
          @click="answerClosed(opt.id)"
        >
          <span class="answer-icon" aria-hidden="true">
            <svg v-if="i % 4 === 0" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="rgba(255,255,255,0.7)"/></svg>
            <svg v-else-if="i % 4 === 1" width="24" height="24" viewBox="0 0 24 24"><polygon points="12,3 21,21 3,21" fill="rgba(255,255,255,0.7)"/></svg>
            <svg v-else-if="i % 4 === 2" width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="rgba(255,255,255,0.7)"/></svg>
            <svg v-else width="24" height="24" viewBox="0 0 24 24"><polygon points="12,2 22,12 12,22 2,12" fill="rgba(255,255,255,0.7)"/></svg>
          </span>
          {{ opt.text }}
        </button>
      </div>

      <!-- True / False -->
      <div
        v-else-if="store.currentQuestion.type === 'true_false'"
        class="tf-grid"
        role="group"
        :aria-label="`Opciones de respuesta para: ${store.currentQuestion.text}`"
      >
        <button
          v-for="(opt, i) in store.currentQuestion.options"
          :key="opt.id"
          :class="['tf-btn', i === 0 ? 'verdadero' : 'falso', { 'selected': store.myAnswer === opt.id }]"
          :disabled="!!store.myAnswer"
          :aria-pressed="store.myAnswer === opt.id"
          @click="answerClosed(opt.id)"
        >
          <span style="font-size: 32px;" aria-hidden="true">{{ i === 0 ? '✓' : '✕' }}</span>
          {{ opt.text }}
        </button>
      </div>

      <!-- Open answer -->
      <div v-else class="open-area">
        <template v-if="!store.myAnswer">
          <form @submit.prevent="answerOpen" aria-label="Formulario de respuesta abierta">
            <label for="open-input" class="sr-only">Tu respuesta</label>
            <input
              id="open-input"
              v-model="openText"
              class="input-field input-normal"
              type="text"
              placeholder="Escribí tu respuesta…"
              maxlength="500"
              :disabled="!!store.myAnswer"
              autocomplete="off"
            />
            <button
              type="submit"
              class="btn btn-primary"
              style="width: 100%; margin-top: 12px;"
              :disabled="!!store.myAnswer"
            >
              Enviar respuesta
            </button>
          </form>
        </template>
        <div v-else class="sent-confirmation">
          <span class="big-check" aria-hidden="true">✅</span>
          <p class="sent-title">¡Respuesta enviada!</p>
          <p style="color: var(--text-secondary); font-size: 14px;">Esperando al host…</p>
        </div>
      </div>

      <!-- Submitted confirmation for closed/TF -->
      <p v-if="store.myAnswer && store.currentQuestion.type !== 'open'" class="submitted-msg" role="status">
        ¡Respuesta enviada! Esperando al host…
      </p>
    </template>

    <p v-else class="waiting-question" role="status">Esperando la siguiente pregunta…</p>
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

const timerColor = computed(() => {
  const p = timerPercent.value
  if (p > 60) return 'var(--accent-green)'
  if (p > 30) return 'var(--accent-yellow)'
  return 'var(--accent-coral)'
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

<style scoped>
.game-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
}

.timer-bar-container {
  height: 10px;
  background: var(--bg-elevated);
  width: 100%;
  position: relative;
  overflow: hidden;
}

.timer-bar-fill {
  height: 100%;
  transition: width 0.5s linear, background-color 0.5s;
  border-radius: 0 4px 4px 0;
}

.timer-bar-fill.urgent {
  animation: timerPulse 0.5s ease-in-out infinite;
}

.question-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 24px;
  gap: 20px;
  text-align: center;
  max-flex: none;
}

.question-number {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--text-secondary);
}

.question-text {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: clamp(22px, 5vw, 34px);
  line-height: 1.25;
  max-width: 700px;
  animation: fadeSlideUp 0.4s ease both;
  color: var(--text-primary);
}

.timer-countdown {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 32px;
  color: var(--accent-yellow);
  min-width: 60px;
  text-align: center;
}

.timer-countdown.urgent {
  color: var(--accent-coral);
  animation: pulse 0.5s ease infinite;
}

/* Answer grid */
.answer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 16px 20px 28px;
}

.answer-btn {
  border: none;
  cursor: pointer;
  border-radius: var(--radius-lg);
  padding: 20px 16px;
  min-height: 80px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 16px;
  color: white;
  transition: all 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative;
  overflow: hidden;
  text-align: left;
}

.answer-btn:hover:not(:disabled) {
  transform: scale(1.04) translateY(-3px);
  filter: brightness(1.1);
}
.answer-btn:active:not(:disabled) { transform: scale(0.95); }

/* Index-based colors matching design: yellow, coral, cyan, green */
.answer-btn-0 {
  background: linear-gradient(135deg, var(--accent-yellow), #d4a800);
  color: #1a1035;
  box-shadow: 0 4px 16px rgba(245, 200, 66, 0.4);
}
.answer-btn-1 {
  background: linear-gradient(135deg, var(--accent-coral), #e84a2f);
  color: white;
  box-shadow: 0 4px 16px rgba(244, 99, 74, 0.4);
}
.answer-btn-2 {
  background: linear-gradient(135deg, var(--accent-cyan), #1ab8b8);
  color: #0e1a2e;
  box-shadow: 0 4px 16px rgba(61, 207, 207, 0.4);
}
.answer-btn-3 {
  background: linear-gradient(135deg, var(--accent-green), #2bc47a);
  color: #0e1a12;
  box-shadow: 0 4px 16px rgba(70, 217, 138, 0.4);
}

.answer-btn.selected { animation: starburstGlow 1s ease-in-out infinite; filter: brightness(1.15); }
.answer-btn.dimmed   { opacity: 0.35; transform: scale(0.97); }
.answer-btn:disabled { cursor: not-allowed; }

.answer-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* True/False grid */
.tf-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 16px 20px 28px;
}

.tf-btn {
  border: none;
  cursor: pointer;
  border-radius: var(--radius-xl);
  padding: 28px 20px;
  min-height: 110px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 22px;
  color: white;
  transition: all 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.tf-btn:hover:not(:disabled)  { transform: scale(1.04) translateY(-3px); filter: brightness(1.1); }
.tf-btn:active:not(:disabled) { transform: scale(0.95); }
.tf-btn:disabled               { cursor: not-allowed; }

.tf-btn.verdadero {
  background: linear-gradient(135deg, var(--accent-green), #2bc47a);
  box-shadow: 0 4px 20px rgba(70, 217, 138, 0.4);
  color: #0e1a12;
}
.tf-btn.falso {
  background: linear-gradient(135deg, var(--accent-coral), #e84a2f);
  box-shadow: 0 4px 20px rgba(244, 99, 74, 0.4);
}
.tf-btn.selected { animation: starburstGlow 1s ease-in-out infinite; filter: brightness(1.15); }

/* Open answer */
.open-area {
  padding: 16px 20px 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sent-confirmation {
  text-align: center;
  padding: 24px;
  animation: popIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.big-check {
  font-size: 52px;
  margin-bottom: 12px;
  display: block;
}

.sent-title {
  font-family: 'Nunito', sans-serif;
  font-weight: 900;
  font-size: 22px;
  color: var(--accent-green);
  margin-bottom: 6px;
}

.submitted-msg {
  text-align: center;
  padding: 12px 24px;
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: var(--accent-green);
}

.waiting-question {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 100vh;
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: var(--text-secondary);
  text-align: center;
  padding: 3rem 1rem;
}

@media (max-width: 600px) {
  .answer-grid { gap: 8px; }
  .answer-btn  { font-size: 14px; min-height: 68px; }
  .tf-grid     { gap: 10px; }
}
</style>
