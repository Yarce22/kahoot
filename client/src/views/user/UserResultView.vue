<template>
  <div class="user-result-view view-transition-enter">

    <p v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</p>

    <p v-if="loading" style="color: var(--text-secondary); font-family: 'Nunito', sans-serif; font-weight: 700;">
      Cargando resultado…
    </p>

    <template v-else-if="!errorMsg && result">
      <div class="card" style="padding: 24px; margin-bottom: 20px;">
        <h1 class="nunito" style="font-weight: 900; font-size: 24px; color: var(--text-primary); margin-bottom: 8px;">
          Resultado
        </h1>
        <p class="score-line">
          {{ result.correctCount }}/{{ result.totalQuestions }} correctas ({{ result.scorePercent }}%)
        </p>
        <p v-if="result.submittedAt" class="submitted-line">
          Entregado el {{ formatDate(result.submittedAt) }}
        </p>
      </div>

      <div class="card" style="padding: 24px;">
        <h2 class="nunito" style="font-weight: 800; font-size: 18px; color: var(--text-primary); margin-bottom: 16px;">
          Respuestas
        </h2>
        <div v-if="result.answers.length" style="display: flex; flex-direction: column; gap: 8px;">
          <div
            v-for="ans in result.answers"
            :key="ans.questionId"
            class="answer-row"
          >
            <!-- Same three-state icon pattern as SessionResultsView.vue:
                 true/false/null → ✅/❌/— (open-question grading can
                 legitimately land on null, same as the admin view). -->
            <span style="font-size: 16px; flex-shrink: 0;">{{ ans.isCorrect ? '✅' : ans.isCorrect === false ? '❌' : '—' }}</span>
            <div style="flex: 1;">
              <p class="answer-question">{{ ans.questionText }}</p>
              <p class="answer-text">{{ ans.answerText || '(sin respuesta)' }}</p>
            </div>
          </div>
        </div>
        <p v-else style="color: var(--text-muted); font-family: 'Nunito', sans-serif; font-weight: 700; font-size: 14px; text-align: center; padding: 20px 0;">
          No hay respuestas registradas.
        </p>
      </div>
    </template>

    <router-link to="/user/quizzes" class="btn btn-ghost" style="margin-top: 20px; display: inline-block;">
      ← Volver a mis exámenes
    </router-link>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useUserQuizzesStore } from '../../stores/userQuizzes.js'

const route = useRoute()
const store = useUserQuizzesStore()

const loading = ref(false)
const result = ref(null)
const errorMsg = ref('')

onMounted(async () => {
  loading.value = true
  try {
    // 409 ATTEMPT_STILL_IN_PROGRESS: must submit first (GET has no side
    // effects — it will never lazily grade). Shown inline, no crash.
    const res = await store.fetchResult(route.params.id)
    result.value = res.result
  } catch (e) {
    errorMsg.value = e.message === 'ATTEMPT_STILL_IN_PROGRESS'
      ? 'Este intento todavía está en progreso — entregalo para ver el resultado.'
      : e.message
  } finally {
    loading.value = false
  }
})

function formatDate(iso) {
  return new Date(iso).toLocaleString()
}
</script>

<style scoped>
.user-result-view {
  min-height: 100vh;
  padding: 32px 24px 40px;
  max-width: 640px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

.score-line {
  font-family: 'Nunito', sans-serif;
  font-weight: 800;
  font-size: 20px;
  color: var(--accent-green);
}

.submitted-line {
  font-family: 'Nunito', sans-serif;
  font-weight: 600;
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.answer-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}

.answer-question {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 2px;
}

.answer-text {
  font-family: 'Nunito', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: var(--text-primary);
}
</style>
